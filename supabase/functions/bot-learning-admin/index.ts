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
      candidate_capture_enabled: safeBoolean(patch.candidate_capture_enabled, Boolean(current.candidate_capture_enabled)),
      memory_ttl_days: clampInt(patch.memory_ttl_days, 7, 365, Number(current.memory_ttl_days)),
      max_context_chars: clampInt(patch.max_context_chars, 160, 1200, Number(current.max_context_chars)),
      updated_at: new Date().toISOString(),
      updated_by: caller.id,
    }).eq("id", true).select("*").single();
    return error ? fail(error.message, 500) : ok({ settings: data });
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
    if (!/^[0-9a-f-]{36}$/i.test(id) || triggerTerms.length === 0 || !guidance) return fail("invalid_review", 400);
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
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid_candidate", 400);
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
