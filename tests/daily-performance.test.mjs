import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { shareRead, clearReadFlights } from '../frontend/src/lib/read-flight.ts';
import { clearListCache, swrList } from '../frontend/src/lib/cache.ts';
import { mapSettledLimit } from '../frontend/src/lib/concurrent.ts';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('chat prefetch and foreground share one request despite one subscriber leaving; settled reads are always fresh', async () => {
  clearReadFlights();
  const wait = deferred(); let calls = 0, upstream;
  const fetch = signal => { calls++; upstream = signal; return wait.promise; };
  const prefetch = new AbortController();
  const first = shareRead('room:one:50', fetch, prefetch.signal);
  const aborted = assert.rejects(first, { name: 'AbortError' });
  prefetch.abort();
  const foreground = shareRead('room:one:50', fetch);
  await tick();
  assert.equal(calls, 1);
  assert.equal(upstream.aborted, false);
  const rows = { messages: [{ id: 'msg' }], hasMore: true };
  wait.resolve(rows);
  assert.strictEqual(await foreground, rows);
  await aborted;
  await shareRead('room:one:50', fetch);
  assert.equal(calls, 2);
});

test('auth cache reset aborts shared reads and a new identity cannot join the old account request', async () => {
  const old = deferred(); let oldSignal;
  const read = shareRead('room:two:50', signal => { oldSignal = signal; return old.promise; });
  const rejected = assert.rejects(read, { name: 'AbortError' });
  await tick(); clearListCache();
  assert.equal(oldSignal.aborted, true);
  const fresh = await shareRead('room:two:50', async () => 'new account');
  assert.equal(fresh, 'new account');
  old.resolve('old account'); await rejected;
  assert.equal(await shareRead('room:two:50', async () => 'latest'), 'latest');
});

test('rapid navigation cancels abandoned network work after the short prefetch handoff', async () => {
  const controller = new AbortController(); let upstream;
  const read = shareRead('abandoned', async signal => { upstream = signal; return new Promise(() => {}); }, controller.signal);
  await tick(); const rejected = assert.rejects(read, { name: 'AbortError' }); controller.abort();
  await rejected; await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(upstream.aborted, true);
  assert.equal(await shareRead('abandoned', async () => 'new page'), 'new page');
});

test('room, cursor and size keys stay independent; an already aborted view starts no read', async () => {
  clearReadFlights(); let calls = 0;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(shareRead('a', async () => ++calls, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.deepEqual(await Promise.all(['a:50', 'a:100', 'b:50', 'a:50:before'].map(key => shareRead(key, async () => ++calls))), [1, 2, 3, 4]);
});

test('bounded status queue immediately fills a free slot, preserves input order and continues after failures', async () => {
  const waits = Array.from({ length: 6 }, deferred); let running = 0, peak = 0; const started = [];
  const result = mapSettledLimit(waits, 3, async (wait, index) => {
    started.push(index); peak = Math.max(peak, ++running);
    await wait.promise; running--; if (index === 1) throw new Error('offline'); return index;
  });
  assert.deepEqual(started, [0, 1, 2]);
  waits[1].resolve(); await tick(); assert.deepEqual(started, [0, 1, 2, 3]);
  waits[3].resolve(); await tick(); assert.deepEqual(started, [0, 1, 2, 3, 4]);
  waits.forEach(wait => wait.resolve());
  const rows = await result;
  assert.equal(peak, 3); assert.equal(rows[1].status, 'rejected');
  assert.deepEqual(rows.filter(row => row.status === 'fulfilled').map(row => row.value), [0, 2, 3, 4, 5]);
  assert.deepEqual(await mapSettledLimit([], 3, async () => 1), []);
});

const source = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
function kpiApi(results) {
  const from = source.indexOf('async getKPI()');
  const body = source.slice(from, source.indexOf('/**', from));
  const exports = {}, started = [], waits = results.map(deferred);
  let next = 0;
  const supabase = { from(table) {
    const index = next++;
    const query = new Proxy({}, { get: (_, key) => key === 'then' ? (yes, no) => {
      started.push(table); return waits[index].promise.then(() => results[index]).then(yes, no);
    } : () => query }); return query;
  } };
  runInNewContext(ts.transpileModule(`export const api={${body}}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, supabase, Date });
  return { api: exports.api, started, finish: () => waits.forEach(wait => wait.resolve()) };
}
test('dashboard starts all independent reads together and retains revenue exclusions, unique stock count and exact customer count', async () => {
  const now = new Date().toISOString(), old = new Date(Date.now() - 40 * 86400000).toISOString();
  const h = kpiApi([
    { data: [
      { total: 200, payment_status: 'paid', status: 'completed', created_at: now },
      { total: 100, payment_status: 'paid', status: 'completed', created_at: old },
      { total: 99, payment_status: 'paid', status: 'cancelled', created_at: now },
      { total: 88, payment_status: 'unpaid', status: 'pending', created_at: now },
    ] },
    { data: [{ product_id: 'a', quantity: 0, reorder_level: 1 }, { product_id: 'a', quantity: 1, reorder_level: 1 }, { product_id: 'b', quantity: 5, reorder_level: 1 }] },
    { count: 42 },
  ]);
  const result = h.api.getKPI(); await tick();
  assert.deepEqual(h.started, ['orders', 'inventory', 'customers']); h.finish();
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), { total_revenue: 300, active_orders: 1, low_stock_count: 1, new_customers_30d: 42, revenue_delta_pct: 100 });
});

test('dashboard never conceals a failed data source', async () => {
  for (let failed = 0; failed < 3; failed++) {
    const err = new Error(`source-${failed}`);
    const h = kpiApi(Array.from({ length: 3 }, (_, index) => ({ data: [], count: 0, error: index === failed ? err : null })));
    const result = h.api.getKPI(); h.finish(); await assert.rejects(result, err);
  }
});

test('CRM shared list remains complete and an explicit refresh supersedes stale in-flight data', async () => {
  clearListCache();
  const old = deferred(), rows = Array.from({ length: 3428 }, (_, id) => ({ id }));
  const first = swrList('customers', () => old.promise);
  const fresh = await swrList('customers', async () => rows, { force: true });
  old.resolve([]); await first;
  assert.equal(fresh.length, 3428);
  assert.strictEqual(await swrList('customers', async () => []), rows);
});
