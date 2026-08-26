/**
 * line-webhook v28 — suppress generic text after a recent image
 *
 * v28: LINE sends an image and a generic request such as "ขอราคาหน่อย" as
 * separate events. The image owns the reply for 12 seconds so the text event
 * cannot lose the pixels and reuse an unrelated product from old history.
 *
 * v31 — idempotent LINE events, payment-slip privacy, and one quote reply
 *
 * v33 — lower-latency LINE processing and privacy-safe timing telemetry
 *
 * Reuses briefly cached channel/bot flags, fetches a LINE profile only when a
 * conversation is first created, lets the incoming-message unique index handle
 * cheap event retries, and measures the LINE-to-RAG/reply path without storing
 * customer text, image data, profile data, or other PII in telemetry.
 *
 * v20 — send the quote link in the (free) reply, not a push
 *
 * v20: the public quote link was sent as a separate LINE push, which uses the
 * monthly push quota — so once the quota was exhausted the link silently failed
 * (customer saw the bot reply but no link). Now the link is appended to the SAME
 * reply as the bot's answer (LINE reply API is free + unlimited), so it always
 * goes out and stops consuming push quota.
 *
 * v19 — drop the obsolete "บัญชีของฉัน / /account" pointer
 *
 * v19: sanitizeReply now strips the bot's "log in at บัญชีของฉัน /account"
 * sentence. Quotes are sent as a public no-login link (/center/q/<token>), so
 * the log-in pointer only confused customers ("ทำไมต้องเข้าระบบ").
 *
 * v18 — show customer LINE locations
 *
 * v18: a customer's shared LINE location now becomes a customer message with a
 * tappable Google Maps link (📍 title + address + maps URL) instead of a blank
 * "[location]" system line. No bot auto-reply — staff handle it.
 *
 * v17 — capture quoteToken for reply-to-message
 *
 * v17: store each incoming message's LINE quoteToken in metadata.quote_token,
 * so when an admin "replies to" that message in Omni-Chat we can send a native
 * LINE quoted reply (like LINE OA). Captured on text/image/file messages.
 *
 * v16 — stop the bot echoing old quote links
 *
 * v16: the public quote link was being fed back into rag-chat's history, so
 * the model parroted the PREVIOUS quote's link into a new answer — a fresh
 * quote then showed two links (one wrong). loadHistory now drops the dedicated
 * quote-link messages and strips any /center/q/<token> link from other
 * messages, so the model never sees (and never repeats) a link.
 *
 * v15 — auto-link bot quotes to the chat's CRM customer
 *
 * v15: when the bot creates a quote and the LINE chat is linked to a CRM
 * customer (chat_conversations.customer_id), stamp that customer onto the
 * quote — so the quote's PDF / public link show the name + address
 * automatically, instead of an admin picking the customer by hand.
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
const IMAGE_FOLLOWUP_WINDOW_MS = 12_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACTIVE_CHANNEL_CACHE_MS = 15_000;
const BOT_FLAG_CACHE_MS = 30_000;
const BOT_CONVERSATION_CACHE_MAX = 1_000;
const DB_REGION = Deno.env.get("LINE_RAG_DB_REGION")?.trim() || "ap-southeast-2";
const DB_REGION_PERCENT = Math.max(0, Math.min(
  100,
  Number(Deno.env.get("LINE_RAG_DB_REGION_PERCENT") ?? "50") || 0,
));

type CacheEntry<T> = { value: T; expiresAt: number };
type RoutingVariant = "auto" | "db_region";
type SafeTimings = Record<string, number>;

let activeChannelCache: CacheEntry<LineChannel> | null = null;
let globalBotFlagCache: CacheEntry<boolean> | null = null;
let channelBotFlagCache: CacheEntry<boolean> | null = null;
const conversationBotFlagCache = new Map<string, CacheEntry<boolean>>();

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
  message?: { type: string; id: string; text?: string; stickerId?: string; packageId?: string; fileName?: string; fileSize?: number; quoteToken?: string; title?: string; address?: string; latitude?: number; longitude?: number; };
}

type LineMessage =
  | { 
      type: "text"; 
      text: string; 
      quickReply?: {
        items: Array<{
          type: "action";
          action: {
            type: "message";
            label: string;
            text: string;
          };
        }>;
      };
    }
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
  const now = Date.now();
  if (activeChannelCache && activeChannelCache.expiresAt > now) {
    return activeChannelCache.value;
  }
  const { data, error } = await admin
    .from("line_channels")
    .select("id, name, channel_id, channel_access_token, channel_secret, is_active")
    .eq("is_active", true)
    .limit(1).maybeSingle();
  if (error) { console.error("getActiveChannel error:", error.message); return null; }
  const channel = (data as LineChannel | null) ?? null;
  // Cache only a valid active channel. A missing/failed lookup stays fail-closed
  // and is retried on the next webhook instead of becoming a stale negative.
  if (channel) activeChannelCache = { value: channel, expiresAt: now + ACTIVE_CHANNEL_CACHE_MS };
  return channel;
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
  accessToken: string,
): Promise<string | null> {
  const { data: existing, error: existingError } = await admin.from("chat_conversations")
    .select("id, customer_id")
    .eq("channel", "line").eq("external_id", lineUserId).maybeSingle();

  if (existingError) {
    console.warn("find LINE conversation error:", existingError.message);
    return null;
  }

  if (existing?.id) {
    const row = existing as { id: string; customer_id: string | null };
    const patch: Record<string, unknown> = {};
    if (!row.customer_id) {
      const cust = await resolveMemberCustomerId(admin, lineUserId);
      if (cust) patch.customer_id = cust;
    }
    if (Object.keys(patch).length > 0) {
      await admin.from("chat_conversations").update(patch).eq("id", row.id);
    }
    return row.id;
  }

  // LINE profile HTTP calls are needed only for a brand-new conversation.
  // Existing chats keep their saved name/avatar while CRM linking still runs.
  const [profile, customerId] = await Promise.all([
    getLineUserProfile(accessToken, lineUserId),
    resolveMemberCustomerId(admin, lineUserId),
  ]);
  const displayName = profile?.displayName ?? `LINE User ${lineUserId.slice(0, 6)}`;
  const avatarUrl = profile?.pictureUrl ?? null;
  const { data: inserted, error } = await admin.from("chat_conversations").insert({
    channel: "line",
    external_id: lineUserId,
    display_name: displayName,
    avatar_url: avatarUrl,
    status: "open",
    customer_id: customerId,
  }).select("id").single();
  // Concurrent first events can race the unique (channel, external_id) key.
  // Read the winning row instead of losing the customer's message.
  if (error?.code === "23505") {
    const { data: raced } = await admin.from("chat_conversations")
      .select("id")
      .eq("channel", "line").eq("external_id", lineUserId).maybeSingle();
    return (raced as { id?: string } | null)?.id ?? null;
  }
  if (error) { console.error("insert conv error:", error.message); return null; }
  return (inserted as { id: string }).id;
}

async function saveMessage(admin: SupabaseClient, conversationId: string, senderType: "customer" | "agent" | "bot" | "system", content: string, externalMsgId?: string, metadata: Record<string, unknown> = {}, contentType: string = "text"): Promise<boolean> {
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: senderType, content, content_type: contentType,
    external_msg_id: externalMsgId ?? null, metadata,
  });
  if (error) {
    // A LINE webhook may be delivered more than once. The unique incoming-ID
    // index makes this safe; callers stop before invoking RAG on the retry.
    if (externalMsgId && error.code === "23505") {
      console.info("duplicate LINE message ignored", { conversationId, externalMsgId });
      return false;
    }
    console.warn("saveMessage err:", error.message);
    return false;
  }
  // The consolidated chat_message_inserted trigger owns conversation preview,
  // timestamp, unread count, status, and last-customer-message maintenance.
  return true;
}

async function hasProcessedIncomingMessage(admin: SupabaseClient, conversationId: string, externalMsgId?: string): Promise<boolean> {
  if (!externalMsgId) return false;
  const { data, error } = await admin.from("chat_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("external_msg_id", externalMsgId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("incoming message duplicate check failed:", error.message);
    return false;
  }
  return Boolean(data);
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

// Customer documents can contain PO, tax and payment data. Keep them in a
// private bucket; staff obtain a short-lived signed URL in Omni-Chat.
async function uploadFileToStorage(admin: SupabaseClient, conversationId: string, fileName: string, mimeType: string, base64: string): Promise<{ bucket: string; path: string } | null> {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const safe = (fileName.replace(/[^\w.\-]+/g, "_") || "file").slice(-80);
    const path = `${conversationId}/${Date.now()}-${safe}`;
    const bucket = "chat-private-files";
    const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) { console.warn("file upload failed:", error.message); return null; }
    return { bucket, path };
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
  // A transfer receipt is not proof of payment. Never repeat, extract, or
  // guess any monetary amount from a slip; accounting must verify it.
  if (/(?:สลิป(?:โอนเงิน|แจ้งชำระเงิน)?|แจ้งโอนเงิน|ฝ่ายบัญชี.*ตรวจสอบ(?:ยอด|การชำระ)|ตรวจสอบ(?:ยอด|การโอน))/u.test(text)) {
    return "ขอบพระคุณค่ะ 🙏 เอยส่งเรื่องให้ฝ่ายบัญชีตรวจสอบเรียบร้อยแล้วนะคะ 😊";
  }
  // Drop the obsolete "บัญชีของฉัน / /account" (log-in) pointer. Quotes now go
  // out as a public no-login link, so telling the customer to log in just
  // confuses them ("ทำไมต้องเข้าระบบ").
  text = text.split(/\n/)
    .filter((l) => !/บัญชีของฉัน|\/account|เข้าสู่ระบบด้วยอีเมล/u.test(l))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

function routingVariantForConversation(conversationId: string): RoutingVariant {
  // FNV-1a gives a stable, non-PII 50/50 assignment for repeat requests from
  // the same conversation. It is routing only—not a security decision.
  let hash = 0x811c9dc5;
  for (let i = 0; i < conversationId.length; i += 1) {
    hash ^= conversationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100 < DB_REGION_PERCENT ? "db_region" : "auto";
}

function lineEdgeRegion(): string | null {
  return Deno.env.get("SB_REGION") ?? Deno.env.get("DENO_REGION") ?? null;
}

function runInBackground(label: string, task: Promise<unknown>): void {
  const guarded = task.catch((error) => {
    console.warn(`${label} background task failed:`, (error as Error).message);
  });
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(guarded);
  else void guarded;
}

function sanitizeTimings(timings: SafeTimings): SafeTimings {
  return Object.fromEntries(Object.entries(timings)
    .filter(([, value]) => Number.isFinite(value) && value >= 0)
    .map(([key, value]) => [key, Math.round(value)]));
}

async function updateLineTelemetry(admin: SupabaseClient, input: {
  requestId: string;
  routingVariant: RoutingVariant;
  lineReplyMs: number | null;
  endToEndMs: number;
  phaseTimings: SafeTimings;
}): Promise<void> {
  // rag-chat records its run in the background. Retry only this idempotent
  // telemetry update while that insert becomes visible—never retry RAG/tools.
  const retryDelays = [0, 150, 400, 800, 1_200];
  for (const delayMs of retryDelays) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const { data, error } = await admin.from("chat_ai_runs")
      .select("id, phase_timings")
      .eq("request_id", input.requestId)
      .maybeSingle();
    if (error) {
      console.warn("LINE telemetry lookup failed:", error.message);
      return;
    }
    if (!data) continue;

    const existing = ((data as { phase_timings?: unknown }).phase_timings ?? {}) as Record<string, unknown>;
    const { error: updateError } = await admin.from("chat_ai_runs").update({
      line_reply_ms: input.lineReplyMs,
      end_to_end_ms: Math.round(Math.max(0, input.endToEndMs)),
      line_edge_region: lineEdgeRegion(),
      routing_variant: input.routingVariant,
      phase_timings: { ...existing, line: sanitizeTimings(input.phaseTimings) },
    }).eq("id", (data as { id: string }).id);
    if (updateError) console.warn("LINE telemetry update failed:", updateError.message);
    return;
  }
  console.warn("LINE telemetry row not visible before retry budget expired", { requestId: input.requestId });
}

async function callRagChat(
  supabaseUrl: string,
  serviceKey: string,
  query: string,
  history: Array<{ role: string; content: string }>,
  conversationId: string,
  requestId: string,
  routingVariant: RoutingVariant,
  images: Array<{ mimeType: string; data: string }> = [],
): Promise<{ answer: string; quoteCode: string | null }> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey,
    "Content-Type": "application/json",
  };
  if (routingVariant === "db_region") headers["x-region"] = DB_REGION;
  const res = await fetch(`${supabaseUrl}/functions/v1/rag-chat`, {
    method: "POST",
    headers,
    // conversation_id is accepted by rag-chat only when its service-role
    // credential matches. This gives LINE safe continuity memory without
    // letting a browser caller attach another customer's conversation.
    body: JSON.stringify({
      query, history, images, stream: false, channel: "line",
      conversation_id: conversationId, request_id: requestId,
      routing_variant: routingVariant,
    }),
  });
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* status handling below */ }
  if (!res.ok) {
    // Never retry RAG here: the failed invocation may already have executed an
    // operational tool. Log only safe correlation fields for the A/B report.
    console.error("rag-chat HTTP failed", {
      status: res.status,
      requestId,
      routingVariant,
    });
    throw new Error(`rag_chat_http_${res.status}`);
  }
  const answer = (data.answer as string) || "";
  // If the bot's request_quote tool created a draft quote, rag-chat exposes
  // its code in tool_calls[].result_summary — pull it out so we can send the
  // customer a public (no-login) link to view + download the PDF.
  let quoteCode: string | null = null;
  const calls = Array.isArray(data.tool_calls)
    ? (data as { tool_calls: Array<Record<string, unknown>> }).tool_calls : [];
  for (const c of calls) {
    const summary = String(c?.result_summary ?? "");
    if (!/"quote_created":true/.test(summary)) continue;
    const m = /"quote_code":\s*"(QT-[^"]+)"/.exec(summary);
    if (m) { quoteCode = m[1]; break; }
  }
  return { answer, quoteCode };
}

function extractQuickReplies(text: string) {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  const items: Array<{
    type: "action";
    action: {
      type: "message";
      label: string;
      text: string;
    };
  }> = [];

  let nextIndex = 1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern 1: Numbered lists, e.g., "1. ล้อขัด...", "1) ล้อขัด...", "1 ล้อขัด..."
    // We restrict the number digits to 1 or 2 (max 13 in practice)
    const numMatch = trimmed.match(/^\s*(\d{1,2})[\.\)\s-]\s*(.+)$/);
    const bulletMatch = trimmed.match(/^\s*(?:✨|•|·|-|\*|🔸|🔹|✅|👉)\s*(.+)$/);

    let optionText = "";
    let parsedNum = 0;

    if (numMatch) {
      parsedNum = parseInt(numMatch[1], 10);
      if (parsedNum > 0 && parsedNum <= 13) {
        optionText = numMatch[2].trim();
      }
    } else if (bulletMatch) {
      optionText = bulletMatch[1].trim();
    }

    if (optionText) {
      // Avoid matching lines that look like sentences or are too short/long
      if (optionText.length >= 3 && optionText.length < 80) {
        // Use the sequential nextIndex for the button label prefix to keep it clean (e.g. 1, 2, 3...)
        const prefix = `${nextIndex}. `;
        const maxLabelLen = 20 - prefix.length;
        let labelName = optionText;
        if (labelName.length > maxLabelLen) {
          labelName = labelName.slice(0, maxLabelLen - 1) + "…";
        }
        const label = `${prefix}${labelName}`;

        if (!items.some(item => item.action.text === optionText)) {
          items.push({
            type: "action",
            action: {
              type: "message",
              label: label,
              text: optionText,
            },
          });
          nextIndex++;
        }
      }
    }
  }

  // LINE only allows between 1 and 13 quick reply items.
  // We show them if there are at least 2 distinct options.
  if (items.length >= 2) {
    return { items: items.slice(0, 13) };
  }
  return undefined;
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

  // Extract quick replies from the input text
  const quickReplies = extractQuickReplies(text);
  if (quickReplies) {
    // Attach to the last text message in out
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].type === "text") {
        (out[i] as any).quickReply = quickReplies;
        break;
      }
    }
  }

  return out.slice(0, 5);
}

async function replyToLine(accessToken: string, replyToken: string, texts: string | string[]): Promise<boolean> {
  const arr = Array.isArray(texts) ? texts : [texts];
  const messages = arr.flatMap((t) => textToLineMessages(t)).slice(0, 5);
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    console.error("LINE reply failed:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
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

// When the bot just created a quote: auto-link it to the conversation's CRM
// customer (DB only, no push) and return the public quote-link text. The caller
// includes this text in the SAME reply as the answer — the LINE reply API is
// free, so the link no longer consumes the push quota (and always goes out,
// even when the monthly push quota is exhausted).
async function prepareQuoteLink(
  admin: SupabaseClient, conversationId: string, quoteCode: string,
): Promise<string | null> {
  try {
    const { data: conv } = await admin
      .from("chat_conversations").select("customer_id").eq("id", conversationId).maybeSingle();
    const custId = (conv as { customer_id?: string | null } | null)?.customer_id;
    if (custId) {
      await admin.from("quotes").update({ customer_id: custId }).eq("code", quoteCode).is("customer_id", null);
    }
  } catch (e) {
    console.warn("quote auto-link customer failed:", (e as Error).message);
  }
  return await quoteLinkMessage(admin, quoteCode);
}

// Strip any public quote link from history content. The bot would otherwise see
// a previous "📄 ใบเสนอราคา … /center/q/<token>" message in the history and
// PARROT it (the old token!) into a new answer — so a fresh quote ended up with
// two links, one pointing at the wrong quote. Links are sent by sendQuoteLinkIfAny,
// never by the model, so the model never needs to see them.
function stripQuoteLink(s: string): string {
  return (s || "")
    .replace(/📄[^\n]*\n?/gu, "")
    .replace(/ดูรายละเอียดและดาวน์โหลด[^\n]*\n?/gu, "")
    .replace(/https?:\/\/[^\s]*\/center\/q\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A LINE reply can contain one composed message. Keeping the quote status and
// its public link together avoids three separate bot bubbles for one image.
function composeQuoteReply(answer: string, quoteLink: string | null): string {
  const cleanAnswer = stripQuoteLink(answer);
  return quoteLink ? [cleanAnswer, quoteLink].filter(Boolean).join("\n\n") : cleanAnswer;
}

async function loadHistory(admin: SupabaseClient, conversationId: string): Promise<Array<{ role: string; content: string }>> {
  const { data } = await admin.from("chat_messages")
    .select("sender_type, content, metadata").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(20);
  const rows = (data ?? []) as Array<{ sender_type: string; content: string; metadata: Record<string, unknown> | null }>;
  return rows.reverse()
    .filter((r) => !(r.metadata && r.metadata.quote_link))   // drop dedicated quote-link messages
    .map((r) => ({
      role: r.sender_type === "customer" ? "user" : "assistant",
      content: stripQuoteLink(r.content),                     // strip any echoed link from other messages
    }))
    .filter((m) => m.content.length > 0);
}

// LINE can send an image and a short text such as "ขอราคาหน่อย" as separate
// events only a few seconds apart. The image handler already processes the
// visual request; invoking RAG again for the generic text loses the pixels and
// can make the model reuse an unrelated product from old chat history.
function isGenericImageFollowUp(text: string): boolean {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  return /^(?:ขอ)?(?:ใบ)?เสนอราคา(?:ห+น่อย)?(?:ครับ|ค่ะ|คับ)?$/u.test(compact)
    || /^ขอราคา(?:ห+น่อย)?(?:ครับ|ค่ะ|คับ)?$/u.test(compact)
    || /^ราคา(?:เท่าไหร่)?(?:ครับ|ค่ะ|คับ)?$/u.test(compact)
    || /^(?:แจ้ง)?โอนเงิน(?:แล้ว)?(?:ครับ|ค่ะ|คับ)?$/u.test(compact)
    || /^(?:ส่ง)?สลิป(?:โอนเงิน)?(?:ครับ|ค่ะ|คับ)?$/u.test(compact);
}

async function hasRecentCustomerImage(admin: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - IMAGE_FOLLOWUP_WINDOW_MS).toISOString();
    const { data, error } = await admin.from("chat_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("sender_type", "customer")
      .eq("content_type", "image")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.warn("recent image check failed:", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch (e) {
    console.warn("recent image check error:", (e as Error).message);
    return false;
  }
}

async function shouldBotReply(admin: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const now = Date.now();
    const cachedGlobal = globalBotFlagCache && globalBotFlagCache.expiresAt > now
      ? globalBotFlagCache.value : undefined;
    const cachedChannel = channelBotFlagCache && channelBotFlagCache.expiresAt > now
      ? channelBotFlagCache.value : undefined;
    const convEntry = conversationBotFlagCache.get(conversationId);
    const cachedConversation = convEntry && convEntry.expiresAt > now ? convEntry.value : undefined;
    if (convEntry && convEntry.expiresAt <= now) conversationBotFlagCache.delete(conversationId);

    const globalPromise: Promise<boolean | null> = cachedGlobal !== undefined
      ? Promise.resolve(cachedGlobal)
      : (async () => {
        const result = await admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle();
        if (result.error) {
          console.warn("global bot flag query failed; pausing bot", { code: result.error.code });
          return null;
        }
        const value = (result.data as Record<string, unknown> | null)?.bot_enabled !== false;
        globalBotFlagCache = { value, expiresAt: Date.now() + BOT_FLAG_CACHE_MS };
        return value;
      })();
    const channelPromise: Promise<boolean | null> = cachedChannel !== undefined
      ? Promise.resolve(cachedChannel)
      : (async () => {
        const result = await admin.from("ai_personas").select("bot_enabled").eq("channel", "line").maybeSingle();
        if (result.error) {
          console.warn("LINE bot flag query failed; pausing bot", { code: result.error.code });
          return null;
        }
        const value = (result.data as Record<string, unknown> | null)?.bot_enabled !== false;
        channelBotFlagCache = { value, expiresAt: Date.now() + BOT_FLAG_CACHE_MS };
        return value;
      })();
    const conversationPromise: Promise<boolean | null> = cachedConversation !== undefined
      ? Promise.resolve(cachedConversation)
      : (async () => {
        const result = await admin.from("chat_conversations").select("bot_enabled").eq("id", conversationId).maybeSingle();
        if (result.error || !result.data) {
          console.warn("conversation bot flag query failed; pausing bot", { code: result.error?.code ?? "not_found" });
          return null;
        }
        const value = (result.data as Record<string, unknown>).bot_enabled !== false;
        if (conversationBotFlagCache.size >= BOT_CONVERSATION_CACHE_MAX) {
          const oldestKey = conversationBotFlagCache.keys().next().value;
          if (oldestKey) conversationBotFlagCache.delete(oldestKey);
        }
        conversationBotFlagCache.set(conversationId, { value, expiresAt: Date.now() + BOT_FLAG_CACHE_MS });
        return value;
      })();

    const [globalOn, channelOn, conversationOn] = await Promise.all([
      globalPromise, channelPromise, conversationPromise,
    ]);
    // Null means a lookup failed. Never let an unavailable control-plane query
    // turn the bot on; cached successful values expire after 30 seconds.
    if (globalOn === null || channelOn === null || conversationOn === null) return false;
    return globalOn && channelOn && conversationOn;
  } catch (e) {
    console.warn("shouldBotReply check failed, defaulting to paused:", (e as Error).message);
    return false;
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
  const processingStartedAt = Date.now();
  const eventStartedAt = typeof ev.timestamp === "number"
      && Number.isFinite(ev.timestamp)
      && ev.timestamp > 1_000_000_000_000
      && ev.timestamp <= processingStartedAt + 60_000
    ? ev.timestamp
    : processingStartedAt;
  const requestId = crypto.randomUUID();
  const phaseTimings: SafeTimings = {};
  if (ev.type !== "message") return;
  const userId = ev.source?.userId;
  if (!userId) return;

  const conversationStartedAt = Date.now();
  const conversationId = await upsertLineConversation(admin, userId, channel.channel_access_token);
  phaseTimings.conversation_ms = Date.now() - conversationStartedAt;
  if (!conversationId) return;
  const routingVariant = routingVariantForConversation(conversationId);

  const msg = ev.message;
  if (!msg) return;

  // Media downloads/storage are expensive, so reject sequential image/file
  // retries before fetching bytes. Text/location/sticker events go straight to
  // the unique external_msg_id insert, avoiding this extra read on the hot path.
  if (msg.type === "image" || msg.type === "file") {
    const dedupeStartedAt = Date.now();
    const duplicate = await hasProcessedIncomingMessage(admin, conversationId, msg.id);
    phaseTimings.media_dedupe_ms = Date.now() - dedupeStartedAt;
    if (duplicate) {
      console.info("duplicate LINE media webhook ignored before download", { conversationId, messageId: msg.id });
      return;
    }
  }

  // v11: IMAGE — store it so the admin sees it in Omni-Chat, and let the bot (vision) understand it.
  if (msg.type === "image") {
    void startLineLoading(channel.channel_access_token, userId);
    const mediaStartedAt = Date.now();
    const img = await downloadLineImage(channel.channel_access_token, msg.id);
    let url: string | null = null;
    if (img) url = await uploadImageToStorage(admin, conversationId, img.mimeType, img.data);
    phaseTimings.media_ms = Date.now() - mediaStartedAt;
    const custContent = url ? `![image](${url})` : "[ลูกค้าส่งรูปภาพ]";
    const incomingSaveStartedAt = Date.now();
    if (!await saveMessage(admin, conversationId, "customer", custContent, msg.id, { line_message_type: "image", image_url: url, quote_token: msg.quoteToken ?? null }, "image")) return;
    phaseTimings.incoming_save_ms = Date.now() - incomingSaveStartedAt;

    const botFlagStartedAt = Date.now();
    const allowed = await shouldBotReply(admin, conversationId);
    phaseTimings.bot_flags_ms = Date.now() - botFlagStartedAt;
    if (!allowed) return;

    let aiReply: string;
    let quoteCode: string | null = null;
    let ragCalled = false;
    if (!img) {
      aiReply = "ขออภัยค่ะ ตอนนี้เอยเปิดดูรูปไม่ได้ รบกวนพิมพ์ชื่อ/รุ่นสินค้ามาได้ไหมคะ เอยจะช่วยหาให้นะคะ 😊";
    } else {
      const historyStartedAt = Date.now();
      const history = await loadHistory(admin, conversationId);
      const priorHistory = history.slice(0, -1);
      phaseTimings.history_ms = Date.now() - historyStartedAt;
      phaseTimings.before_rag_ms = Date.now() - processingStartedAt;
      const ragStartedAt = Date.now();
      const rag = await callRagChat(
        supabaseUrl, serviceKey, "", priorHistory, conversationId,
        requestId, routingVariant, [img],
      );
      phaseTimings.rag_ms = Date.now() - ragStartedAt;
      ragCalled = true;
      aiReply = sanitizeReply(rag.answer);
      quoteCode = rag.quoteCode;
    }
    let lineReplyMs: number | null = null;
    let replyCompletedAt = Date.now();
    if (aiReply) {
      const quoteStartedAt = Date.now();
      const linkMsg = quoteCode ? await prepareQuoteLink(admin, conversationId, quoteCode) : null;
      phaseTimings.quote_link_ms = Date.now() - quoteStartedAt;
      const replyText = composeQuoteReply(aiReply, linkMsg);
      let delivered = false;
      if (ev.replyToken) {
        const replyStartedAt = Date.now();
        delivered = await replyToLine(channel.channel_access_token, ev.replyToken, replyText);
        const replyAttemptMs = Date.now() - replyStartedAt;
        phaseTimings.line_reply_attempt_ms = replyAttemptMs;
        phaseTimings.line_reply_ok = delivered ? 1 : 0;
        if (delivered) lineReplyMs = replyAttemptMs;
      } else {
        phaseTimings.line_reply_ok = 0;
        console.warn("LINE message event has no reply token", { requestId });
      }
      replyCompletedAt = Date.now();
      if (delivered) {
        const botSaveStartedAt = Date.now();
        await saveMessage(admin, conversationId, "bot", replyText, undefined, {
          channel_id: channel.id, channel_name: channel.name, from_image: true,
          quote_link: Boolean(linkMsg), quote_code: quoteCode,
        });
        phaseTimings.bot_save_ms = Date.now() - botSaveStartedAt;
      }
    }
    if (ragCalled) {
      runInBackground("LINE telemetry", updateLineTelemetry(admin, {
        requestId,
        routingVariant,
        lineReplyMs,
        endToEndMs: replyCompletedAt - eventStartedAt,
        phaseTimings: { ...phaseTimings },
      }));
    }
    return;
  }

  // FILE (PDF / docs) — download it so the admin sees + can open it in Omni-Chat
  // instead of a blank "[file]" line that's easy to miss.
  if (msg.type === "file") {
    const fileName = (msg.fileName && msg.fileName.trim()) || `file-${msg.id}`;
    const dl = await downloadLineFile(channel.channel_access_token, msg.id);
    const stored = dl ? await uploadFileToStorage(admin, conversationId, fileName, dl.mimeType, dl.base64) : null;
    const content = stored ? `📎 ${fileName}` : `[ลูกค้าส่งไฟล์: ${fileName}]`;
    if (!await saveMessage(admin, conversationId, "customer", content, msg.id, {
      line_message_type: "file",
      file_url: null,
      file_bucket: stored?.bucket ?? null,
      file_path: stored?.path ?? null,
      file_name: fileName,
      file_size: msg.fileSize ?? dl?.size ?? null,
      mime_type: dl?.mimeType ?? null,
      quote_token: msg.quoteToken ?? null,
    }, "file")) return;
    return;
  }

  // LOCATION — show as a customer message with a tappable Google Maps link
  // (LINE locations aren't text, so without this they showed a blank "[location]").
  if (msg.type === "location") {
    const lat = msg.latitude, lng = msg.longitude;
    const addr = (msg.address ?? "").trim();
    const mapUrl = (lat != null && lng != null) ? `https://www.google.com/maps?q=${lat},${lng}` : null;
    const content = [`📍 ${msg.title?.trim() || "ตำแหน่งที่ลูกค้าส่ง"}`, addr, mapUrl].filter(Boolean).join("\n");
    if (!await saveMessage(admin, conversationId, "customer", content, msg.id, {
      line_message_type: "location",
      latitude: lat ?? null, longitude: lng ?? null,
      address: addr || null, title: msg.title ?? null,
      map_url: mapUrl,
    })) return;
    return; // no bot auto-reply for a location — staff handle it
  }

  if (msg.type !== "text" || !msg.text) {
    if (!await saveMessage(admin, conversationId, "customer",
      `[${msg.type}] ลูกค้าส่ง ${msg.type === "sticker" ? "sticker" : msg.type}`,
      msg.id, { line_message_type: msg.type, sticker_id: msg.stickerId, package_id: msg.packageId },
      msg.type === "sticker" ? "sticker" : "text")) return;
    return;
  }

  const incomingSaveStartedAt = Date.now();
  if (!await saveMessage(admin, conversationId, "customer", msg.text, msg.id, { quote_token: msg.quoteToken ?? null })) return;
  phaseTimings.incoming_save_ms = Date.now() - incomingSaveStartedAt;

  const botFlagStartedAt = Date.now();
  const allowed = await shouldBotReply(admin, conversationId);
  phaseTimings.bot_flags_ms = Date.now() - botFlagStartedAt;
  if (!allowed) return;

  if (isGenericImageFollowUp(msg.text) && await hasRecentCustomerImage(admin, conversationId)) {
    console.log("suppressing generic text follow-up; recent image handler owns reply", { conversationId, messageId: msg.id });
    return;
  }

  void startLineLoading(channel.channel_access_token, userId);

  const historyStartedAt = Date.now();
  const history = await loadHistory(admin, conversationId);
  const priorHistory = history.slice(0, -1);
  phaseTimings.history_ms = Date.now() - historyStartedAt;
  phaseTimings.before_rag_ms = Date.now() - processingStartedAt;
  const ragStartedAt = Date.now();
  const rag = await callRagChat(
    supabaseUrl, serviceKey, msg.text, priorHistory, conversationId,
    requestId, routingVariant,
  );
  phaseTimings.rag_ms = Date.now() - ragStartedAt;
  const aiReply = sanitizeReply(rag.answer);

  let lineReplyMs: number | null = null;
  let replyCompletedAt = Date.now();
  if (aiReply) {
    // Build the quote link (if any) and send it WITH the reply — the reply API is
    // free, so the link doesn't use the LINE push quota and always goes through.
    const quoteStartedAt = Date.now();
    const linkMsg = rag.quoteCode ? await prepareQuoteLink(admin, conversationId, rag.quoteCode) : null;
    phaseTimings.quote_link_ms = Date.now() - quoteStartedAt;

    const replyText = composeQuoteReply(aiReply, linkMsg);
    let delivered = false;
    if (ev.replyToken) {
      const replyStartedAt = Date.now();
      delivered = await replyToLine(channel.channel_access_token, ev.replyToken, replyText);
      const replyAttemptMs = Date.now() - replyStartedAt;
      phaseTimings.line_reply_attempt_ms = replyAttemptMs;
      phaseTimings.line_reply_ok = delivered ? 1 : 0;
      if (delivered) lineReplyMs = replyAttemptMs;
    } else {
      phaseTimings.line_reply_ok = 0;
      console.warn("LINE message event has no reply token", { requestId });
    }
    replyCompletedAt = Date.now();

    if (delivered) {
      const botSaveStartedAt = Date.now();
      await saveMessage(admin, conversationId, "bot", replyText, undefined, {
        channel_id: channel.id, channel_name: channel.name,
        quote_link: Boolean(linkMsg), quote_code: rag.quoteCode,
      });
      phaseTimings.bot_save_ms = Date.now() - botSaveStartedAt;
    }
  }
  runInBackground("LINE telemetry", updateLineTelemetry(admin, {
    requestId,
    routingVariant,
    lineReplyMs,
    endToEndMs: replyCompletedAt - eventStartedAt,
    phaseTimings: { ...phaseTimings },
  }));
}
