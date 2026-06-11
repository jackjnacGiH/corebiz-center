/**
 * notify-team v1 — push a LINE message to the team when an important
 * agent-queue task is created (new quote request, lead, customer-link
 * verification, customer quote response).
 *
 * Called by a pg_net trigger on agent_tasks (migration 0058) with
 * { task_id } and a shared-key header — verify_jwt is off, the key gates it.
 *
 * Recipients: active owner/admin profiles that signed in with LINE
 * (profiles.line_user_id). Channel access token comes from line_channels
 * (same one line-webhook uses), so pushes work as long as the LINE Login
 * channel and the OA live under the same LINE Developers provider.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTIFY_KEY = "corebiz_notify_team_2026_x7k9";
const ADMIN_URL = "https://www.jnac.online/center/";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (req.headers.get("x-notify-key") !== NOTIFY_KEY) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const taskId = String(body.task_id ?? "").trim();
  if (!taskId) return json({ ok: false, error: "task_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: task } = await admin
    .from("agent_tasks")
    .select("title, summary, recommendation, kind")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return json({ ok: false, error: "task_not_found" }, 404);

  const { data: recipients } = await admin
    .from("profiles")
    .select("line_user_id, full_name")
    .in("role", ["owner", "admin"])
    .eq("is_active", true)
    .not("line_user_id", "is", null);
  if (!recipients || recipients.length === 0) {
    console.log("notify-team: no LINE-linked owner/admin recipients");
    return json({ ok: true, sent: 0, note: "no recipients" });
  }

  const { data: ch } = await admin
    .from("line_channels")
    .select("channel_access_token")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const token = (ch as { channel_access_token?: string } | null)?.channel_access_token;
  if (!token) {
    console.log("notify-team: no active line channel token");
    return json({ ok: true, sent: 0, note: "no line channel" });
  }

  const text =
    `🔔 ${task.title}\n` +
    (task.summary ? `${task.summary}\n` : "") +
    (task.recommendation ? `\n👉 ${task.recommendation}\n` : "") +
    `\nเปิดดู: ${ADMIN_URL}`;

  let sent = 0;
  for (const r of recipients as Array<{ line_user_id: string }>) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: r.line_user_id, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (res.ok) sent++;
    else console.error("LINE push failed:", res.status, await res.text().catch(() => ""));
  }

  return json({ ok: true, sent, recipients: recipients.length });
});
