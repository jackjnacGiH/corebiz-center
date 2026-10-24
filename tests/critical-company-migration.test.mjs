import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { approver, sourceFixture } from "./helpers/critical-company-fixtures.mjs";
const pgliteModule = process.env.COREBIZ_PGLITE_MODULE || "@electric-sql/pglite";

// Optional local PostgreSQL-compatible engine; never connects to Supabase.
// Set COREBIZ_PGLITE_MODULE to a local @electric-sql/pglite module entry point.
test("master migration is idempotent, leaves values unapproved and preserves existing policies", async () => {
  const { PGlite } = await import(pgliteModule);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.org_settings(id boolean primary key, company_name text);
      insert into public.org_settings values (true, 'Synthetic existing seller');
      alter table public.org_settings enable row level security;
      create policy existing_public_read on public.org_settings for select using (true);`);
    const before = await db.query("select policyname,cmd,qual from pg_policies where tablename='org_settings'");
    const migration = readFileSync(new URL("../supabase/migrations/20261024090211_critical_company_master.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query("select * from public.org_settings")).rows, [{ id: true, company_name: "Synthetic existing seller", critical_company_master: null }]);
    assert.deepEqual((await db.query("select policyname,cmd,qual from pg_policies where tablename='org_settings'")).rows, before.rows);
    const column = (await db.query("select data_type,column_default,is_nullable from information_schema.columns where table_name='org_settings' and column_name='critical_company_master'")).rows[0];
    assert.deepEqual(column, { data_type: "jsonb", column_default: null, is_nullable: "YES" });
  } finally { await db.close(); }
});

test("a settings writer cannot forge an owner's master approval UUID", async () => {
  const { PGlite } = await import(pgliteModule);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create table public.profiles(id uuid primary key, role text, is_active boolean);
      create table public.org_settings(id boolean primary key, company_name text);
      insert into public.org_settings values(true,'Synthetic existing seller');`);
    await db.query("insert into public.profiles values($1,'owner',true),($2,'staff',true)", [approver.id, "44444444-4444-4444-8444-444444444444"]);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261024090211_critical_company_master.sql", import.meta.url), "utf8"));
    const master = (await sourceFixture()).master;
    const update = () => db.query("update public.org_settings set critical_company_master=$1::jsonb where id=true", [JSON.stringify(master)]);
    await assert.rejects(update(), /owner_approval_required/); // No authenticated owner, including service-role jobs.
    await db.query("select set_config('test.actor',$1,false)", ["44444444-4444-4444-8444-444444444444"]);
    await assert.rejects(update(), /owner_approval_required/); // Staff tries to reuse the owner's UUID.
    await db.query("select set_config('test.actor',$1,false)", [approver.id]);
    const wrongApprover = structuredClone(master); wrongApprover.records[0].approved_by = "44444444-4444-4444-8444-444444444444";
    await assert.rejects(db.query("update public.org_settings set critical_company_master=$1::jsonb where id=true", [JSON.stringify(wrongApprover)]), /approver_mismatch/);
    await update();
    const saved = (await db.query("select critical_company_master from public.org_settings")).rows[0].critical_company_master;
    assert.equal(saved.records[0].approved_by, approver.id);
    assert.deepEqual(saved.records[0].sources, master.records[0].sources);
    assert.notEqual(saved.records[0].approved_at, master.records[0].approved_at);
    const forged = structuredClone(master); Object.assign(forged.records[0], { approved_by: "44444444-4444-4444-8444-444444444444", legal_name: "FORGED_COPY" });
    await assert.rejects(db.query("update public.org_settings set critical_company_master=$1::jsonb where id=true", [JSON.stringify(forged)]), /source_binding_required/);
    await db.query("select set_config('test.actor','',false)");
    await assert.rejects(db.query("update public.org_settings set critical_company_master=null where id=true"), /owner_approval_required/);
    await db.query("update public.org_settings set company_name='Unrelated settings still work' where id=true");
  } finally { await db.close(); }
});

test("turn-lease migration preserves bot controls and compare-and-swap excludes a second claimant", async () => {
  const { PGlite } = await import(pgliteModule);
  const db = new PGlite();
  try {
    await db.exec("create table public.chat_conversations(id text primary key, bot_enabled boolean); insert into public.chat_conversations values ('test-chat', false);");
    const migration = readFileSync(new URL("../supabase/migrations/20261024092340_chat_conversation_turn_lease.sql", import.meta.url), "utf8");
    await db.exec(migration); await db.exec(migration);
    const first = await db.query("update public.chat_conversations set bot_turn_token='11111111-1111-4111-8111-111111111111',bot_turn_revision=1 where id='test-chat' and bot_turn_revision=0 and bot_turn_token is null returning bot_turn_revision,bot_enabled");
    assert.deepEqual(first.rows, [{ bot_turn_revision: 1, bot_enabled: false }]);
    const second = await db.query("update public.chat_conversations set bot_turn_token='22222222-2222-4222-8222-222222222222',bot_turn_revision=1 where id='test-chat' and bot_turn_revision=0 and bot_turn_token is null returning id");
    assert.equal(second.rows.length, 0);
  } finally { await db.close(); }
});
