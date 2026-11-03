import assert from 'node:assert/strict';
import test from 'node:test';
import { database, conversationId } from './helpers/critical-company-fixtures.mjs';
import { ragRuntime } from './helpers/rag-critical-runtime.mjs';

const sku = '2020002618';
const product = {
  sku, status: 'active', name_th: 'ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท สีเขียว 6นิ้วx10M. #240',
  name_en: 'Non-Woven Scotch Brite 6 inch x 10M #240', unit: 'ม้วน', min_order_qty: 1,
  inventory: [{ quantity: 135 }], spec: {},
};

function fixture(options = {}) {
  const db = database();
  const originalFrom = db.from.bind(db), originalRpc = db.rpc.bind(db);
  const filters = [], selections = [], prices = [];
  db.from = table => {
    if (table !== 'products') return originalFrom(table);
    let rows = options.rows ?? [product];
    const chain = {
      select(fields) { selections.push(fields); return chain; },
      eq(field, value) { filters.push([field, value]); rows = rows.filter(row => row[field] === value); return chain; },
      limit(max) { rows = rows.slice(0, max); return chain; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: options.databaseError ?? null }),
      then(resolve, reject) { return Promise.resolve({ data: rows, error: options.databaseError ?? null }).then(resolve, reject); },
    };
    return chain;
  };
  db.rpc = async (name, args) => {
    if (name !== 'resolve_bot_quote_prices') return originalRpc(name, args);
    prices.push(args);
    if (options.priceError) throw Error('Synthetic pricing unavailable');
    const item = args.p_items[0];
    return { data: [{ sku: item.sku, quantity: item.qty, final_price: 1200,
      product_name: product.name_th, unit: product.unit, price_source: 'synthetic-private-rule',
      pricing_context_reason: 'synthetic-private-context' }], error: null };
  };
  return { db, filters, selections, prices };
}

async function ask(query, options = {}, history = []) {
  const f = fixture(options);
  const runtime = await ragRuntime(f.db);
  const result = await runtime.request({ query, history, conversation_id: conversationId, channel: 'line', stream: false });
  return { ...f, runtime, ...result };
}

test('latest complete SKU bypasses keyword/model routing and replies from the exact active row', async () => {
  const result = await ask(`สนใจ SKU ${sku} ม้วนใยขัด #240 ครับ`);
  assert.equal(result.status, 200);
  assert.equal(result.data.model, 'catalog:exact_sku');
  assert.match(result.data.answer, /สก๊อตไบร์ท สีเขียว.*#240/);
  assert.match(result.data.answer, /1,200.*บาท\/ม้วน|1200.*บาท\/ม้วน/);
  assert.match(result.data.answer, /135 ม้วน/);
  assert.match(result.data.answer, /ต้องการกี่ม้วน/);
  assert.deepEqual(result.filters, [['sku', sku], ['status', 'active']]);
  assert.equal(result.prices[0].p_items[0].qty, 1);
  assert.deepEqual(result.data.active_item, { source: 'catalogue', sku });
  assert.equal(result.runtime.trace.modelCalls, 0);
  assert.equal(result.db.calls.length, 0);
  assert.deepEqual(result.runtime.trace.dispatched, []);
  assert.doesNotMatch(result.data.answer, /เชอร์รี่|เจ้าหน้าที่|จัดหา|สั่งผลิต|synthetic-private/);
  assert.ok(result.selections.every(fields => !/\bcost\b|\bprice\b/.test(fields)));
});

test('bare SKU and inaccurate descriptions retain canonical SKU facts and ignore old product quantity', async () => {
  for (const query of [sku, `สนใจ ${sku} ม้วนใยขัด #240 ครับ`, `SKU ${sku} สายพาน PACO Y966 #400`]) {
    const result = await ask(query, {}, [
      { role: 'user', content: 'ต้องการกระดาษทราย SA331 เบอร์ 1500 จำนวน 800 ชิ้น' },
      { role: 'assistant', content: 'สินค้าเก่า SKU 2020000992', verified_product: { source: 'catalogue', sku: '2020000992' } },
    ]);
    assert.equal(result.data.model, 'catalog:exact_sku');
    assert.match(result.data.answer, /#240/);
    assert.equal(result.prices[0].p_items[0].qty, 1);
    assert.equal(result.runtime.trace.modelCalls, 0);
    assert.equal(result.db.calls.length, 0);
  }
});

test('quantity on the SKU enquiry uses current authoritative pricing and offers quote choices without creating one', async () => {
  const result = await ask(`สนใจ SKU ${sku} จำนวน 4 ม้วน`);
  assert.equal(result.prices[0].p_items[0].qty, 4);
  assert.match(result.data.answer, /4 ม้วน/);
  assert.match(result.data.answer, /4,800|4800/);
  assert.match(result.data.answer, /1\. ต้องการใบเสนอราคา\n2\. ไม่ต้องการ/);
  assert.equal(result.db.calls.length, 0);
});

test('the trailing digits of a SKU followed by its unit are never an order quantity', async () => {
  for (const query of [`SKU ${sku} ม้วน`, `${sku} ม้วนครับ`]) {
    const result = await ask(query);
    assert.equal(result.data.model, 'catalog:exact_sku');
    assert.equal(result.prices[0].p_items[0].qty, 1);
    assert.match(result.data.answer, /ต้องการกี่ม้วน/);
    assert.doesNotMatch(result.data.answer, /(?:จำนวน|สำหรับ)\s*(?:2618|2,618)\s*ม้วน/);
  }
});

test('zero stock is still the exact SKU and marked made-to-order rather than handed off', async () => {
  const result = await ask(`SKU ${sku}`, { rows: [{ ...product, inventory: [{ quantity: 0 }] }] });
  assert.match(result.data.answer, /สินค้าสั่งผลิต/);
  assert.equal(result.data.active_item.sku, sku);
  assert.equal(result.db.calls.length, 0);
});

test('missing or inactive exact SKUs cannot silently become another catalogue product', async () => {
  for (const rows of [[], [{ ...product, status: 'inactive' }], [{ ...product, sku: sku + '0' }]]) {
    const result = await ask(`SKU ${sku}`, { rows });
    assert.equal(result.data.model, 'catalog:exact_sku_not_found');
    assert.match(result.data.answer, /ตรวจสอบรหัสสินค้า/);
    assert.equal(result.data.active_item, null);
    assert.equal(result.prices.length, 0);
    assert.equal(result.runtime.trace.modelCalls, 0);
    assert.equal(result.db.calls.length, 0);
  }
});

test('labelled alphanumeric SKUs never fall back to a partial model or another product', async () => {
  const exact = await ask('SKU AB-12 แปรงขัด', { rows: [{ ...product, sku: 'AB-12' }] });
  assert.equal(exact.data.active_item.sku, 'AB-12');
  assert.deepEqual(exact.filters, [['sku', 'AB-12'], ['status', 'active']]);
  const partial = await ask('SKU AB-12 แปรงขัด', { rows: [{ ...product, sku: 'OTHER-AB-12', name_th: 'แปรงขัด AB-12' }] });
  assert.equal(partial.data.model, 'catalog:exact_sku_not_found');
  assert.equal(partial.data.active_item, null);
  assert.equal(partial.prices.length, 0);
});

test('database and price failures do not invent a price, lose a verified SKU, or create staff work', async () => {
  const unavailable = await ask(`SKU ${sku}`, { databaseError: { message: 'Synthetic timeout' } });
  assert.equal(unavailable.data.model, 'catalog:exact_sku_unavailable');
  assert.match(unavailable.data.answer, /ลองอีกครั้ง/);
  assert.equal(unavailable.db.calls.length, 0);
  const priceUnavailable = await ask(`SKU ${sku}`, { priceError: true });
  assert.equal(priceUnavailable.data.active_item.sku, sku);
  assert.match(priceUnavailable.data.answer, /ตรวจราคาปัจจุบันไม่ได้/);
  assert.match(priceUnavailable.data.answer, /135 ม้วน/);
  assert.doesNotMatch(priceUnavailable.data.answer, /1200|1,200|เจ้าหน้าที่/);
  assert.equal(priceUnavailable.db.calls.length, 0);
});

test('the following quantity reply retains the previously verified SKU', async () => {
  const firstQuery = `สนใจ SKU ${sku} ม้วนใยขัด #240 ครับ`;
  const first = await ask(firstQuery);
  const second = await ask('4 ม้วน', {}, [
    { role: 'user', content: firstQuery },
    { role: 'assistant', content: first.data.answer, verified_product: first.data.active_item },
  ]);
  assert.equal(second.prices[0].p_items[0].sku, sku);
  assert.equal(second.prices[0].p_items[0].qty, 4);
  assert.match(second.data.answer, /4 ม้วน/);
  assert.equal(second.db.calls.length, 0);
});

test('an explicit human request still uses the existing verified staff-review route', async () => {
  const result = await ask(`ขอคุยเจ้าหน้าที่เรื่อง SKU ${sku} ครับ`);
  assert.equal(result.data.model, 'guardrail:active_item_review');
  assert.equal(result.db.calls[0].name, 'agent_propose');
  assert.equal(result.prices.length, 0);
});
