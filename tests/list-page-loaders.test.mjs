import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cache from '../frontend/src/lib/cache.ts';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pages = [
  { name: 'Inventory', primary: 'products', listKey: 'products', primaryAction: 'productsApi.list' },
  { name: 'Ecommerce', primary: 'products', listKey: 'products', primaryAction: 'productsApi.list' },
  { name: 'Orders', primary: 'orders', listKey: 'sales-documents:["","all"]', primaryAction: 'salesDocumentsApi.listPage' },
  { name: 'Dashboard', primary: 'quoteStats', primaryAction: 'kpiApi.getQuoteStats' },
];

function row(id) {
  return { id, status: 'active', low_stock_count: 1, monthly_revenue_target: 1000 };
}
function pageResult(page, id) {
  return page.name === 'Orders'
    ? { items: [{ kind: 'order', document: row(id) }], next_cursor: null, counts: { all: 1 } }
    : [row(id)];
}

// Compile the actual page's load function and its mount/cleanup effect. The
// queries and setters are controlled, while the production cache and guards
// run unchanged. This avoids duplicating the loader implementation in tests.
function loader(page) {
  cache.clearListCache();
  const source = readFileSync(new URL(`../frontend/src/pages/${page.name}.tsx`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(page.name + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let load, setup, version, loadMore;
  const extraRefs = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'load') load = node.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadMore') loadMore = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'load' &&
      ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback') load = `const ${node.getText(ast)};`;
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadVersion') version = node.getText(ast);
    if (ts.isVariableDeclaration(node) && ['pageGeneration','moreInFlight'].includes(node.name.getText(ast))) extraRefs.push(node.getText(ast));
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('loadVersion.current')) setup = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(load && setup && version, `Expected actual loader + cleanup in ${page.name}`);
  const compiled = ts.transpileModule(`const ${version};\n${extraRefs.map(ref=>`const ${ref};`).join('\n')}\nexport ${load}\n${loadMore ? `export ${loadMore}` : ''}\nexport const setup = ${setup};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [], callbacks = [], updates = [];
  const state = { loading: true, err: null };
  const setters = Object.fromEntries([
    'Products', 'Categories', 'Warehouses', 'LastSync', 'Customers', 'QuoteOrg',
    'Orders', 'Quotes', 'QuoteStats', 'AiMetrics', 'AIMetrics', 'Payments', 'Pending',
    'Activity', 'LowStock', 'Target', 'Err', 'Loading', 'LoadingMore', 'NextCursor', 'StatusCounts',
  ].map(name => [`set${name}`, value => {
    const key = name[0].toLowerCase() + name.slice(1);
    state[key] = typeof value === 'function' ? value(state[key]) : value;
    updates.push({ key, value });
  }]));
  function api(name) {
    return new Proxy({}, { get: (_target, method) => (...args) => new Promise((resolve, reject) => {
      requests.push({ action: `${name}.${method}`, args, resolve, reject });
    }) });
  }
  const exports = {};
  const sandbox = {
    exports, Error, ...setters,
    useRef: value => ({ current: value }),
    useCallback: fn => fn,
    debouncedSearch: '', statusFilter: 'all',
    invalidateListPrefix: cache.invalidateListPrefix,
    CK: cache.CK, hasCache: cache.hasCache,
    swrList: (key, fetcher, options) => {
      callbacks.push({ key, onFresh: options.onFresh });
      // Force existing entries to be stale without manipulating global clocks.
      return cache.swrList(key, fetcher, { ...options, staleMs: -1 });
    },
    ...Object.fromEntries(['productsApi', 'categoriesApi', 'warehousesApi', 'inventorySyncApi',
      'customersApi', 'orgSettingsApi', 'ordersApi', 'quoteRecordApi', 'salesDocumentsApi', 'kpiApi', 'dashboardApi']
      .map(name => [name, api(name)])),
  };
  Object.defineProperty(sandbox,'nextCursor',{get:()=>state.nextCursor??null});
  runInNewContext(compiled, sandbox);
  function resolve(request, id) {
    const list = request.action.endsWith('.list') || /getPaymentBreakdown|getPendingQuotes|getRecentActivity/.test(request.action);
    request.resolve(request.action === 'salesDocumentsApi.listPage' ? pageResult(page,id) : list ? [row(id)] : row(id));
  }
  return {
    ...exports, requests, callbacks, updates, state, resolve,
    setQuery: (search,status='all') => { sandbox.debouncedSearch=search; sandbox.statusFilter=status; },
    primary: () => page.listKey ? state[page.primary]?.[0]?.id : state[page.primary]?.id,
    resolveAll: (batch, id) => batch.forEach(request => resolve(request, id)),
  };
}

test('Orders: old load-more completion cannot append rows after search/filter changes', async () => {
  const h=loader(pages.find(page=>page.name==='Orders'));
  const first=h.load(); await settle();
  h.requests[0].resolve({...pageResult({name:'Orders'},'first'),next_cursor:{created_at:'2026-01-01T00:00:00Z',id:'00000000-0000-4000-8000-000000000001',kind:'order'}});
  await first;
  const more=h.loadMore(); await settle();
  const oldMore=h.requests[1];
  h.setQuery('new customer','processing');
  const current=h.load(); await settle();
  h.resolve(h.requests[2],'current-filter'); await current;
  const updates=h.updates.length;
  h.resolve(oldMore,'old-page'); await more;
  assert.equal(h.primary(),'current-filter');
  assert.equal(h.state.orders.length,1);
  assert.equal(h.updates.length,updates);
  assert.equal(h.requests[2].args[0].search,'new customer');
});

test('Orders: revalidated first page invalidates an in-flight old cursor page', async () => {
  const h=loader(pages.find(page=>page.name==='Orders'));
  const first=h.load(); await settle();
  h.requests[0].resolve({...pageResult({name:'Orders'},'cached-first'),next_cursor:{created_at:'2026-01-01T00:00:00Z',id:'00000000-0000-4000-8000-000000000001',kind:'order'}});
  await first;
  const more=h.loadMore(); await settle();
  h.callbacks[0].onFresh(pageResult({name:'Orders'},'fresh-first'));
  h.resolve(h.requests[1],'old-more'); await more;
  assert.equal(h.primary(),'fresh-first');
  assert.equal(h.state.orders.length,1);
  assert.equal(h.state.nextCursor,null);
  assert.equal(h.state.loadingMore,false);
});

for (const page of pages) {
  test(`${page.name}: late cold results cannot overwrite a forced reload`, async () => {
    const h = loader(page);
    const old = h.load();
    await settle();
    const cold = [...h.requests];
    const current = h.load(true);
    await settle();
    const forced = h.requests.slice(cold.length);
    h.resolveAll(forced, 'after-write');
    await current;
    assert.equal(h.primary(), 'after-write');
    const updates = h.updates.length;
    h.resolveAll(cold, 'before-write');
    await old;
    assert.equal(h.primary(), 'after-write');
    assert.equal(h.updates.length, updates, 'obsolete completion cannot touch data, error or loading');
  });

  test(`${page.name}: out-of-order forced results and old onFresh callbacks are ignored`, async () => {
    const h = loader(page);
    const old = h.load(true);
    await settle();
    const first = [...h.requests];
    const oldCallbacks = [...h.callbacks];
    const current = h.load(true);
    await settle();
    h.resolveAll(h.requests.slice(first.length), 'latest');
    await current;
    const updates = h.updates.length;
    for (const callback of oldCallbacks) callback.onFresh?.(pageResult(page,'late-callback'));
    h.resolveAll(first, 'older');
    await old;
    assert.equal(h.primary(), 'latest');
    assert.equal(h.updates.length, updates);
  });

  test(`${page.name}: an obsolete failure cannot clear current loading or replace its error`, async () => {
    const h = loader(page);
    const old = h.load();
    await settle();
    const first = [...h.requests];
    const current = h.load(true);
    await settle();
    const second = h.requests.slice(first.length);
    const oldPrimary = first.find(request => request.action === page.primaryAction);
    oldPrimary.reject(new Error('obsolete error'));
    h.resolveAll(first.filter(request => request !== oldPrimary), 'obsolete');
    await old;
    assert.equal(h.state.err, null);
    assert.equal(h.state.loading, true);
    const currentPrimary = second.find(request => request.action === page.primaryAction);
    currentPrimary.reject(new Error('current error'));
    h.resolveAll(second.filter(request => request !== currentPrimary), 'current');
    await current;
    assert.equal(h.state.err, 'current error');
    assert.equal(h.state.loading, false);
  });

  test(`${page.name}: actual effect cleanup blocks pending data, callbacks and finally writes`, async () => {
    const h = loader(page);
    const cleanup = h.setup();
    await settle();
    cleanup();
    const updates = h.updates.length;
    for (const callback of h.callbacks) callback.onFresh?.(pageResult(page,'late-callback'));
    h.resolveAll(h.requests, 'late-response');
    await settle();
    assert.equal(h.updates.length, updates);
  });

  if (page.listKey) {
    test(`${page.name}: a fresh SWR update is not replaced by cached results while other queries finish`, async () => {
      const h = loader(page);
      await cache.swrList(page.listKey, async () => pageResult(page,'cached'));
      const current = h.load();
      await settle();
      const primary = h.requests.find(request => request.action === page.primaryAction);
      h.resolve(primary, 'fresh');
      await settle();
      assert.equal(h.primary(), 'fresh');
      h.resolveAll(h.requests.filter(request => request !== primary), 'auxiliary');
      await current;
      assert.equal(h.primary(), 'fresh');
    });
  }
}
