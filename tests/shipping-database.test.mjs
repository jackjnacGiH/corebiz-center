import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
// Install into an isolated runtime; never change the application's dependency tree.
const require = createRequire(
  join(
    process.env.SHIPPING_TEST_RUNTIME ||
      join(tmpdir(), "corebiz-shipping-test-runtime"),
    "package.json",
  ),
);
const { PGlite } = require("@electric-sql/pglite");
test("shipping migration enforces role boundaries, audit and single-winner claims without touching orders", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table public.profiles(id uuid primary key,role text,is_active boolean); create table public.orders(id uuid primary key,code text,status text);
      insert into public.profiles values ('00000000-0000-4000-8000-000000000001','owner',true),('00000000-0000-4000-8000-000000000002','staff',true),('00000000-0000-4000-8000-000000000003','customer',true),('00000000-0000-4000-8000-000000000004','staff',false);
      insert into public.orders values ('00000000-0000-4000-8000-000000000010','SO-TEST','processing');`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260908062224_shipping_module.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `insert into public.shipments(id,reference_no,order_id,order_code,draft,environment,created_by,updated_by) values('00000000-0000-4000-8000-000000000011','SHP-TEST','00000000-0000-4000-8000-000000000010','SO-TEST','{}','uat','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');`,
    );
    async function asUser(id, sql) {
      await db.exec(
        `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`,
      );
      try {
        return await db.query(sql);
      } finally {
        await db.exec("reset role");
      }
    }
    const owner = "00000000-0000-4000-8000-000000000001",
      staff = "00000000-0000-4000-8000-000000000002",
      customer = "00000000-0000-4000-8000-000000000003",
      inactive = "00000000-0000-4000-8000-000000000004";
    assert.equal(
      (await asUser(staff, "select * from public.shipments")).rows.length,
      0,
    );
    assert.equal(
      (await asUser(customer, "select * from public.shipments")).rows.length,
      0,
    );
    await db.exec(
      `insert into public.shipping_permissions(user_id,granted_by) values('${staff}','${owner}'),('${inactive}','${owner}');`,
    );
    assert.equal(
      (await asUser(staff, "select * from public.shipments")).rows.length,
      1,
    );
    assert.equal(
      (await asUser(inactive, "select * from public.shipments")).rows.length,
      0,
    );
    assert.equal(
      (await asUser(staff, "select * from public.shipping_settings")).rows
        .length,
      0,
    );
    assert.equal(
      (await asUser(owner, "select * from public.shipping_settings")).rows
        .length,
      1,
    );
    await assert.rejects(
      () => asUser(staff, "update public.shipments set status='delivered'"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        asUser(
          staff,
          `insert into public.shipping_permissions(user_id,granted_by) values('${customer}','${staff}')`,
        ),
      /permission denied/,
    );
    await assert.rejects(
      () => asUser(owner, "delete from public.shipping_audit"),
      /permission denied/,
    );
    await db.exec(
      "select set_config('request.jwt.claim.sub','',false); set role service_role;",
    );
    const [one, two] = await Promise.all([
      db.query(
        "update public.shipments set status='submitting',version=version+1 where status='draft' and version=1 returning id",
      ),
      db.query(
        "update public.shipments set status='submitting',version=version+1 where status='draft' and version=1 returning id",
      ),
    ]);
    assert.equal(one.rows.length + two.rows.length, 1);
    await db.exec(
      "update public.shipments set status='outcome_unknown' where status='submitting'; reset role;",
    );
    assert.equal(
      (await db.query("select status from public.orders")).rows[0].status,
      "processing",
    );
    assert.equal(
      (
        await db.query(
          "select * from public.shipping_audit where entity='shipments'",
        )
      ).rows.length,
      3,
    );
    await db.exec(
      `delete from public.shipping_permissions where user_id='${staff}';`,
    );
    assert.equal(
      (await asUser(staff, "select * from public.shipments")).rows.length,
      0,
    );
    await db.exec("set role anon;");
    await assert.rejects(
      () => db.query("select * from public.shipments"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
