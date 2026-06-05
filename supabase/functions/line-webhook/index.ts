/**
 * line-webhook v9 — LINE native typing indicator + "ไม่พบ" safety net
 *
 * Before we wait on rag-chat / Gemini (typically 3–8s) we kick off LINE's
 * official Loading Animation API so the customer sees the native dots
 * inside the LINE chat — same as when a real human is typing. The
 * animation auto-cancels the moment our reply lands.
 *   NOTE: the loading animation only renders in the LINE *mobile* app; LINE
 *   for PC/Mac does not display it (LINE platform limitation).
 *
 * v9: deterministic sanitizeReply() — the LLM still occasionally opens with
 * "ขออภัย…ไม่พบ…ในระบบ" despite the persona/tooling rules. We strip any such
 * "ไม่พบ / ไม่มี…ในระบบ / หาไม่เจอ" line from the reply before sending, so the
 * customer never sees a blunt not-found, regardless of what the model wrote.
 *
 * Endpoint: POST /v2/bot/chat/loading/start { chatId, loadingSeconds }
 * loadingSeconds must be one of {5,10,15,20,25,30,40,50,60}. We use 20.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
};

const LOADING_SECONDS = 20;

interface LineChannel {
  id: string;
  name: string;
  channel_id: string | null;
  channel_access_token: string;
  channel_secret: string;
  is_active: boolean;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string; groupId?: string; roomId?: string };
  timestamp?: number;
  message?: { type: string; id: string; text?: string; stickerId?: string; packageId?: string; };
}

type LineMessage =
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string };

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === signature;
}

async function getActiveChannel(admin: SupabaseClient): Promise<LineChannel | null> {
  const { data, error } = await admin
    .from("line_channels")
    .select("id, name, channel_id, channel_access_token, channel_secret, is_active")
    .eq("is_active", true)
    .limit(1).maybeSingle();
  if (error) { console.error("getActiveChannel error:", error.message); return null; }
  return (data as LineChannel | null) ?? null;
}

async function upsertLineConversation(
  admin: SupabaseClient,
  lineUserId: string,
  displayName: string,
  avatarUrl: string | null,
): Promise<string | null> {
  const { data: existing } = await admin.from("chat_conversations")
    .select("id, display_name, avatar_url")
    .eq("channel", "line").eq("external_id", lineUserId).maybeSingle();

  if (existing?.id) {
    const row = existing as { id: string; display_name: string | null; avatar_url: string | null };
    const patch: Record<string, unknown> = {};
    if (displayName && row.display_name !== displayName) patch.display_name = displayName;
    if (avatarUrl && row.avatar_url !== avatarUrl) patch.avatar_url = avatarUrl;
    if (Object.keys(patch).length > 0) {
      await admin.from("chat_conversations").update(patch).eq("id", row.id);
    }
    return row.id;
  }

  const { data: inserted, error } = await admin.from("chat_conversations").insert({
    channel: "line",
    external_id: lineUserId,
    display_name: displayName,
    avatar_url: avatarUrl,
    status: "open",
  }).select("id").single();
  if (error) { console.error("insert conv error:", error.message); return null; }
  return (inserted as { id: string }).id;
}

async function saveMessage(admin: SupabaseClient, conversationId: string, senderType: "customer" | "agent" | "bot" | "system", content: string, externalMsgId?: string, metadata: Record<string, unknown> = {}) {
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: senderType, content, content_type: "text",
    external_msg_id: externalMsgId ?? null, metadata,
  });
  if (error) console.warn("saveMessage err:", error.message);
  await admin.from("chat_conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: content.slice(0, 140),
  }).eq("id", conversationId);
}

async function getLineUserProfile(accessToken: string, userId: string): Promise<{ displayName?: string; pictureUrl?: string } | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// v8: kick off LINE's native typing dots inside the chat. Fire-and-forget —
// any error (legacy channel without the feature, network blip, rate limit)
// gets logged but never blocks the actual reply. Renders in the LINE mobile
// app only (not LINE for PC).
async function startLineLoading(accessToken: string, userId: string): Promise<void> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chatId: userId, loadingSeconds: LOADING_SECONDS }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("LINE loading/start failed:", res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("LINE loading/start error:", (e as Error).message);
  }
}

// v9: hard guarantee against blunt "not found" replies. The persona + tooling
// rules tell เอย never to say "ไม่พบ/ไม่มี…ในระบบ", but the LLM occasionally
// ignores that. Strip any line carrying a forbidden phrase; what's left is the
// helpful part (nearby items + made-to-order/escalation). If nothing useful
// remains, fall back to a clean escalation line.
function sanitizeReply(text: string): string {
  if (!text) return text;
  const FORBIDDEN = /(ยังไม่พบ|ไม่พบ|ไม่มีสินค้า|ไม่มี[^\n]{0,15}ในระบบ|หาไม่เจอ)/u;
  if (!FORBIDDEN.test(text)) return text;
  const kept = text.split(/\n/).filter((l) => !FORBIDDEN.test(l));
  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Drop a dangling leading connective left behind ("แต่…" / "แต่ว่า…").
  out = out.replace(/^\s*(แต่ว่า|แต่)\s*/u, "").trim();
  if (out.length < 8) {
    out = "อันนี้เอยขอให้คุณเชอร์รี่ตรวจสอบเพิ่มเติมก่อนนะคะ ว่าสั่งผลิตหรือจัดหาให้ได้ไหม เดี๋ยวเอยแจ้งกลับอีกทีนะคะ 😊";
  }
  return out;
}

async function callRagChat(supabaseUrl: string, serviceKey: string, query: string, history: Array<{role:string;content:string}>): Promise<string> {
  const res = await fetch(`${supabaseUrl}/functions/v1/rag-chat`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, history, stream: false, channel: "line" }),
  });
  const data = await res.json();
  return (data?.answer as string) || "ขออภัยค่ะ ยังไม่ได้รับคำตอบ";
}

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
  return out.slice(0, 5);
}

async function replyToLine(accessToken: string, replyToken: string, text: string): Promise<void> {
  const messages = textToLineMessages(text);
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error("LINE reply failed:", res.status, await res.text().catch(() => ""));
}

async function loadHistory(admin: SupabaseClient, conversationId: string): Promise<Array<{role:string;content:string}>> {
  const { data } = await admin.from("chat_messages")
    .select("sender_type, content").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(20);
  const rows = (data ?? []) as Array<{ sender_type: string; content: string }>;
  return rows.reverse().map((r) => ({
    role: r.sender_type === "customer" ? "user" : "assistant",
    content: r.content,
  }));
}

async function shouldBotReply(admin: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const [global, channel, conv] = await Promise.all([
      admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle(),
      admin.from("ai_personas").select("bot_enabled").eq("channel", "line").maybeSingle(),
      admin.from("chat_conversations").select("bot_enabled").eq("id", conversationId).maybeSingle(),
    ]);
    const g = (global.data as Record<string, unknown> | null)?.bot_enabled;
    const c = (channel.data as Record<string, unknown> | null)?.bot_enabled;
    const v = (conv.data as Record<string, unknown> | null)?.bot_enabled;
    if (g === false) return false;
    if (c === false) return false;
    if (v === false) return false;
    return true;
  } catch (e) {
    console.warn("shouldBotReply check failed, defaulting to enabled:", (e as Error).message);
    return true;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  const channel = await getActiveChannel(admin);
  if (!channel) {
    console.warn("no active LINE channel configured");
    return new Response(JSON.stringify({ ok: false, error: "no_active_channel" }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const valid = await verifySignature(rawBody, signature, channel.channel_secret);
  if (!valid) {
    console.warn("invalid LINE signature");
    return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  let payload: { events?: LineEvent[] } = {};
  try { payload = JSON.parse(rawBody); } catch { /* empty */ }

  for (const ev of payload.events ?? []) {
    try { await handleEvent(admin, channel, ev, supabaseUrl, serviceKey); }
    catch (e) { console.error("handleEvent error:", (e as Error).message); }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});

async function handleEvent(admin: SupabaseClient, channel: LineChannel, ev: LineEvent, supabaseUrl: string, serviceKey: string) {
  if (ev.type !== "message") return;
  const userId = ev.source?.userId;
  if (!userId) return;

  const profile = await getLineUserProfile(channel.channel_access_token, userId);
  const displayName = profile?.displayName ?? `LINE User ${userId.slice(0, 6)}`;
  const avatarUrl = profile?.pictureUrl ?? null;

  const conversationId = await upsertLineConversation(admin, userId, displayName, avatarUrl);
  if (!conversationId) return;

  const msg = ev.message;
  if (!msg) return;

  if (msg.type !== "text" || !msg.text) {
    await saveMessage(admin, conversationId, "system",
      `[${msg.type}] ลูกค้าส่ง ${msg.type === "image" ? "รูปภาพ" : msg.type === "sticker" ? "sticker" : msg.type}`,
      msg.id, { line_message_type: msg.type, sticker_id: msg.stickerId, package_id: msg.packageId },
    );
    return;
  }

  await saveMessage(admin, conversationId, "customer", msg.text, msg.id);

  const allowed = await shouldBotReply(admin, conversationId);
  if (!allowed) return;

  // Show LINE's native typing dots while we wait on rag-chat (fire-and-forget).
  // Runs in parallel with history load + rag-chat call so it lights up
  // almost immediately and auto-cancels when replyToLine lands.
  void startLineLoading(channel.channel_access_token, userId);

  const history = await loadHistory(admin, conversationId);
  const priorHistory = history.slice(0, -1);
  const aiReply = sanitizeReply(await callRagChat(supabaseUrl, serviceKey, msg.text, priorHistory));

  if (ev.replyToken) {
    await replyToLine(channel.channel_access_token, ev.replyToken, aiReply);
  }

  await saveMessage(admin, conversationId, "bot", aiReply, undefined, {
    channel_id: channel.id, channel_name: channel.name,
  });
}
