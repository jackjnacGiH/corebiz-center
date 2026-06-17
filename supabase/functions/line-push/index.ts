/**
 * line-push v3 — admin → LINE push, with markdown images + quoted replies
 *
 * v3: accept an optional `quote_token` — when present, attach it to the first
 * text message so the customer sees a native LINE quoted reply (like LINE OA's
 * "reply to message"). The token comes from the customer message being replied
 * to (captured by line-webhook in metadata.quote_token).
 *
 * v2: split markdown ![alt](url) into native LINE image messages instead of
 * leaving raw markdown in the text.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LineMessage =
  | { type: "text"; text: string; quoteToken?: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string };

function textToLineMessages(text: string): LineMessage[] {
  const IMG_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  const out: LineMessage[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  IMG_RE.lastIndex = 0;
  function pushTextChunk(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    for (let i = 0; i < trimmed.length; i += 4900) {
      out.push({ type: "text", text: trimmed.slice(i, i + 4900) });
    }
  }
  while ((m = IMG_RE.exec(text)) !== null) {
    if (m.index > lastIndex) pushTextChunk(text.slice(lastIndex, m.index));
    out.push({ type: "image", originalContentUrl: m[2], previewImageUrl: m[2] });
    lastIndex = IMG_RE.lastIndex;
  }
  if (lastIndex < text.length) pushTextChunk(text.slice(lastIndex));
  if (out.length === 0) out.push({ type: "text", text: "..." });
  return out.slice(0, 5); // LINE Push API: max 5 messages
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { conversation_id?: string; text?: string; quote_token?: string } = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const conversationId = (body.conversation_id ?? "").trim();
  const text = (body.text ?? "").trim();
  const quoteToken = (body.quote_token ?? "").trim();
  if (!conversationId || !text) {
    return new Response(JSON.stringify({ ok: false, error: "missing_conversation_or_text" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const { data: conv, error: convErr } = await admin.from("chat_conversations")
    .select("channel, external_id").eq("id", conversationId).maybeSingle();
  if (convErr || !conv) {
    return new Response(JSON.stringify({ ok: false, error: "conversation_not_found" }), {
      status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (conv.channel !== "line") {
    return new Response(JSON.stringify({ ok: false, error: "not_a_line_conversation" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  const lineUserId = conv.external_id as string | null;
  if (!lineUserId) {
    return new Response(JSON.stringify({ ok: false, error: "missing_line_user_id" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const { data: channel, error: chErr } = await admin.from("line_channels")
    .select("channel_access_token").eq("is_active", true).limit(1).maybeSingle();
  if (chErr || !channel) {
    return new Response(JSON.stringify({ ok: false, error: "no_active_line_channel" }), {
      status: 503, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const messages = textToLineMessages(text);
  // Native LINE quoted reply: attach the quoteToken to the first text message.
  if (quoteToken) {
    const firstText = messages.find((mm) => mm.type === "text") as { type: "text"; text: string; quoteToken?: string } | undefined;
    if (firstText) firstText.quoteToken = quoteToken;
  }

  const pushRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${(channel as { channel_access_token: string }).channel_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  });
  const pushBody = await pushRes.json().catch(() => ({}));
  if (!pushRes.ok) {
    return new Response(JSON.stringify({ ok: false, error: "line_push_failed", details: pushBody, status: pushRes.status }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(JSON.stringify({ ok: true, sent: messages.length }), {
    status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
