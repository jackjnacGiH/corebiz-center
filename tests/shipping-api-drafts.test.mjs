import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as domain from '../supabase/functions/_shared/shipping-domain.ts';

const actor = '00000000-0000-4000-8000-000000000999';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function shipment(n, status = 'draft', extra = {}) {
  const draft = domain.emptyDraft();
  draft.destination = { ...domain.emptyAddress(), fullname: `Recipient ${n}`, address: `Address ${n}`, telephone1: '0000000000' };
  return { id: id(n), reference_no: `SHP-TEST-${n}`, status, draft, version: 7,
    tracking_number: null, created_at: '2026-09-01T00:00:00Z', created_by: actor,
    order_id: null, order_code: null, orders: null, ...extra };
}
const compiled = ts.transpileModule(readFileSync(new URL('../supabase/functions/shipping-api/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the real Deno handler. The fake database applies PostgREST filters,
// ordering, exact counts and CAS updates to synthetic rows; it makes no network
// calls and deliberately provides no delete/provider mutation implementation.
function api({ rows = [shipment(1)], role = 'owner', active = true, grant = false, customers = [], beforeUpdate } = {}) {
  const tables = {
    profiles: [{ id: actor, role, is_active: active }],
    shipping_permissions: grant ? [{ user_id: actor }] : [],
    shipping_settings: [{ id: true, environment: 'uat', merchant_code: 'test', billing_mode: 'unconfirmed' }],
    shipments: structuredClone(rows), customers: structuredClone(customers),
  };
  const queries = [];
  class Query {
    constructor(table) {
      assert.ok(table in tables, `Unexpected database table: ${table}`);
      this.table = table; this.filters = []; this.sorts = []; this.mode = 'many';
      queries.push(this);
    }
    select(columns, options = {}) { this.columns = columns; this.exact = options.count === 'exact'; return this; }
    eq(column, value) { this.filters.push(['eq', column, value]); return this; }
    neq(column, value) { this.filters.push(['neq', column, value]); return this; }
    in(column, values) { this.filters.push(['in', column, values]); return this; }
    order(column, options = {}) { this.sorts.push([column, options.ascending !== false]); return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    limit(n) { this.bounds = [0, n - 1]; return this; }
    update(patch) { this.patch = patch; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    execute() {
      if (this.patch) { beforeUpdate?.(tables.shipments); beforeUpdate = undefined; }
      let data = tables[this.table].filter(row => this.filters.every(([op, key, value]) =>
        op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : value.includes(row[key])));
      data.sort((a, b) => {
        for (const [key, ascending] of this.sorts) {
          const compared = String(a[key]).localeCompare(String(b[key]));
          if (compared) return ascending ? compared : -compared;
        }
        return 0;
      });
      const count = this.exact ? data.length : null;
      if (this.bounds) data = data.slice(this.bounds[0], this.bounds[1] + 1);
      if (this.patch) for (const row of data) Object.assign(row, this.patch);
      if (this.mode !== 'many') return { data: structuredClone(data[0] ?? null), error: this.mode === 'single' && data.length !== 1 ? { code: 'PGRST116' } : null };
      return { data: structuredClone(data), count, error: null };
    }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
  }
  let handler;
  const noProvider = () => { throw new Error('Provider must not be called for draft list/archive'); };
  runInNewContext(compiled, {
    exports: {}, Error, Request, Response, URL, crypto,
    Deno: { env: { get: () => '' }, serve: callback => { handler = callback; } },
    require: name => {
      if (name.startsWith('npm:@supabase/')) return { createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
        from: table => new Query(table),
      }) };
      if (name.endsWith('/shipping-domain.ts')) return domain;
      if (name.endsWith('/promptspeed.ts')) return { assertProviderReady: noProvider, requestProvider: noProvider };
      if (name.endsWith('/shipping-rates.ts')) return { compareShippingRates: noProvider };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { tables, queries, async call(action, payload = {}, authenticated = true) {
    const response = await handler(new Request('https://test.invalid/shipping-api', {
      method: 'POST', headers: authenticated ? { Authorization: 'Bearer synthetic-test-token' } : {},
      body: JSON.stringify({ action, ...payload }),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test('active shipment list filters archived rows before exact count and pagination', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => shipment(i + 1, (i + 1) % 3 === 0 ? 'archived' : i === 0 ? 'waiting' : 'draft'));
  const h = api({ rows });
  const first = await h.call('list', { page: 0 });
  const second = await h.call('list', { page: 1 });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.count, 40); assert.equal(second.body.count, 40);
  assert.equal(first.body.shipments.length, 25); assert.equal(second.body.shipments.length, 15);
  const all = [...first.body.shipments, ...second.body.shipments];
  assert.equal(new Set(all.map(row => row.id)).size, 40);
  assert.ok(all.every(row => row.status !== 'archived'));
  assert.ok(all.some(row => row.status === 'waiting'), 'non-draft active shipments remain visible');
  const expected = rows.filter(row => row.status !== 'archived').map(row => row.id).sort().reverse();
  assert.deepEqual(all.map(row => row.id), expected);
  assert.equal(h.queries.some(query => query.patch), false);
});

test('archived history cannot fill the recipient window or reappear as a saved recipient', async () => {
  const archived = Array.from({ length: 210 }, (_, i) => shipment(i + 10, 'archived', { created_at: '2026-09-09T00:00:00Z' }));
  const h = api({ rows: [...archived, shipment(1), shipment(2, 'delivered')], customers: [
    { id: id(300), name: 'Recipient CRM', customer_type: 'individual', phone: '0000000001', shipping_address: { address: 'CRM address' } },
  ] });
  const result = await h.call('recipient_options', { search: 'Recipient' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.recipients.map(row => row.id), [`history:${id(1)}`, `history:${id(2)}`, `customer:${id(300)}`]);
  assert.equal(result.body.recipients.find(row => row.source === 'customer').address.fullname, 'Recipient CRM');
});

test('archiving an authorized draft preserves its record and records actor, version and updated time', async () => {
  const h = api({ role: 'staff', grant: true });
  const before = structuredClone(h.tables.shipments[0]);
  const result = await h.call('archive', { id: id(1), version: 7 });
  assert.equal(result.status, 200);
  assert.equal(result.body.shipment.status, 'archived');
  assert.equal(result.body.shipment.version, 8);
  assert.equal(result.body.shipment.updated_by, actor);
  assert.ok(Number.isFinite(Date.parse(result.body.shipment.updated_at)));
  assert.equal(h.tables.shipments.length, 1, 'archive must not delete the shipment');
  assert.deepEqual(result.body.shipment.draft, before.draft);
  const write = h.queries.find(query => query.patch);
  assert.deepEqual(JSON.parse(JSON.stringify(write.filters)), [['eq', 'id', id(1)], ['eq', 'version', 7], ['in', 'status', ['draft']]]);
  assert.equal((await h.call('list')).body.count, 0);
  assert.deepEqual((await h.call('recipient_options', { search: 'Recipient' })).body.recipients, []);
});

test('stale versions and tracked drafts are rejected before any update', async () => {
  for (const [row, version] of [[shipment(1), 6], [shipment(1), undefined], [shipment(1, 'draft', { tracking_number: 'SYNTHETIC-TRACK' }), 7]]) {
    const h = api({ rows: [row] });
    const result = await h.call('archive', { id: id(1), version });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'conflict');
    assert.equal(h.queries.some(query => query.patch), false);
    assert.deepEqual(h.tables.shipments[0], row);
  }
});

test('submitting, uncertain, delivered and other non-draft states cannot be archived', async () => {
  for (const status of ['submitting', 'outcome_unknown', 'waiting', 'on_delivery', 'delivered', 'canceled', 'archived']) {
    const h = api({ rows: [shipment(1, status)] });
    const result = await h.call('archive', { id: id(1), version: 7 });
    assert.equal(result.status, 409, status); assert.equal(result.body.error, 'conflict');
    assert.equal(h.tables.shipments[0].status, status); assert.equal(h.tables.shipments[0].version, 7);
  }
});

test('version and status compare-and-set reject a draft changed after the initial read', async () => {
  for (const change of [{ version: 8 }, { status: 'submitting' }]) {
    const h = api({ beforeUpdate: rows => Object.assign(rows[0], change) });
    const result = await h.call('archive', { id: id(1), version: 7 });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'conflict');
    assert.equal(h.tables.shipments[0].updated_by, undefined);
    for (const [key, value] of Object.entries(change)) assert.equal(h.tables.shipments[0][key], value);
  }
});

test('forbidden users cannot list, use history or archive, and missing bearer auth is rejected', async () => {
  for (const config of [{ role: 'staff' }, { role: 'customer', grant: true }, { role: 'owner', active: false }]) {
    for (const action of ['archive', 'list', 'recipient_options']) {
      const h = api(config);
      const result = await h.call(action, { id: id(1), version: 7, search: 'Recipient' });
      assert.equal(result.status, 403); assert.equal(result.body.error, 'forbidden');
      assert.equal(h.queries.some(query => query.table === 'shipments'), false);
    }
  }
  const h = api();
  assert.equal((await h.call('archive', { id: id(1), version: 7 }, false)).status, 401);
  assert.equal(h.queries.length, 0);
});
