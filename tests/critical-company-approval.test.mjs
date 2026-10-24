import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const digest = "d6f4d285c0ecfc3cd53d4d8369d6a0b5b7fa6396d8fba919ed18a6365a19a75a";

function runtime(options = {}) {
  let handler, writes = 0;
  const admin = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: {}, error: options.readError }; }, async in() { return { data: [], error: options.readError }; } }; } };
  const owner = { from(name) { assert.equal(name, "org_settings"); return { update(value) { writes++; assert.equal(value.critical_company_master.records[0].approved_by, "authenticated-owner"); return this; }, eq() { return this; }, select() { return this; }, async maybeSingle() { return { data: options.emptyReceipt ? null : { critical_company_master: { records: [{ approved_by: "authenticated-owner", approved_at: new Date().toISOString(), valid_until: "2099-01-01T00:00:00Z" }] } }, error: options.rpcError }; } }; } };
  const code = stripTypeScriptTypes(readFileSync(new URL("../supabase/functions/critical-company-approval/index.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gmu, ""));
  new Function("Deno", "createClient", "requireStaff", "prepareCriticalSourceBinding", "SOURCE_PATHS", code)(
    { env: { get: key => key }, serve: fn => { handler = fn; } },
    (_url, key) => key === "SUPABASE_SERVICE_ROLE_KEY" ? admin : owner,
    async (_admin, _req, roles) => { assert.deepEqual(roles, ["owner"]); return options.authError ? { error: "forbidden", status: 403 } : { actor: { id: "authenticated-owner" } }; },
    async () => ({ binding: { schema_version: 2, records: [{ status: "draft" }] }, preview: { legal_name: "synthetic" }, digest: options.changed ? "changed" : digest }), []);
  return { writes: () => writes, async request(body) { const response = await handler(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(body) })); return { status: response.status, body: await response.json() }; } };
}
test("approval preview is read-only; owner-only binding checks exact confirmed preview digest", async () => {
  const preview = runtime(); assert.equal((await preview.request({ action: "preview" })).status, 200); assert.equal(preview.writes(), 0);
  for (const options of [{ authError: true }, { readError: true }, { changed: true }, {}]) {
    const run = runtime(options); const result = await run.request({ action: "bind", digest: options.changed ? "changed" : "stale" });
    assert.notEqual(result.status, 200); assert.equal(run.writes(), 0);
  }
  const success = runtime(); const result = await success.request({ action: "bind", digest });
  assert.equal(result.body.state, "bound"); assert.equal(success.writes(), 1);
  const failure = runtime({ rpcError: true }); assert.equal((await failure.request({ action: "bind", digest })).status, 503);
  const missing = runtime({ emptyReceipt: true }); assert.equal((await missing.request({ action: "bind", digest })).status, 503);
});
