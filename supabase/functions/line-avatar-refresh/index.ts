import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: identity, error: identityError } = await admin.auth.getUser(token);
  if (identityError || !identity.user) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: staff, error: staffError } = await admin.from("profiles")
    .select("role, is_active").eq("id", identity.user.id).maybeSingle();
  if (staffError || !staff?.is_active || !["owner", "admin", "staff"].includes(staff.role)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: { conversation_id?: unknown; failed_url?: unknown };
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json");
    body = value;
  } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(conversationId)) {
    return json({ ok: false, error: "invalid_conversation" }, 400);
  }
  const failedUrl = typeof body.failed_url === "string" ? body.failed_url : null;
  const { data: conversation, error: conversationError } = await admin.from("chat_conversations")
    .select("channel, external_id, avatar_url").eq("id", conversationId).maybeSingle();
  if (conversationError || !conversation || conversation.channel !== "line" ||
    !/^U[0-9a-f]{32}$/i.test(conversation.external_id ?? "")) {
    return json({ ok: false, error: "line_conversation_not_found" }, 404);
  }
  // A second avatar in the same room may have failed after another request
  // already repaired the saved URL. Do not call LINE again for the old URL.
  if (failedUrl && conversation.avatar_url && failedUrl !== conversation.avatar_url) {
    return json({ ok: true, avatar_url: conversation.avatar_url });
  }

  const { data: channel, error: channelError } = await admin.from("line_channels")
    .select("channel_access_token").eq("is_active", true).limit(1).maybeSingle();
  if (channelError || !channel?.channel_access_token) {
    return json({ ok: false, error: "line_channel_unavailable" }, 503);
  }

  let response: Response;
  try {
    response = await fetch(`https://api.line.me/v2/bot/profile/${conversation.external_id}`, {
      headers: { Authorization: `Bearer ${channel.channel_access_token}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return json({ ok: false, error: "line_profile_unavailable" }, 502);
  }
  if (!response.ok) return json({ ok: false, error: "line_profile_unavailable" }, 502);
  const profile = await response.json().catch(() => null) as { pictureUrl?: unknown } | null;
  const pictureUrl = typeof profile?.pictureUrl === "string" ? profile.pictureUrl : null;
  if (pictureUrl && !pictureUrl.startsWith("https://")) {
    return json({ ok: false, error: "invalid_profile_image" }, 502);
  }
  if (pictureUrl !== conversation.avatar_url) {
    const { error: updateError } = await admin.from("chat_conversations")
      .update({ avatar_url: pictureUrl }).eq("id", conversationId);
    if (updateError) return json({ ok: false, error: "avatar_update_failed" }, 500);
  }
  return json({ ok: true, avatar_url: pictureUrl });
});
