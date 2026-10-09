import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const owner = "00000000-0000-4000-8000-000000000001";
const shipment = "00000000-0000-4000-8000-000000000011";
const hash = "a".repeat(64);

test("shipping billing import matches exact tracking, stores the statement breakdown and is idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated, service_role;
      create table public.profiles(id uuid primary key, role text, is_active boolean);
      create table public.orders(id uuid primary key, code text, status text);
      insert into public.profiles values ('${owner}', 'owner', true);
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20260908062224_shipping_module.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/20261009093000_shipping_billing_import.sql", import.meta.url), "utf8"));
    await db.exec(`
      update public.shipping_settings
      set environment = 'production', merchant_code = 'M21942', updated_by = '${owner}';
      insert into public.shipments(
        id, reference_no, draft, status, environment, merchant_code,
        tracking_number, created_by, updated_by
      ) values (
        '${shipment}', 'SHP-BILLING-1', '{}', 'delivered', 'production', 'M21942',
        'TH011396TFB46F', '${owner}', '${owner}'
      );
      set role service_role;
    `);
    const payload = JSON.stringify([
      { tracking_code: "TH011396TFB46F", shipping_amount: 32, remote_area_fee: 0, cod_fee: 0, fee_vat: 0 },
      { tracking_code: "TH-NOT-FOUND", shipping_amount: 40, remote_area_fee: 10, cod_fee: 2, fee_vat: 0.14 },
    ]).replaceAll("'", "''");
    const imported = await db.query(`
      select public.import_shipping_billing(
        'statement.xlsx', '${hash}', 'รายละเอียด', '${payload}'::jsonb, '${owner}'
      ) as result
    `);
    assert.equal(imported.rows[0].result.total_rows, 2);
    assert.equal(imported.rows[0].result.matched_rows, 1);
    assert.equal(imported.rows[0].result.unmatched_rows, 1);
    assert.equal(Number(imported.rows[0].result.total_amount), 84.14);

    const updated = await db.query(`
      select provider_billed_amount, provider_billed_at, provider_billing_import_id, version
      from public.shipments where id = '${shipment}'
    `);
    assert.equal(Number(updated.rows[0].provider_billed_amount), 32);
    assert.ok(updated.rows[0].provider_billed_at);
    assert.ok(updated.rows[0].provider_billing_import_id);
    assert.equal(updated.rows[0].version, 2);

    const details = await db.query(`
      select tracking_code, shipping_amount, remote_area_fee, cod_fee, fee_vat,
             billed_amount, shipment_id
      from public.shipping_billing_rows order by tracking_code
    `);
    assert.equal(details.rows.length, 2);
    assert.equal(Number(details.rows[0].billed_amount) + Number(details.rows[1].billed_amount), 84.14);
    assert.equal(details.rows.filter((row) => row.shipment_id).length, 1);

    const duplicate = await db.query(`
      select public.import_shipping_billing(
        'renamed.xlsx', '${hash}', 'รายละเอียด', '${payload}'::jsonb, '${owner}'
      ) as result
    `);
    assert.equal(duplicate.rows[0].result.duplicate_file, true);
    const unchanged = await db.query(`select version from public.shipments where id = '${shipment}'`);
    assert.equal(unchanged.rows[0].version, 2, "re-uploading the same file must not update a shipment twice");

    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${owner}', false); set role authenticated;`);
    await assert.rejects(
      () => db.query("select * from public.shipping_billing_imports"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query(`select public.import_shipping_billing('x.xlsx', '${hash}', 's', '[]'::jsonb, '${owner}')`),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
