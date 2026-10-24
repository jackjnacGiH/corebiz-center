import assert from "node:assert/strict";
import test from "node:test";
import { resolveSourceBinding } from "../supabase/functions/_shared/critical-source-binding.mjs";
import { prepareCriticalSourceBinding } from "../supabase/functions/_shared/prepare-critical-source-binding.mjs";
import { loadApprovedMaster, resolveCriticalReply } from "../supabase/functions/_shared/critical-company-info.mjs";
import { sourceFixture, database, snapshot, conversationId } from "./helpers/critical-company-fixtures.mjs";

test("source references resolve exact fields without duplicate master values", async () => {
  const fixture = await sourceFixture();
  const row = fixture.master.records[0];
  for (const key of ["legal_name", "registered_address", "bank_accounts"]) assert.equal(row[key], undefined);
  const resolved = await loadApprovedMaster(database(fixture));
  assert.equal(resolved.legal_name, fixture.settings.business_name);
  assert.equal(resolved.registered_address, fixture.settings.address);
  assert.deepEqual(resolved.bank_accounts, snapshot().records[0].bank_accounts);
});

test("changed, deleted, extra, conflicting, private or failed sources fail closed", async () => {
  for (const mutate of [
    f => { f.settings.address += " "; }, f => { f.settings.business_name += " altered"; },
    f => { f.chunks[0].content += " "; }, f => { f.chunks[0].content_hash += "changed"; },
    f => { f.chunks[0].updated_at = "2026-02-01"; }, f => { f.chunks[0].id += "new"; },
    f => { f.chunks.pop(); }, f => { f.chunks.push({ ...f.chunks[0], id: "extra" }); },
    f => { f.chunks[0].visibility = "internal"; }, f => { f.sourceError = true; },
    f => { f.master.records[0].fields.account_number[0].end = 999999; },
    f => { f.master.records[0].fields.account_name = f.master.records[0].fields.bank_name; },
  ]) {
    const fixture = await sourceFixture(); mutate(fixture);
    const db = database(fixture);
    assert.equal(await loadApprovedMaster(db), null);
    const result = await resolveCriticalReply(db, { query: "bank details", conversationId, channel: "line", lang: "en" });
    assert.equal(result.state, "queued");
    assert.doesNotMatch(result.answer, /Account number:/);
  }
  assert.equal(await loadApprovedMaster(database({ master: snapshot() })), null, "value snapshots cannot bypass source checks");
});

test("preparation never grants approval and rejects name/bank ambiguity", async () => {
  const fixture = await sourceFixture();
  const prepared = await prepareCriticalSourceBinding(fixture.settings, fixture.chunks);
  assert.equal(prepared.binding.records[0].status, "draft");
  assert.equal(prepared.binding.records[0].approved_by, undefined);
  assert.equal(await loadApprovedMaster(database({ ...fixture, master: prepared.binding })), null);
  const conflict = structuredClone(fixture.chunks); conflict[1].content += "\nบริษัท อื่น จำกัด";
  await assert.rejects(prepareCriticalSourceBinding(fixture.settings, conflict), /conflicting_company_name/);
  const bank = structuredClone(fixture.chunks); bank[0].content += "\n" + bank[0].content;
  await assert.rejects(prepareCriticalSourceBinding(fixture.settings, bank), /ambiguous/);
  assert.ok(await resolveSourceBinding(fixture.master, fixture.settings, fixture.chunks));
});
