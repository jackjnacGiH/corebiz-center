/**
 * Staff-only administration for the guarded bot learning loop.
 *
 * Browser clients never read the learning tables directly. This function
 * verifies the caller, checks the same staff role used by RLS, and executes
 * every setting/review change with the service role. Approved guidance still
 * passes a second runtime guard inside rag-chat before it can affect a reply.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeConversationState,
  redactConversationMemoryText,
} from "../_shared/conversation-memory.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...CORS },
});
const ok = (extra: Record<string, unknown> = {}) => json({ ok: true, ...extra });
const fail = (error: string, status = 200) => json({ ok: false, error }, status);
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const safeBoolean = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

type Caller = { id: string; role: "owner" | "admin" | "staff" };

async function requireStaff(admin: SupabaseClient, req: Request): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: identity, error: identityError } = await admin.auth.getUser(token);
  if (identityError || !identity?.user) return null;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", identity.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.is_active !== true) return null;
  const role = String(profile.role ?? "");
  if (!(["owner", "admin", "staff"] as const).includes(role as Caller["role"])) return null;
  return { id: String(profile.id), role: role as Caller["role"] };
}

function isSafeGuidance(value: string): boolean {
  return !/(?:\bcost\b|\bmargin\b|\bprice\b|\bstock\b|\binventory\b|\bPO\b|purchase\s*order|bank\s*account|payment|address|e-?mail|phone|ราคา|ราคาทุน|สต็อก|คงเหลือ|จำนวน|ใบสั่งซื้อ|บัญชีธนาคาร|ชำระเงิน|ที่อยู่|อีเมล|เบอร์โทร)/iu.test(value);
}

function normalizeTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((term) => String(term).trim()).filter(Boolean))].slice(0, 8);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeStaffMemoryNote(value: string): boolean {
  if (!value) return true;
  const restrictedLabel = /(?:\b(?:cost|margin|price|stock|inventory|purchase\s*order|password|secret|token|bank\s*account|payment|address|e-?mail|phone)\b|ราคาทุน|กำไร|ราคา|สต็อก|คงเหลือ|ใบสั่งซื้อ|รหัสผ่าน|โทเคน|บัญชีธนาคาร|ชำระเงิน|ที่อยู่|อีเมล|เบอร์โทร|เลขผู้เสียภาษี)/iu;
  const emailValue = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}\b/iu;
  const thaiPhoneValue = /(?:^|[^\d])(?:(?:\+|00)?66|0)(?:[\s./()-]*\d){8,9}(?:[^\d]|$)/u;
  const taxIdValue = /(?:^|[^\d])(?:\d[\s./()_-]*){12}\d(?:[^\d]|$)/u;
  const moneyValue = /(?:฿\s*\d|\d[\d,.]*\s*(?:บาท|THB))/iu;
  return ![restrictedLabel, emailValue, thaiPhoneValue, taxIdValue, moneyValue]
    .some((pattern) => pattern.test(value));
}

function safeMemoryText(value: unknown, max: number): string {
  return redactConversationMemoryText(value, max * 2)
    .replace(/\[(?:image|email|phone|link|sensitive-number|restricted-detail)\]/giu, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeMemoryList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeMemoryText(item, 160)).filter(Boolean))].slice(0, maxItems);
}

function memoryView(row: Record<string, unknown> | null) {
  if (!row) return null;
  const rawState = row.structured_state && typeof row.structured_state === "object"
    ? row.structured_state as Record<string, unknown>
    : {};
  const state = normalizeConversationState(rawState);
  return {
    summary: safeMemoryText(row.summary, 1200),
    topics: safeMemoryList(row.topics),
    active_intent: state.active_intent ?? "",
    products: state.products,
    application: state.application ?? "",
    machine: state.machine ?? "",
    material: state.material ?? "",
    confirmed_facts: state.confirmed_facts,
    pending_questions: state.pending_questions.slice(0, 5),
    preferences: state.preferences,
    last_action: state.last_action ?? "",
    staff_note: safeMemoryText(row.staff_note, 1000),
    staff_locked: row.staff_locked === true,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const caller = await requireStaff(admin, req);
  if (!caller) return fail("forbidden", 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("invalid_request", 400); }
  const action = String(body.action ?? "");

  if (action === "get_settings") {
    const { data, error } = await admin.from("bot_learning_settings").select("*").eq("id", true).single();
    return error ? fail(error.message, 500) : ok({ settings: data });
  }

  if (action === "update_settings") {
    const patch = (body.settings && typeof body.settings === "object") ? body.settings as Record<string, unknown> : {};
    const { data: current, error: readError } = await admin.from("bot_learning_settings").select("*").eq("id", true).single();
    if (readError || !current) return fail(readError?.message ?? "settings_not_found", 500);
    const { data, error } = await admin.from("bot_learning_settings").update({
      enabled: safeBoolean(patch.enabled, Boolean(current.enabled)),
      context_memory_enabled: safeBoolean(patch.context_memory_enabled, Boolean(current.context_memory_enabled)),
      structured_memory_enabled: safeBoolean(
        patch.structured_memory_enabled,
        Boolean(current.structured_memory_enabled),
      ),
      candidate_capture_enabled: safeBoolean(patch.candidate_capture_enabled, Boolean(current.candidate_capture_enabled)),
      memory_ttl_days: clampInt(patch.memory_ttl_days, 7, 365, Number(current.memory_ttl_days)),
      max_context_chars: clampInt(patch.max_context_chars, 160, 1200, Number(current.max_context_chars)),
      updated_at: new Date().toISOString(),
      updated_by: caller.id,
    }).eq("id", true).select("*").single();
    return error ? fail(error.message, 500) : ok({ settings: data });
  }

  if (action === "get_conversation_memory") {
    const conversationId = String(body.conversation_id ?? "").trim();
    if (!UUID_RE.test(conversationId)) return fail("invalid_conversation", 400);
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("bot_conversation_memory")
      .select("summary, topics, structured_state, staff_note, staff_locked, updated_at, expires_at")
      .eq("conversation_id", conversationId)
      .gt("expires_at", now)
      .maybeSingle();
    return error ? fail("memory_read_failed", 500) : ok({ memory: memoryView(data as Record<string, unknown> | null) });
  }

  if (action === "update_conversation_memory") {
    const conversationId = String(body.conversation_id ?? "").trim();
    if (!UUID_RE.test(conversationId)) return fail("invalid_conversation", 400);
    const staffNote = safeMemoryText(body.staff_note, 1000);
    if (!isSafeStaffMemoryNote(staffNote)) return fail("unsafe_memory_note", 400);
    const staffLocked = body.staff_locked === true;

    const { data: conversation, error: conversationError } = await admin
      .from("chat_conversations")
      .select("id, channel")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) return fail("conversation_read_failed", 500);
    if (!conversation) return fail("conversation_not_found", 404);

    const { data: current, error: currentError } = await admin
      .from("bot_conversation_memory")
      .select("conversation_id, locked_fields, expires_at")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (currentError) return fail("memory_read_failed", 500);
    if (current?.expires_at && Date.parse(String(current.expires_at)) <= Date.now()) {
      return fail("memory_expired", 410);
    }

    const lockedFields = Array.isArray(current?.locked_fields)
      ? current.locked_fields.map((field) => String(field)).filter(Boolean).slice(0, 32)
      : [];
    const { data: written, error: writeError } = await admin.rpc(
      "set_bot_conversation_memory_staff_control",
      {
        p_conversation_id: conversationId,
        p_locked_fields: lockedFields,
        p_staff_note: staffNote || null,
        p_staff_locked: staffLocked,
      },
    );
    if (writeError) return fail("memory_write_failed", 500);
    if (written !== true) return fail("conversation_not_found", 404);

    const { data: saved, error: savedError } = await admin
      .from("bot_conversation_memory")
      .select("summary, topics, structured_state, staff_note, staff_locked, updated_at, expires_at")
      .eq("conversation_id", conversationId)
      .gt("expires_at", new Date().toISOString())
      .single();
    return savedError
      ? fail("memory_read_failed", 500)
      : ok({ memory: memoryView(saved as Record<string, unknown>) });
  }

  if (action === "list_candidates") {
    const requestedStatus = String(body.status ?? "pending");
    const status = ["pending", "approved", "dismissed", "all"].includes(requestedStatus) ? requestedStatus : "pending";
    const limit = clampInt(body.limit, 1, 100, 40);
    let query = admin.from("bot_learning_candidates").select("*").order("last_seen_at", { ascending: false }).limit(limit);
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    return error ? fail(error.message, 500) : ok({ candidates: data ?? [] });
  }

  if (action === "approve_candidate") {
    const id = String(body.id ?? "");
    const review = (body.review && typeof body.review === "object") ? body.review as Record<string, unknown> : {};
    const triggerTerms = normalizeTerms(review.trigger_terms);
    const guidance = String(review.approved_guidance ?? "").trim().slice(0, 1200);
    const reviewNote = String(review.review_note ?? "").trim().slice(0, 1000) || null;
    if (!UUID_RE.test(id) || triggerTerms.length === 0 || !guidance) return fail("invalid_review", 400);
    if (!isSafeGuidance(guidance)) return fail("unsafe_guidance", 400);
    const now = new Date().toISOString();
    const { data, error } = await admin.from("bot_learning_candidates").update({
      status: "approved", trigger_terms: triggerTerms, approved_guidance: guidance, review_note: reviewNote,
      reviewed_by: caller.id, reviewed_at: now, updated_at: now,
    }).eq("id", id).select("id").maybeSingle();
    return error || !data ? fail(error?.message ?? "candidate_not_found", error ? 500 : 404) : ok();
  }

  if (action === "dismiss_candidate") {
    const id = String(body.id ?? "");
    if (!UUID_RE.test(id)) return fail("invalid_candidate", 400);
    const reviewNote = String(body.review_note ?? "").trim().slice(0, 1000) || null;
    const now = new Date().toISOString();
    const { data, error } = await admin.from("bot_learning_candidates").update({
      status: "dismissed", trigger_terms: [], approved_guidance: null, review_note: reviewNote,
      reviewed_by: caller.id, reviewed_at: now, updated_at: now,
    }).eq("id", id).select("id").maybeSingle();
    return error || !data ? fail(error?.message ?? "candidate_not_found", error ? 500 : 404) : ok();
  }

  return fail("unknown_action", 400);
});
