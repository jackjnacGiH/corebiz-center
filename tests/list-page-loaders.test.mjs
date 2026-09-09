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
  { name: 'Orders', primary: 'orders', listKey: 'orders', primaryAction: 'ordersApi.list' },
  { name: 'Dashboard', primary: 'quoteStats', primaryAction: 'kpiApi.getQuoteStats' },
];

function row(id) {
  return { id, status: 'active', low_stock_count: 1, monthly_revenue_target: 1000 };
}

// Compile the actual page's load function and its mount/cleanup effect. The
// queries and setters are controlled, while the production cache and guards
// run unchanged. This avoids duplicating the loader implementation in tests.
function loader(page) {
  cache.clearListCache();
  const source = readFileSync(new URL(`../frontend/src/pages/${page.name}.tsx`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(page.name + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let load, setup, version;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'load') load = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadVersion') version = node.getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('loadVersion.current')) setup = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(load && setup && version, `Expected actual loader + cleanup in ${page.name}`);
  const compiled = ts.transpileModule(`const ${version};\nexport ${load}\nexport const setup = ${setup};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [], callbacks = [], updates = [];
  const state = { loading: true, err: null };
  const setters = Object.fromEntries([
    'Products', 'Categories', 'Warehouses', 'LastSync', 'Customers', 'QuoteOrg',
    'Orders', 'Quotes', 'QuoteStats', 'AiMetrics', 'AIMetrics', 'Payments', 'Pending',
    'Activity', 'LowStock', 'Target', 'Err', 'Loading',
  ].map(name => [`set${name}`, value => {
    const key = name[0].toLowerCase() + name.slice(1);
    state[key] = value;
    updates.push({ key, value });
  }]));
  function api(name) {
    return new Proxy({}, { get: (_target, method) => () => new Promise((resolve, reject) => {
      requests.push({ action: `${name}.${method}`, resolve, reject });
    }) });
  }
  const exports = {};
  runInNewContext(compiled, {
    exports, Error, ...setters,
    useRef: value => ({ current: value }),
    CK: cache.CK, hasCache: cache.hasCache,
    swrList: (key, fetcher, options) => {
      callbacks.push({ key, onFresh: options.onFresh });
      // Force existing entries to be stale without manipulating global clocks.
      return cache.swrList(key, fetcher, { ...options, staleMs: -1 });
    },
    ...Object.fromEntries(['productsApi', 'categoriesApi', 'warehousesApi', 'inventorySyncApi',
      'customersApi', 'orgSettingsApi', 'ordersApi', 'quoteRecordApi', 'kpiApi', 'dashboardApi']
      .map(name => [name, api(name)])),
  });
  function resolve(request, id) {
    const list = request.action.endsWith('.list') || /getPaymentBreakdown|getPendingQuotes|getRecentActivity/.test(request.action);
    request.resolve(list ? [row(id)] : row(id));
  }
  return {
    ...exports, requests, callbacks, updates, state, resolve,
    primary: () => page.listKey ? state[page.primary]?.[0]?.id : state[page.primary]?.id,
    resolveAll: (batch, id) => batch.forEach(request => resolve(request, id)),
  };
}

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
    for (const callback of oldCallbacks) callback.onFresh?.([row('late-callback')]);
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
    for (const callback of h.callbacks) callback.onFresh?.([row('late-callback')]);
    h.resolveAll(h.requests, 'late-response');
    await settle();
    assert.equal(h.updates.length, updates);
  });

  if (page.listKey) {
    test(`${page.name}: a fresh SWR update is not replaced by cached results while other queries finish`, async () => {
      const h = loader(page);
      await cache.swrList(page.listKey, async () => [row('cached')]);
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
