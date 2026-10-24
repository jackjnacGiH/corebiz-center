import { prepareCriticalSourceBinding, PAYMENT_SOURCE, LOCATION_SOURCE } from "../../supabase/functions/_shared/prepare-critical-source-binding.mjs";
export const conversationId = "11111111-1111-4111-8111-111111111111";
export const approver = { id: "22222222-2222-4222-8222-222222222222", role: "owner", is_active: true };
export const taskId = "33333333-3333-4333-8333-333333333333";
// Synthetic, deliberately invalid as a real receiving account. No production
// company, address, bank or account value is included in the test fixtures.
export function snapshot() {
  return { schema_version: 1, records: [{
    status: "approved", active: true, revision: "test-revision",
    approved_by: approver.id, approved_at: "2026-01-01T00:00:00Z", valid_until: "2099-01-01T00:00:00Z",
    source_ref: "test-only approval record",
    legal_name: "บริษัท ตัวอย่างทดสอบ (สังเคราะห์) จำกัด",
    registered_address: "ที่อยู่ทดสอบบรรทัดหนึ่ง\nที่อยู่ทดสอบบรรทัดสอง",
    bank_accounts: [{ bank_name: "ธนาคารสังเคราะห์", account_name: "บริษัท ตัวอย่างทดสอบ (สังเคราะห์) จำกัด", account_type: "ออมทรัพย์", account_number: '0'.repeat(3) + '-' + '0'.repeat(7) }],
  }] };
}

export function database(options = {}) {
  const tasks = new Map(), calls = [], reads = [];
  const admin = {
    calls, reads, tasks,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name !== "agent_propose") throw Error(`Unexpected RPC: ${name}`);
      if (options.rpcThrow) throw Error("network outcome unknown");
      if (options.rpcError) return { data: null, error: { code: "TEST" } };
      if (options.emptyReceipt) return { data: null, error: null };
      const prior = tasks.get(args.p_dedupe_key);
      const id = prior?.id ?? (tasks.size === 0 ? taskId : crypto.randomUUID());
      tasks.set(args.p_dedupe_key, {
        id, kind: args.p_kind, related_id: args.p_related_id, dedupe_key: args.p_dedupe_key,
        status: options.taskStatus ?? "proposed", reviewed_by: options.reviewed ? approver.id : null,
        reviewed_at: options.reviewed ? "2026-01-01T00:00:00Z" : null,
      });
      return { data: id, error: null };
    },
    from(table) {
      reads.push(table);
      let id;
      return {
        select() { return this; },
        eq(_key, value) { id = value; return this; },
        async in() { return { data: options.chunks ?? [], error: options.sourceError ? { code: "TEST" } : null }; },
        async maybeSingle() {
          if (table === "org_settings") return { data: { ...options.settings, critical_company_master: options.master ?? null }, error: options.masterError ? { code: "TEST" } : null };
          if (table === "profiles") return { data: options.approver ?? approver, error: null };
          if (table === "agent_tasks") return {
            data: options.readMissing ? null : options.wrongReceipt ? { id } : [...tasks.values()].find(task => task.id === id),
            error: options.readError ? { code: "TEST" } : null,
          };
          throw Error(`Unexpected read: ${table}`);
        },
      };
    },
  };
  return admin;
}

export async function sourceFixture() {
  const row = snapshot().records[0], bank = row.bank_accounts[0];
  const settings = { business_name: row.legal_name, address: row.registered_address };
  const chunks = [
    { id: "payment-test", source_path: PAYMENT_SOURCE, chunk_index: 0, content: `${row.legal_name}\n-ธ.${bank.bank_name} เลขที่ ${bank.account_number} (ออมทรัพย์)`, content_hash: "synthetic-payment", updated_at: "2026-01-01T00:00:00+00:00", language: "th", visibility: "public" },
    { id: "location-test", source_path: LOCATION_SOURCE, chunk_index: 0, content: row.legal_name, content_hash: "synthetic-location", updated_at: "2026-01-01T00:00:00+00:00", language: "th", visibility: "public" },
  ];
  const { binding } = await prepareCriticalSourceBinding(settings, chunks);
  Object.assign(binding.records[0], { status: "approved", approved_by: approver.id, approved_at: row.approved_at, valid_until: row.valid_until });
  return { master: binding, settings, chunks };
}
