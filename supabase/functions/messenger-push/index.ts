/** Staff reply from Omni-Chat to a Facebook Messenger conversation. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { messengerQuickReplies } from "../_shared/facebook-channel.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const pageId = Deno.env.get("META_PAGE_ID")?.trim();
  const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN")?.trim();
  if (!pageId || !pageToken) return json({ ok: false, error: "facebook_not_configured" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const jwt = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("is_active,role").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.is_active || !["owner", "admin", "staff"].includes(profile.role)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: { conversation_id?: string; text?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const conversationId = String(body.conversation_id ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !text || text.length > 10_000) {
    return json({ ok: false, error: "invalid_message" }, 400);
  }

  const { data: conv, error: conversationError } = await admin.from("chat_conversations")
    .select("channel,external_id,metadata").eq("id", conversationId).maybeSingle();
  if (conversationError || conv?.channel !== "messenger" || !conv.external_id || conv.metadata?.page_id !== pageId) {
    return json({ ok: false, error: "conversation_not_found" }, 404);
  }

  // Standard RESPONSE messages may only be sent during the Messenger window.
  const { data: latest, error: latestError } = await admin.from("chat_messages")
    .select("created_at").eq("conversation_id", conversationId).eq("sender_type", "customer")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError || !latest?.created_at || Date.now() - Date.parse(latest.created_at) >= 24 * 60 * 60 * 1000) {
    return json({ ok: false, error: "messenger_reply_window_expired" }, 409);
  }

  const clean = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$2");
  const parts = clean.match(/[\s\S]{1,1900}/g) ?? [];
  const replies = messengerQuickReplies(text);
  const version = Deno.env.get("META_GRAPH_API_VERSION") || "v26.0";
  for (let index = 0; index < parts.length; index++) {
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/${version}/${pageId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: conv.external_id }, messaging_type: "RESPONSE",
          message: {
            text: parts[index],
            ...(index === parts.length - 1 && replies.length ? { quick_replies: replies } : {}),
          },
        }),
      });
    } catch {
      return json({ ok: false, error: "graph_unavailable", sent_parts: index }, 502);
    }
    if (!response.ok) return json({ ok: false, error: "graph_send_failed", graph_status: response.status, sent_parts: index }, 502);
  }
  return json({ ok: true, sent_parts: parts.length });
});
