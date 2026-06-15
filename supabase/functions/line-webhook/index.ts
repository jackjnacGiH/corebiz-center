/**
 * line-webhook v14 — send public quote link after a bot quote
 *
 * v14: when the bot's request_quote tool creates a draft quote, parse the
 * quote code from rag-chat's tool_calls and push the customer a public
 * (no-login) link `/center/q/<token>` so they can view + download the PDF
 * without registering — LINE customers don't have a portal account. (The
 * DB trigger handles the same for the web-widget channel.)
 *
 * v13: store customer file/PDF attachments
 *
 * v13: when a customer sends a file (PDF/docs), download it from LINE,
 * store it in chat-attachments, and save a content_type='file' message
 * with the filename/size in metadata so the admin sees + can open it in
 * Omni-Chat (instead of a blank "[file]" line that's easy to miss).
 *
 * v12 — link LINE chats to CRM members
 *
 * v12: when the LINE user has logged in to the portal with LINE
 * (profiles.line_user_id) and is linked to a CRM customer
 * (customer_contacts verified / legacy customers.user_id), the chat
 * conversation is stamped with customer_id — so the chat shows up in the
 * customer's 360° profile and staff instantly know which company is talking.
 * (v11: store customer image in chat-attachments + show in Omni-Chat;
 *  v10: download LINE image → rag-chat vision; v9: typing indicator +
 *  sanitizeReply.)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
};

const LOADING_SECONDS = 20;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
  message?: { type: string; id: string; text?: string; stickerId?: string; packageId?: string; fileName?: string; fileSize?: number; };
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

// v12: LINE user → portal member → CRM customer. Verified contact first,
// legacy customers.user_id as fallback. Null when not a linked member.
async function resolveMemberCustomerId(admin: SupabaseClient, lineUserId: string): Promise<string | null> {
  try {
    const { data: prof } = await admin
      .from("profiles").select("id").eq("line_user_id", lineUserId).maybeSingle();
    const uid = (prof as { id?: string } | null)?.id;
    if (!uid) return null;
    const { data: cc } = await admin
      .from("customer_contacts").select("customer_id, verified").eq("user_id", uid).maybeSingle();
    if ((cc as { verified?: boolean } | null)?.verified) return (cc as { customer_id: string }).customer_id;
    const { data: c } = await admin
      .from("customers").select("id").eq("user_id", uid).maybeSingle();
    return ((c as { id?: string } | null)?.id) ?? null;
  } catch (e) {
    console.warn("resolveMemberCustomerId error:", (e as Error).message);
    return null;
  }
}

async function upsertLineConversation(
  admin: SupabaseClient,
  lineUserId: string,
  displayName: string,
  avatarUrl: string | null,
): Promise<string | null> {
  const { data: existing } = await admin.from("chat_conversations")
    .select("id, display_name, avatar_url, customer_id")
    .eq("channel", "line").eq("external_id", lineUserId).maybeSingle();

  if (existing?.id) {
    const row = existing as { id: string; display_name: string | null; avatar_url: string | null; customer_id: string | null };
    const patch: Record<string, unknown> = {};
    if (displayName && row.display_name !== displayName) patch.display_name = displayName;
    if (avatarUrl && row.avatar_url !== avatarUrl) patch.avatar_url = avatarUrl;
    if (!row.customer_id) {
      const cust = await resolveMemberCustomerId(admin, lineUserId);
      if (cust) patch.customer_id = cust;
    }
    if (Object.keys(patch).length > 0) {
      await admin.from("chat_conversations").update(patch).eq("id", row.id);
    }
    return row.id;
  }

  const customerId = await resolveMemberCustomerId(admin, lineUserId);
  const { data: inserted, error } = await admin.from("chat_conversations").insert({
    channel: "line",
    external_id: lineUserId,
    display_name: displayName,
    avatar_url: avatarUrl,
    status: "open",
    customer_id: customerId,
  }).select("id").single();
  if (error) { console.error("insert conv error:", error.message); return null; }
  return (inserted as { id: string }).id;
}

async function saveMessage(admin: SupabaseClient, conversationId: string, senderType: "customer" | "agent" | "bot" | "system", content: string, externalMsgId?: string, metadata: Record<string, unknown> = {}, contentType: string = "text") {
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: senderType, content, content_type: contentType,
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

async function downloadLineImage(accessToken: string, messageId: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) { console.warn("LINE content fetch failed:", res.status); return null; }
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) { console.warn("LINE image size out of range:", buf.length); return null; }
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return { mimeType, data: btoa(binary) };
  } catch (e) {
    console.warn("downloadLineImage error:", (e as Error).message);
    return null;
  }
}

// v11: upload the customer's image to the public chat-attachments bucket so it
// renders inline in the admin Omni-Chat (which parses ![image](url) markdown).
async function uploadImageToStorage(admin: SupabaseClient, conversationId: string, mimeType: string, base64: string): Promise<string | null> {
  try {
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : mimeType.includes("gif") ? "gif" : "jpg";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `${conversationId}/${Date.now()}-line.${ext}`;
    const { error } = await admin.storage.from("chat-attachments").upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) { console.warn("storage upload failed:", error.message); return null; }
    const { data } = admin.storage.from("chat-attachments").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.warn("uploadImageToStorage error:", (e as Error).message);
    return null;
  }
}

// Download any LINE message content (used for file/PDF attachments). Like
// downloadLineImage but keeps the real mime type and allows larger files.
async function downloadLineFile(accessToken: string, messageId: string): Promise<{ mimeType: string; base64: string; size: number } | null> {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) { console.warn("LINE file fetch failed:", res.status); return null; }
    const mimeType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES) { console.warn("LINE file size out of range:", buf.length); return null; }
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    return { mimeType, base64: btoa(binary), size: buf.length };
  } catch (e) {
    console.warn("downloadLineFile error:", (e as Error).message);
    return null;
  }
}

// Upload a customer's file to the public chat-attachments bucket. The original
// (possibly Thai) filename is kept in message metadata for display; the storage
// path is ASCII-sanitised + timestamped to stay unique and valid.
async function uploadFileToStorage(admin: SupabaseClient, conversationId: string, fileName: string, mimeType: string, base64: string): Promise<string | null> {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safe = (fileName.replace(/[^\w.\-]+/g, "_") || "file").slice(-80);
    const path = `${conversationId}/${Date.now()}-${safe}`;
    const { error } = await admin.storage.from("chat-attachments").upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) { console.warn("file upload failed:", error.message); return null; }
    const { data } = admin.storage.from("chat-attachments").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.warn("uploadFileToStorage error:", (e as Error).message);
    return null;
  }
}

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

function sanitizeReply(text: string): string {
  if (!text) return text;
  const FORBIDDEN = /(ยังไม่พบ|ไม่พบ|ไม่มีสินค้า|ไม่มี[^\n]{0,15}ในระบบ|หาไม่เจอ)/u;
  if (!FORBIDDEN.test(text)) return text;
  const kept = text.split(/\n/).filter((l) => !FORBIDDEN.test(l));
  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  out = out.replace(/^\s*(แต่ว่า|แต่)\s*/u, "").trim();
  if (out.length < 8) {
    out = "อันนี้เอยขอให้คุณเชอร์รี่ตรวจสอบเพิ่มเติมก่อนนะคะ ว่าสั่งผลิตหรือจัดหาให้ได้ไหม เดี๋ยวเอยแจ้งกลับอีกทีนะคะ 😊";
  }
  return out;
}

async function callRagChat(
  supabaseUrl: string,
  serviceKey: string,
  query: string,
  history: Array<{ role: string; content: string }>,
  images: Array<{ mimeType: string; data: string }> = [],
): Promise<{ answer: string; quoteCode: string | null }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/rag-chat`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, history, images, stream: false, channel: "line" }),
  });
  const data = await res.json();
  const answer = (data?.answer as string) || "ขออภัยค่ะ ยังไม่ได้รับคำตอบ";
  // If the bot's request_quote tool created a draft quote, rag-chat exposes
  // its code in tool_calls[].result_summary — pull it out so we can send the
  // customer a public (no-login) link to view + download the PDF.
  let quoteCode: string | null = null;
  const calls = Array.isArray((data as Record<string, unknown>)?.tool_calls)
    ? (data as { tool_calls: Array<Record<string, unknown>> }).tool_calls : [];
  for (const c of calls) {
    const m = /"quote_code":\s*"(QT-[^"]+)"/.exec(String(c?.result_summary ?? ""));
    if (m) { quoteCode = m[1]; break; }
  }
  return { answer, quoteCode };
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

// Push a follow-up message (the reply token is single-use, already spent on the
// main answer — so the quote link goes out as a push).
async function pushToLine(accessToken: string, userId: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: userId, messages: textToLineMessages(text) }),
  });
  if (!res.ok) console.error("LINE push failed:", res.status, await res.text().catch(() => ""));
}

// Build the public (no-login) quote link message for a quote code. Customers
// who never registered can't open the /account portal, so this link lets them
// view + download the PDF directly.
async function quoteLinkMessage(admin: SupabaseClient, quoteCode: string): Promise<string | null> {
  const { data } = await admin.from("quotes").select("public_token").eq("code", quoteCode).maybeSingle();
  const token = (data as { public_token?: string } | null)?.public_token;
  if (!token) return null;
  return `📄 ใบเสนอราคา ${quoteCode}\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):\nhttps://www.jnac.online/center/q/${token}`;
}

// After a bot reply, if a quote was just created, send the customer the public
// link as a follow-up push and record it in the conversation (so it shows in
// the admin Omni-Chat with a quote_link marker).
async function sendQuoteLinkIfAny(
  admin: SupabaseClient, accessToken: string, userId: string, conversationId: string, quoteCode: string | null,
): Promise<void> {
  if (!quoteCode) return;
  const linkMsg = await quoteLinkMessage(admin, quoteCode);
  if (!linkMsg) return;
  await pushToLine(accessToken, userId, linkMsg);
  await saveMessage(admin, conversationId, "bot", linkMsg, undefined, { quote_link: true, quote_code: quoteCode });
}

async function loadHistory(admin: SupabaseClient, conversationId: string): Promise<Array<{ role: string; content: string }>> {
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

  // v11: IMAGE — store it so the admin sees it in Omni-Chat, and let the bot (vision) understand it.
  if (msg.type === "image") {
    void startLineLoading(channel.channel_access_token, userId);
    const img = await downloadLineImage(channel.channel_access_token, msg.id);
    let url: string | null = null;
    if (img) url = await uploadImageToStorage(admin, conversationId, img.mimeType, img.data);
    const custContent = url ? `![image](${url})` : "[ลูกค้าส่งรูปภาพ]";
    await saveMessage(admin, conversationId, "customer", custContent, msg.id, { line_message_type: "image", image_url: url }, "image");

    const allowed = await shouldBotReply(admin, conversationId);
    if (!allowed) return;

    let aiReply: string;
    let quoteCode: string | null = null;
    if (!img) {
      aiReply = "ขออภัยค่ะ ตอนนี้เอยเปิดดูรูปไม่ได้ รบกวนพิมพ์ชื่อ/รุ่นสินค้ามาได้ไหมคะ เอยจะช่วยหาให้นะคะ 😊";
    } else {
      const history = await loadHistory(admin, conversationId);
      const priorHistory = history.slice(0, -1);
      const rag = await callRagChat(supabaseUrl, serviceKey, "", priorHistory, [img]);
      aiReply = sanitizeReply(rag.answer);
      quoteCode = rag.quoteCode;
    }
    if (ev.replyToken) await replyToLine(channel.channel_access_token, ev.replyToken, aiReply);
    await saveMessage(admin, conversationId, "bot", aiReply, undefined, {
      channel_id: channel.id, channel_name: channel.name, from_image: true,
    });
    await sendQuoteLinkIfAny(admin, channel.channel_access_token, userId, conversationId, quoteCode);
    return;
  }

  // FILE (PDF / docs) — download it so the admin sees + can open it in Omni-Chat
  // instead of a blank "[file]" line that's easy to miss.
  if (msg.type === "file") {
    const fileName = (msg.fileName && msg.fileName.trim()) || `file-${msg.id}`;
    const dl = await downloadLineFile(channel.channel_access_token, msg.id);
    let url: string | null = null;
    if (dl) url = await uploadFileToStorage(admin, conversationId, fileName, dl.mimeType, dl.base64);
    const content = url ? `📎 ${fileName}` : `[ลูกค้าส่งไฟล์: ${fileName}]`;
    await saveMessage(admin, conversationId, "customer", content, msg.id, {
      line_message_type: "file",
      file_url: url,
      file_name: fileName,
      file_size: msg.fileSize ?? dl?.size ?? null,
      mime_type: dl?.mimeType ?? null,
    }, "file");
    return;
  }

  if (msg.type !== "text" || !msg.text) {
    await saveMessage(admin, conversationId, "system",
      `[${msg.type}] ลูกค้าส่ง ${msg.type === "sticker" ? "sticker" : msg.type}`,
      msg.id, { line_message_type: msg.type, sticker_id: msg.stickerId, package_id: msg.packageId },
    );
    return;
  }

  await saveMessage(admin, conversationId, "customer", msg.text, msg.id);

  const allowed = await shouldBotReply(admin, conversationId);
  if (!allowed) return;

  void startLineLoading(channel.channel_access_token, userId);

  const history = await loadHistory(admin, conversationId);
  const priorHistory = history.slice(0, -1);
  const rag = await callRagChat(supabaseUrl, serviceKey, msg.text, priorHistory);
  const aiReply = sanitizeReply(rag.answer);

  if (ev.replyToken) {
    await replyToLine(channel.channel_access_token, ev.replyToken, aiReply);
  }

  await saveMessage(admin, conversationId, "bot", aiReply, undefined, {
    channel_id: channel.id, channel_name: channel.name,
  });
  await sendQuoteLinkIfAny(admin, channel.channel_access_token, userId, conversationId, rag.quoteCode);
}
