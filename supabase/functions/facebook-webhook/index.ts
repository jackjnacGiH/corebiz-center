/** Meta Page webhook: Messenger Inbox + public post comments. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runDurableChatDelivery } from "../_shared/chat-delivery.mjs";
import {
  cleanPublicCommentAnswer,
  hasPublicEvidence,
  messengerQuickReplies,
  pageEvents,
  shouldAnswerCommentPublicly,
} from "../_shared/facebook-channel.mjs";

import { OWNER_TEST, ownerTestAllowed, safeOwnerTestAnswer, normalizedMessengerProfile } from "../_shared/facebook-owner-test.mjs";

const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const pageId = Deno.env.get("META_PAGE_ID")?.trim() || "";
const pageToken = Deno.env.get("META_PAGE_ACCESS_TOKEN")?.trim() || "";
const appSecret = Deno.env.get("META_APP_SECRET")?.trim() || "";
const verifyToken = Deno.env.get("META_VERIFY_TOKEN")?.trim() || "";
const publicChannelEnabled = Deno.env.get("FACEBOOK_PUBLIC_CHANNEL_ENABLED") === "true";

type PageEvent =
  | { kind: "message"; senderId: string; messageId: string; text: string; contentType?: "image" | "file" | "sticker"; attachmentUrl?: string }
  | { kind: "comment"; commentId: string; postId: string; text: string; authorId: string };
type ClaimedEvent =
  | { kind: "message"; event: Extract<PageEvent, { kind: "message" }>; conversationId: string; incomingId: string }
  | { kind: "comment"; event: Extract<PageEvent, { kind: "comment" }>; conversationId: string; incomingId: string };

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

async function upsertConversation(admin: SupabaseClient, senderId: string, comment?: Extract<PageEvent, { kind: "comment" }>): Promise<string> {
  const { data: existing, error: findError } = await admin.from("chat_conversations")
    .select("id").eq("channel", "messenger").eq("external_id", senderId).maybeSingle();
  if (findError) throw new Error(`conversation_lookup_${findError.code}`);
  if (existing?.id) return existing.id as string;
  const { data, error } = await admin.from("chat_conversations").insert({
    channel: "messenger", external_id: senderId,
    display_name: comment ? `Facebook comment ${comment.commentId.slice(-6)}` : `Facebook ${senderId.slice(-6)}`,
    status: "open", metadata: { page_id: pageId, facebook_surface: comment ? "comment" : "messenger",
      ...(comment ? { comment_id: comment.commentId, post_id: comment.postId } : {}) },
  }).select("id").single();
  if (error?.code === "23505") {
    const { data: raced } = await admin.from("chat_conversations")
      .select("id").eq("channel", "messenger").eq("external_id", senderId).maybeSingle();
    if (raced?.id) return raced.id as string;
  }
  if (error || !data?.id) throw new Error(`conversation_insert_${error?.code ?? "unknown"}`);
  return data.id as string;
}

async function botEnabled(admin: SupabaseClient, conversationId: string, event: PageEvent): Promise<boolean> {
  const [global, channel, conversation] = await Promise.all([
    admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle(),
    admin.from("ai_personas").select("bot_enabled").eq("channel", "messenger").maybeSingle(),
    conversationId
      ? admin.from("chat_conversations").select("id,channel,external_id,metadata,bot_enabled").eq("id", conversationId).maybeSingle()
      : Promise.resolve({ data: { bot_enabled: true }, error: null }),
  ]);
  // A missing Messenger persona is not consent to enable a new channel.
  if (global.error || channel.error || conversation.error || !global.data || !channel.data || !conversation.data) return false;
  return global.data.bot_enabled !== false
    && channel.data.bot_enabled === true
    && conversation.data.bot_enabled !== false
    && (publicChannelEnabled || ownerTestAllowed(pageId, conversation.data, event, OWNER_TEST.commentAuthor, true));
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

async function sendInbox(senderId: string, answer: string): Promise<string[]> {
  const receiptIds: string[] = [];
  const parts = textParts(answer);
  const quickReplies = messengerQuickReplies(answer);
  for (let index = 0; index < parts.length; index++) {
    const receipt = await graphPost(`${pageId}/messages`, {
      recipient: { id: senderId }, messaging_type: "RESPONSE",
      message: {
        text: parts[index],
        ...(index === parts.length - 1 && quickReplies.length ? { quick_replies: quickReplies } : {}),
      },
    });
    if (typeof receipt.message_id !== "string" || !receipt.message_id) throw new Error("graph_missing_message_id_no_retry");
    receiptIds.push(receipt.message_id);
  }
  return receiptIds;
}

async function claimInbox(admin: SupabaseClient, event: Extract<PageEvent, { kind: "message" }>): Promise<ClaimedEvent | null> {
  const conversationId = await upsertConversation(admin, event.senderId);
  let { data, error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: "customer", content: event.text,
    content_type: event.contentType ?? "text", external_msg_id: event.messageId,
    metadata: { page_id: pageId, facebook_bot_status: "pending", delivery_ledger_version: "1",
      ...(event.attachmentUrl ? { image_url: event.contentType === "image" ? event.attachmentUrl : undefined,
        file_url: event.contentType === "file" ? event.attachmentUrl : undefined } : {}) },
  }).select("id").single();
  if (error?.code === "23505") {
    const existing = await admin.from("chat_messages").select("id,metadata")
      .eq("conversation_id", conversationId).eq("external_msg_id", event.messageId).maybeSingle();
    if (["delivered", "skipped"].includes(existing.data?.metadata?.facebook_bot_status)) return null;
    data = existing.data; error = existing.error;
  }
  if (error) throw new Error(`message_insert_${error.code}`);
  if (!data?.id) throw new Error("message_insert_missing_id");
  return { kind: "message", event, conversationId, incomingId: data.id as string };
}

async function setInboxStatus(admin: SupabaseClient, incomingId: string, status: "delivered" | "skipped" | "failed", errorCode?: string, event?: Extract<PageEvent, { kind: "message" }>) {
  const { error } = await admin.from("chat_messages").update({
    metadata: { page_id: pageId, facebook_bot_status: status, delivery_ledger_version: "1",
      ...(event?.attachmentUrl && event.contentType === "image" ? { image_url: event.attachmentUrl } : {}),
      ...(event?.attachmentUrl && event.contentType === "file" ? { file_url: event.attachmentUrl } : {}),
      ...(errorCode ? { error_code: errorCode.slice(0, 80) } : {}) },
  }).eq("id", incomingId);
  if (error) console.error("facebook inbox status update failed", { code: error.code });
}

async function handleInbox(admin: SupabaseClient, claim: Extract<ClaimedEvent, { kind: "message" }>, url: string, serviceKey: string, delivery: any): Promise<void> {
  const { event, conversationId, incomingId } = claim;
  if (event.contentType) { await setInboxStatus(admin, incomingId, "skipped", undefined, event); return; }
  if ((!publicChannelEnabled && OWNER_TEST.ownerAutoTestEnabled !== true) || !await botEnabled(admin, conversationId, event)) {
    await setInboxStatus(admin, incomingId, "skipped");
    return;
  }
  const history = await recentHistory(admin, conversationId, event.messageId);
  if (publicChannelEnabled) await delivery.update("processing", { metadata: { work_started: true } });
  const result = await askCoreBiz(url, serviceKey, event.text, history, publicChannelEnabled ? conversationId : undefined);
  if (!publicChannelEnabled && (!safeOwnerTestAnswer(event.text) || !safeOwnerTestAnswer(result.answer))) { await setInboxStatus(admin, incomingId, "skipped", "owner_test_commitment_guard"); return; }
  if (result.paused) { await setInboxStatus(admin, incomingId, "skipped"); return; }
  if (!String(result.answer ?? "").trim()) throw new Error("empty_bot_answer");
  const link = await quoteLink(admin, result);
  const answer = [String(result.answer).trim(), link].filter(Boolean).join("\n\n");
  // Re-check the kill switch before sending; staff may have taken over while RAG ran.
  if (!await botEnabled(admin, conversationId, event)) { await setInboxStatus(admin, incomingId, "skipped"); return; }
  await delivery.send(answer, { page_id: pageId, rag_request_id: result.request_id ?? null, facebook_surface: "messenger" },
    async (text: string) => { await sendInbox(event.senderId, text); return true; });
  await setInboxStatus(admin, incomingId, "delivered");
}

async function claimComment(admin: SupabaseClient, event: Extract<PageEvent, { kind: "comment" }>): Promise<ClaimedEvent | null> {
  // Save the public conversation before claiming the ledger. A failed inbox
  // write must leave this delivery retryable, rather than silently losing it.
  const conversationId = await upsertConversation(admin, `comment:${pageId}:${event.commentId}`, event);
  const externalId = `facebook-comment:${event.commentId}`;
  let { data: incoming, error: messageError } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: "customer", content: event.text,
    content_type: "text", external_msg_id: externalId,
    metadata: { page_id: pageId, facebook_surface: "comment", comment_id: event.commentId, author_id: event.authorId, delivery_ledger_version: "1",
      post_id: event.postId, facebook_bot_status: "pending" },
  }).select("id").single();
  if (messageError?.code === "23505") {
    const existing = await admin.from("chat_messages").select("id")
      .eq("conversation_id", conversationId).eq("external_msg_id", externalId).maybeSingle();
    incoming = existing.data;
    messageError = existing.error;
  }
  if (messageError || !incoming?.id) throw new Error(`comment_message_insert_${messageError?.code ?? "missing_id"}`);
  let { error } = await admin.from("facebook_comment_events").insert({
    comment_id: event.commentId, page_id: pageId, post_id: event.postId || null,
  });
  if (error?.code === "23505") {
    const existing = await admin.from("facebook_comment_events").select("status").eq("comment_id", event.commentId).maybeSingle();
    if (["replied", "skipped"].includes(existing.data?.status)) return null;
    if (existing.error) throw existing.error;
    error = null;
  }
  if (error) throw new Error(`comment_claim_${error.code}`);
  return { kind: "comment", event, conversationId, incomingId: incoming.id as string };
}

async function handleComment(admin: SupabaseClient, claim: Extract<ClaimedEvent, { kind: "comment" }>, url: string, serviceKey: string, delivery: any): Promise<void> {
  const { event, conversationId, incomingId } = claim;
  const setStatus = async (status: "replied" | "skipped" | "failed", replyId?: string, errorCode?: string) => {
    const { error } = await admin.from("facebook_comment_events").update({
      status, reply_id: replyId ?? null, error_code: errorCode ?? null, updated_at: new Date().toISOString(),
    }).eq("comment_id", event.commentId);
    if (error) console.error("facebook comment status update failed", { code: error.code });
    await admin.from("chat_messages").update({ metadata: {
      page_id: pageId, facebook_surface: "comment", comment_id: event.commentId, author_id: event.authorId, post_id: event.postId, delivery_ledger_version: "1",
      facebook_bot_status: status === "replied" ? "delivered" : status,
      ...(errorCode ? { error_code: errorCode.slice(0, 80) } : {}),
    } }).eq("id", incomingId);
  };
  const publish = async (answer: string, requestId?: unknown) => {
    // Human takeover and global/channel pause apply to public comments too.
    if (!await botEnabled(admin, conversationId, event)) { await setStatus("skipped"); return; }
    const metadata = { page_id: pageId, facebook_surface: "comment", comment_id: event.commentId, author_id: event.authorId,
      post_id: event.postId, rag_request_id: requestId ?? null };
    let replyId = "";
    await delivery.send(answer, metadata, async (text: string) => {
      const response = await graphPost(`${encodeURIComponent(event.commentId)}/comments`, { message: text });
      replyId = String(response.id ?? "");
      if (!replyId) throw new Error("graph_missing_receipt");
      return true;
    });
    await setStatus("replied", replyId);
  };
  try {
    if ((!publicChannelEnabled && OWNER_TEST.ownerAutoTestEnabled !== true) || !await botEnabled(admin, conversationId, event)) {
      await setStatus("skipped"); return;
    }
    if (!publicChannelEnabled && !safeOwnerTestAnswer(event.text)) { await setStatus("skipped", undefined, "owner_test_commitment_guard"); return; }
    if (!shouldAnswerCommentPublicly(event.text)) {
      await publish("ยินดีช่วยค่ะ รบกวนทัก Inbox เพจเพื่อเช็กข้อมูลเฉพาะรายการให้ตรงกับความต้องการนะคะ");
      return;
    }
    // Comments keep the read-only RAG path: never create quotes/customer tasks.
    const query = publicChannelEnabled ? event.text : event.text.slice(OWNER_TEST.commentPrefix.length).replace(/^\s*[:：-]\s*/, "").trim();
    const result = await askCoreBiz(url, serviceKey, query, []);
    if (result.paused) { await setStatus("skipped"); return; }
    const answerText = typeof result.answer === "string" ? result.answer : "";
    const answer = hasPublicEvidence(result, answerText) ? cleanPublicCommentAnswer(answerText) : null;
    if (!answer || (!publicChannelEnabled && !safeOwnerTestAnswer(answer))) { await setStatus("skipped", undefined, "unverified_public_answer"); return; }
    await publish(answer, result.request_id);
  } catch (cause) {
    await setStatus("failed", undefined, (cause as Error).message.slice(0, 80));
    throw cause;
  }
}

async function enrichOwnerProfile(admin: SupabaseClient, conversationId: string, event: PageEvent): Promise<void> {
  if (event.kind !== "message" || event.senderId !== OWNER_TEST.messengerSender || conversationId !== OWNER_TEST.messengerRoom || pageId !== OWNER_TEST.pageId) return;
  const { data: room, error } = await admin.from("chat_conversations").select("id,channel,external_id,metadata,display_name,avatar_url").eq("id", conversationId).maybeSingle();
  if (error || !room || !ownerTestAllowed(pageId, room, event)) return;
  const checked = Number(room.metadata?.messenger_profile_checked_at || 0);
  if (room.metadata?.messenger_profile_version === 2 && Date.now() - checked < 24 * 60 * 60_000) return;
  // Cache attempts as well as success; deny/timeout never blocks message intake.
  const metadata = { ...room.metadata, messenger_profile_checked_at: Date.now(), messenger_profile_version: 2 };
  await admin.from("chat_conversations").update({ metadata }).eq("id", conversationId);
  try {
    const response = await fetch(`${graphBase}/${encodeURIComponent(event.senderId)}?fields=first_name,last_name,profile_pic`, {
      headers: { Authorization: `Bearer ${pageToken}` }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) { await admin.from("chat_conversations").update({ metadata: { ...metadata, messenger_profile_status: `http_${response.status}` } }).eq("id", conversationId); return; }
    const data = await response.json();
    const profile = normalizedMessengerProfile(data);
    let avatarHost: string | null = null;
    try { avatarHost = new URL(data.profile_pic).hostname; } catch { /* absent picture */ }
    const patch: Record<string, unknown> = {};
    // Preserve concurrent nickname edits using compare-and-set below.
    if (profile.name && (room.display_name === `Facebook ${event.senderId.slice(-6)}` || room.display_name === room.metadata?.messenger_profile_name)) patch.display_name = profile.name;
    if (profile.avatar) patch.avatar_url = profile.avatar;
    if (!Object.keys(patch).length) return;
    patch.metadata = { ...metadata, messenger_profile_status: profile.avatar ? "name_and_avatar" : "name_only", messenger_profile_avatar_host: avatarHost, messenger_profile_name: profile.name || room.metadata?.messenger_profile_name };
    await admin.from("chat_conversations").update(patch).eq("id", conversationId).eq("display_name", room.display_name);
  } catch { /* Never log response/profile/token, preserve fallback. */ }
}

async function processEvents(admin: SupabaseClient, events: ClaimedEvent[], url: string, serviceKey: string): Promise<boolean> {
  let failed = false;
  for (const claim of events) {
    try {
      const eventKey = claim.kind === "message" ? `inbox.${claim.event.messageId}` : `comment.${claim.event.commentId}`;
      await runDurableChatDelivery(admin, { channel: "messenger", eventKey,
        process: async (delivery: any) => {
          delivery.conversationId = claim.conversationId;
          if (claim.kind === "message") {
            void enrichOwnerProfile(admin, claim.conversationId, claim.event).catch(() => {});
            await handleInbox(admin, claim, url, serviceKey, delivery);
          } else await handleComment(admin, claim, url, serviceKey, delivery);
        },
        replay: async (delivery: any, row: any) => {
          delivery.conversationId = row.conversation_id;
          if (!await botEnabled(admin, claim.conversationId, claim.event)) { await delivery.update("ignored"); return; }
          await delivery.send(row.reply_text, row.reply_metadata, async (text: string) => {
            if (claim.kind === "message") await sendInbox(claim.event.senderId, text);
            else await graphPost(`${encodeURIComponent(claim.event.commentId)}/comments`, { message: text });
            return true;
          });
          if (claim.kind === "message") await setInboxStatus(admin, claim.incomingId, "delivered");
        },
      });
    } catch (cause) {
      failed = true;
      if (claim.kind === "message") {
        await setInboxStatus(admin, claim.incomingId, "failed", (cause as Error).message, claim.event);
      }
      console.error("facebook event failed", { kind: claim.kind, code: (cause as Error).message });
    }
  }
  return !failed;
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
  const completed = await processEvents(admin, claimed, url, serviceKey);
  return claimFailed || !completed ? json({ ok: false, error: "event_processing_pending" }, 503) : json({ ok: true });
});
