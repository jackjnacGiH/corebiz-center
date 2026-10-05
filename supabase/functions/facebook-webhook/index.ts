/** Meta Page webhook: Messenger Inbox + public post comments. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanPublicCommentAnswer,
  hasPublicEvidence,
  messengerQuickReplies,
  pageEvents,
  shouldAnswerCommentPublicly,
} from "../_shared/facebook-channel.mjs";

const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const pageId = Deno.env.get("META_PAGE_ID")?.trim() || "";
const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN")?.trim() || "";
const appSecret = Deno.env.get("META_APP_SECRET")?.trim() || "";
const verifyToken = Deno.env.get("META_VERIFY_TOKEN")?.trim() || "";

type PageEvent =
  | { kind: "message"; senderId: string; messageId: string; text: string; contentType?: "image" | "file" | "sticker"; attachmentUrl?: string }
  | { kind: "comment"; commentId: string; postId: string; text: string };
type ClaimedEvent =
  | { kind: "message"; event: Extract<PageEvent, { kind: "message" }>; conversationId: string; incomingId: string }
  | { kind: "comment"; event: Extract<PageEvent, { kind: "comment" }> };

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function validSignature(body: string, header: string): Promise<boolean> {
  if (!appSecret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const encoded = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoded.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoded.encode(body)));
  const provided = header.slice(7).toLowerCase();
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ Number.parseInt(provided.slice(i * 2, i * 2 + 2), 16);
  return diff === 0;
}

async function graphPost(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${graphBase}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`graph_${response.status}`);
  return data;
}

async function upsertConversation(admin: SupabaseClient, senderId: string): Promise<string> {
  const { data: existing, error: findError } = await admin.from("chat_conversations")
    .select("id").eq("channel", "messenger").eq("external_id", senderId).maybeSingle();
  if (findError) throw new Error(`conversation_lookup_${findError.code}`);
  if (existing?.id) return existing.id as string;
  const { data, error } = await admin.from("chat_conversations").insert({
    channel: "messenger", external_id: senderId,
    display_name: `Facebook ${senderId.slice(-6)}`,
    status: "open", metadata: { page_id: pageId },
  }).select("id").single();
  if (error?.code === "23505") {
    const { data: raced } = await admin.from("chat_conversations")
      .select("id").eq("channel", "messenger").eq("external_id", senderId).maybeSingle();
    if (raced?.id) return raced.id as string;
  }
  if (error || !data?.id) throw new Error(`conversation_insert_${error?.code ?? "unknown"}`);
  return data.id as string;
}

async function botEnabled(admin: SupabaseClient, conversationId?: string): Promise<boolean> {
  const [global, channel, conversation] = await Promise.all([
    admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle(),
    admin.from("ai_personas").select("bot_enabled").eq("channel", "messenger").maybeSingle(),
    conversationId
      ? admin.from("chat_conversations").select("bot_enabled").eq("id", conversationId).maybeSingle()
      : Promise.resolve({ data: { bot_enabled: true }, error: null }),
  ]);
  // A missing Messenger persona is not consent to enable a new channel.
  if (global.error || channel.error || conversation.error || !global.data || !channel.data || !conversation.data) return false;
  return global.data.bot_enabled !== false
    && channel.data.bot_enabled === true
    && conversation.data.bot_enabled !== false;
}

async function recentHistory(admin: SupabaseClient, conversationId: string, currentMessageId: string) {
  const { data, error } = await admin.from("chat_messages")
    .select("sender_type,content,external_msg_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(24);
  if (error) throw new Error(`history_${error.code}`);
  const rows = (data ?? []).reverse();
  const currentIndex = rows.findIndex((row) => row.external_msg_id === currentMessageId);
  return (currentIndex >= 0 ? rows.slice(0, currentIndex) : [])
    .filter((row) => ["customer", "bot", "agent"].includes(row.sender_type))
    .map((row) => ({ role: row.sender_type === "customer" ? "user" : "assistant", content: String(row.content).slice(0, 1_200) }))
    .slice(-16);
}

async function askCoreBiz(url: string, serviceKey: string, query: string, history: Array<{ role: string; content: string }>, conversationId?: string) {
  const response = await fetch(`${url}/functions/v1/rag-chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query, history, channel: "messenger", stream: false,
      ...(conversationId ? { conversation_id: conversationId } : { read_only: true }),
    }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.error) throw new Error(`rag_chat_${response.status}`);
  return result;
}

async function quoteLink(admin: SupabaseClient, result: Record<string, unknown>): Promise<string | null> {
  const calls = Array.isArray(result.tool_calls) ? result.tool_calls as Array<Record<string, unknown>> : [];
  for (const call of calls) {
    if (call.name !== "request_quote") continue;
    const summary = String(call.result_summary ?? "");
    if (!/"quote_created":true/.test(summary)) continue;
    const code = /"quote_code":\s*"(QT-[^"]+)"/.exec(summary)?.[1];
    if (!code) continue;
    const { data } = await admin.from("quotes").select("public_token").eq("code", code).maybeSingle();
    if (data?.public_token) return `📄 ใบเสนอราคา ${code}\nhttps://www.jnac.online/center/q/${data.public_token}`;
  }
  return null;
}

function textParts(text: string): string[] {
  const clean = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$2").trim();
  const parts: string[] = [];
  for (let index = 0; index < clean.length; index += 1_900) parts.push(clean.slice(index, index + 1_900));
  return parts.slice(0, 5);
}

async function sendInbox(senderId: string, answer: string): Promise<void> {
  const parts = textParts(answer);
  const quickReplies = messengerQuickReplies(answer);
  for (let index = 0; index < parts.length; index++) {
    await graphPost(`${pageId}/messages`, {
      recipient: { id: senderId }, messaging_type: "RESPONSE",
      message: {
        text: parts[index],
        ...(index === parts.length - 1 && quickReplies.length ? { quick_replies: quickReplies } : {}),
      },
    });
  }
}

async function claimInbox(admin: SupabaseClient, event: Extract<PageEvent, { kind: "message" }>): Promise<ClaimedEvent | null> {
  const conversationId = await upsertConversation(admin, event.senderId);
  const { data, error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: "customer", content: event.text,
    content_type: event.contentType ?? "text", external_msg_id: event.messageId,
    metadata: { page_id: pageId, facebook_bot_status: "pending",
      ...(event.attachmentUrl ? { image_url: event.contentType === "image" ? event.attachmentUrl : undefined,
        file_url: event.contentType === "file" ? event.attachmentUrl : undefined } : {}) },
  }).select("id").single();
  if (error?.code === "23505") return null;
  if (error) throw new Error(`message_insert_${error.code}`);
  if (!data?.id) throw new Error("message_insert_missing_id");
  return { kind: "message", event, conversationId, incomingId: data.id as string };
}

async function setInboxStatus(admin: SupabaseClient, incomingId: string, status: "delivered" | "skipped" | "failed", errorCode?: string, event?: Extract<PageEvent, { kind: "message" }>) {
  const { error } = await admin.from("chat_messages").update({
    metadata: { page_id: pageId, facebook_bot_status: status,
      ...(event?.attachmentUrl && event.contentType === "image" ? { image_url: event.attachmentUrl } : {}),
      ...(event?.attachmentUrl && event.contentType === "file" ? { file_url: event.attachmentUrl } : {}),
      ...(errorCode ? { error_code: errorCode.slice(0, 80) } : {}) },
  }).eq("id", incomingId);
  if (error) console.error("facebook inbox status update failed", { code: error.code });
}

async function handleInbox(admin: SupabaseClient, claim: Extract<ClaimedEvent, { kind: "message" }>, url: string, serviceKey: string): Promise<void> {
  const { event, conversationId, incomingId } = claim;
  if (event.contentType) { await setInboxStatus(admin, incomingId, "skipped", undefined, event); return; }
  if (Deno.env.get("FACEBOOK_BOT_ENABLED") !== "true" || !await botEnabled(admin, conversationId)) {
    await setInboxStatus(admin, incomingId, "skipped");
    return;
  }
  const history = await recentHistory(admin, conversationId, event.messageId);
  const result = await askCoreBiz(url, serviceKey, event.text, history, conversationId);
  if (result.paused) { await setInboxStatus(admin, incomingId, "skipped"); return; }
  if (!String(result.answer ?? "").trim()) throw new Error("empty_bot_answer");
  const link = await quoteLink(admin, result);
  const answer = [String(result.answer).trim(), link].filter(Boolean).join("\n\n");
  // Re-check the kill switch before sending; staff may have taken over while RAG ran.
  if (!await botEnabled(admin, conversationId)) { await setInboxStatus(admin, incomingId, "skipped"); return; }
  const pendingMetadata = { page_id: pageId, rag_request_id: result.request_id ?? null, messenger_push_pending: true };
  const { data: outgoing, error: saveError } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: "bot", content: answer,
    metadata: pendingMetadata,
  }).select("id").single();
  if (saveError || !outgoing?.id) throw new Error(`bot_message_insert_${saveError?.code ?? "missing_id"}`);
  try {
    await sendInbox(event.senderId, answer);
  } catch (cause) {
    await admin.from("chat_messages").update({
      metadata: { page_id: pageId, rag_request_id: result.request_id ?? null, messenger_push_failed: true },
    }).eq("id", outgoing.id);
    throw cause;
  }
  const { error: deliveredError } = await admin.from("chat_messages").update({
    metadata: { page_id: pageId, rag_request_id: result.request_id ?? null },
  }).eq("id", outgoing.id);
  if (deliveredError) console.error("facebook delivered message status update failed", { code: deliveredError.code });
  await setInboxStatus(admin, incomingId, "delivered");
}

async function claimComment(admin: SupabaseClient, event: Extract<PageEvent, { kind: "comment" }>): Promise<ClaimedEvent | null> {
  const { error } = await admin.from("facebook_comment_events").insert({
    comment_id: event.commentId, page_id: pageId, post_id: event.postId || null,
  });
  if (error?.code === "23505") return null;
  if (error) throw new Error(`comment_claim_${error.code}`);
  return { kind: "comment", event };
}

async function handleComment(admin: SupabaseClient, event: Extract<PageEvent, { kind: "comment" }>, url: string, serviceKey: string): Promise<void> {
  const setStatus = async (status: "replied" | "skipped" | "failed", replyId?: string, errorCode?: string) => {
    await admin.from("facebook_comment_events").update({
      status, reply_id: replyId ?? null, error_code: errorCode ?? null, updated_at: new Date().toISOString(),
    }).eq("comment_id", event.commentId);
  };
  try {
    if (Deno.env.get("FACEBOOK_COMMENT_BOT_ENABLED") !== "true" || !await botEnabled(admin)) {
      await setStatus("skipped");
      return;
    }
    if (!shouldAnswerCommentPublicly(event.text)) {
      const response = await graphPost(`${encodeURIComponent(event.commentId)}/comments`, {
        message: "ยินดีช่วยค่ะ รบกวนทัก Inbox เพจเพื่อเช็กข้อมูลเฉพาะรายการให้ตรงกับความต้องการนะคะ",
      });
      await setStatus("replied", String(response.id ?? ""));
      return;
    }
    const result = await askCoreBiz(url, serviceKey, event.text, []);
    if (result.paused) { await setStatus("skipped"); return; }
    const answer = hasPublicEvidence(result, result.answer) ? cleanPublicCommentAnswer(result.answer) : null;
    if (!answer) { await setStatus("skipped", undefined, "unverified_public_answer"); return; }
    if (!await botEnabled(admin)) { await setStatus("skipped"); return; }
    const response = await graphPost(`${encodeURIComponent(event.commentId)}/comments`, { message: answer });
    await setStatus("replied", String(response.id ?? ""));
  } catch (cause) {
    await setStatus("failed", undefined, (cause as Error).message.slice(0, 80));
    throw cause;
  }
}

async function processEvents(admin: SupabaseClient, events: ClaimedEvent[], url: string, serviceKey: string): Promise<void> {
  for (const claim of events) {
    try {
      if (claim.kind === "message") await handleInbox(admin, claim, url, serviceKey);
      else await handleComment(admin, claim.event, url, serviceKey);
    } catch (cause) {
      if (claim.kind === "message") {
        await setInboxStatus(admin, claim.incomingId, "failed", (cause as Error).message, claim.event);
      }
      console.error("facebook event failed", { kind: claim.kind, code: (cause as Error).message });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    if (!verifyToken || params.get("hub.mode") !== "subscribe" || params.get("hub.verify_token") !== verifyToken) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!pageId || !pageToken || !appSecret) return json({ ok: false, error: "facebook_not_configured" }, 503);
  const raw = await req.text();
  if (!await validSignature(raw, req.headers.get("x-hub-signature-256") ?? "")) {
    return json({ ok: false, error: "invalid_signature" }, 401);
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const events = pageEvents(payload, pageId) as PageEvent[];
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const claims = await Promise.allSettled(events.map((event) =>
    event.kind === "message" ? claimInbox(admin, event) : claimComment(admin, event)));
  const claimed = claims.flatMap((claim) => claim.status === "fulfilled" && claim.value ? [claim.value] : []);
  const claimFailed = claims.some((claim) => claim.status === "rejected");
  if (claimFailed) console.error("facebook event claim failed", { count: claims.filter((claim) => claim.status === "rejected").length });
  const task = processEvents(admin, claimed, url, serviceKey);
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else await task;
  return claimFailed ? json({ ok: false, error: "event_claim_failed" }, 503) : json({ ok: true });
});
