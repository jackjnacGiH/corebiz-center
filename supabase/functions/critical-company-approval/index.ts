import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/staff-auth.mjs";
import { prepareCriticalSourceBinding, SOURCE_PATHS } from "../_shared/prepare-critical-source-binding.mjs";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Existing settings RLS allows owners only. Do not widen it for admins.
    const auth = await requireStaff(admin, req, ["owner"]);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const body = await req.json();
    if (!["preview", "bind"].includes(body.action)) return json({ error: "invalid_action" }, 400);
    const [settings, chunks] = await Promise.all([
      admin.from("org_settings").select("business_name,address").eq("id", true).maybeSingle(),
      admin.from("knowledge_chunks").select("id,source_path,chunk_index,content,content_hash,updated_at,language,visibility").in("source_path", SOURCE_PATHS),
    ]);
    if (settings.error || chunks.error) return json({ error: "source_read_failed" }, 503);
    const prepared = await prepareCriticalSourceBinding(settings.data, chunks.data);
    if (body.action === "preview") return json(prepared);
    // The source values were confirmed by the owner; changed revisions need review.
    if (prepared.digest !== "d6f4d285c0ecfc3cd53d4d8369d6a0b5b7fa6396d8fba919ed18a6365a19a75a") return json({ error: "confirmed_source_revision_changed" }, 409);
    if (body.digest !== prepared.digest) return json({ error: "source_changed_preview_again" }, 409);
    const owner = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } }, auth: { persistSession: false, autoRefreshToken: false } });
    const binding = { ...prepared.binding, records: prepared.binding.records.map(row => ({ ...row, status: "approved", approved_by: auth.actor.id, owner_confirmation_refs: ["Sentinel_675681caa8bc819198fd3b1c1f3f4a2b", "Sentinel_a1b3b302434881918f5e53d3b86d8466"] })) };
    // Use the existing owner-only UPDATE policy; no new RPC grants are needed.
    // The trigger verifies auth.uid() and stamps actual approval time/expiry.
    const result = await owner.from("org_settings").update({ critical_company_master: binding }).eq("id", true).select("critical_company_master").maybeSingle();
    const receipt = result.data?.critical_company_master?.records?.[0];
    if (result.error || receipt?.approved_by !== auth.actor.id
      || !Number.isFinite(Date.parse(receipt?.approved_at))
      || Date.parse(receipt?.valid_until) <= Date.now()
      || !Number.isFinite(Date.parse(receipt?.valid_until))) return json({ error: "binding_not_confirmed" }, 503);
    // This is an approval receipt, never a payment/accounting receipt.
    return json({ state: "bound", approval: { approved_by: receipt.approved_by, approved_at: receipt.approved_at, valid_until: receipt.valid_until }, digest: prepared.digest });
  } catch { return json({ error: "source_binding_unavailable" }, 409); }
});
