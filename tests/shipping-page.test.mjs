import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as domain from '../supabase/functions/_shared/shipping-domain.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../frontend/src/pages/Shipping.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bootstrap = () => ({ manager: true, settings: { environment: 'uat', origin: domain.emptyAddress() },
  brand: { name: 'Test company' }, accounts: [], readReady: true, sendReady: false });
const shipment = (id) => ({ id, reference_no: id, draft: domain.emptyDraft(), status: 'draft', created_at: '2026-09-09T00:00:00Z' });

// Execute the actual component with deterministic hooks and deferred requests.
// JSX remains inspectable, so tests invoke the same handlers as user controls.
// This deliberately does not simulate browser layout, printing, or network time.
function mount(query = '') {
  const slots = [], effects = [], requests = [];
  const timers = new Map();
  let cursor = 0, timerId = 0, tree, dirty = false;
  let params = new URLSearchParams(query);
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index]; },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: setup() };
      });
    },
  };
  const words = new Proxy({}, { get: (_target, key) => key });
  const shippingWords = new Proxy({ statuses: words, quoteIssues: words }, {
    get: (target, key) => key in target ? target[key] : key,
  });
  const api = new Proxy({}, { get: (_target, action) => (...args) => new Promise((resolve, reject) => requests.push({ action, args, resolve, reject })) });
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
      if (name === 'react-router-dom') return { useSearchParams: () => [params, next => { params = new URLSearchParams(next); dirty = true; }] };
      if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => key });
      if (name === '@/i18n') return { useLanguage: () => ({ language: 'th', t: { shipping: shippingWords, common: words } }) };
      if (name === '@/lib/shipping-api') return { shippingApi: api };
      if (name.endsWith('/shipping-domain')) return domain;
      if (name === '@/lib/shipping-carriers') return { shippingTrackingUrl: () => null };
      if (name === '@/lib/print') return { printElement: () => { throw new Error('Printing is outside this test'); } };
      if (name === '@/components/ui/button') return { Button: 'Button' };
      if (name === '@/components/ui/input') return { Input: 'Input' };
      if (name === '@/components/shipping/ShippingLabel') return { default: 'ShippingLabel', SHIPPING_LABEL_ID: 'shipping-label-batch' };
      if (name.startsWith('@/components/')) return { default: name.split('/').at(-1) };
      throw new Error(`Unexpected dependency ${name}`);
    },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    window: {
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
      addEventListener() {}, removeEventListener() {}, confirm: () => true,
    },
    document: { addEventListener() {}, removeEventListener() {} },
  });
  const render = () => {
    let passes = 0;
    do {
      assert.ok(++passes < 20, 'Hooks should settle');
      dirty = false; cursor = 0;
      tree = exports.default();
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  };
  const nodes = (value, result = []) => {
    if (Array.isArray(value)) value.forEach(child => nodes(child, result));
    else if (value && typeof value === 'object') {
      if ('type' in value && value.props) result.push(value);
      for (const child of Object.values(value.props ?? {})) if (typeof child === 'object') nodes(child, result);
    }
    return result;
  };
  const find = (predicate) => { render(); return nodes(tree).find(predicate); };
  const button = (label) => find(node => node.type === 'Button' &&
    (node.props.children === label || (Array.isArray(node.props.children) && node.props.children.includes(label))));
  render();
  return {
    requests, render, find, button,
    listRequests: () => requests.filter(request => request.action === 'list'),
    rows: () => { render(); return nodes(tree).filter(node => node.type === 'ShipmentListCard').map(node => node.props.shipment.id); },
    runTimers() { render(); for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } render(); },
    search(value) { find(node => node.type === 'Input' && node.props['aria-label'] === 'search').props.onChange({ target: { value } }); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('initial bootstrap and list run concurrently, but list data stays hidden until authorization succeeds', async () => {
  const h = mount();
  h.runTimers();
  assert.deepEqual(h.requests.map(request => request.action), ['bootstrap', 'list']);
  h.listRequests()[0].resolve({ shipments: [shipment('first')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), [], 'Bootstrap is still unresolved');
  h.requests[0].resolve(bootstrap());
  await settle(); h.runTimers();
  assert.deepEqual(h.rows(), ['first']);
  assert.equal(h.listRequests().length, 1, 'Bootstrap completion must not issue a duplicate list');
  h.unmount();
});

test('a rejected bootstrap never reveals a completed list', async () => {
  const h = mount(); h.runTimers();
  h.listRequests()[0].resolve({ shipments: [shipment('hidden')], count: 1 });
  h.requests[0].reject(new Error('forbidden'));
  await settle();
  assert.deepEqual(h.rows(), []);
  assert.equal(h.find(node => node.props.role === 'alert').props.children, 'noPermission');
  h.unmount();
});

test('explicit reload refreshes bootstrap followed by exactly one new list request', async () => {
  const h = mount(); h.runTimers();
  h.requests[0].resolve(bootstrap());
  h.listRequests()[0].resolve({ shipments: [shipment('old')], count: 1 });
  await settle(); h.render();
  h.button('refresh').props.onClick();
  assert.equal(h.requests.at(-1).action, 'bootstrap');
  h.runTimers();
  assert.equal(h.listRequests().length, 1, 'Reload waits for successful settings refresh');
  h.requests.at(-1).resolve(bootstrap());
  await settle(); h.runTimers();
  assert.equal(h.listRequests().length, 2);
  h.listRequests()[1].resolve({ shipments: [shipment('new')], count: 1 });
  await settle(); h.runTimers();
  assert.deepEqual(h.rows(), ['new']);
  assert.equal(h.listRequests().length, 2);
  h.unmount();
});

test('debounced search discards queued queries and superseded request results without clearing current loading', async () => {
  const h = mount(); h.runTimers();
  h.requests[0].resolve(bootstrap());
  h.listRequests()[0].resolve({ shipments: [shipment('initial')], count: 1 });
  await settle();
  h.search('old query'); h.runTimers();
  h.search('not sent');
  h.search('latest query'); h.runTimers();
  assert.deepEqual(h.listRequests().map(request => request.args[1]), ['', 'old query', 'latest query']);
  h.listRequests()[1].resolve({ shipments: [shipment('obsolete')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), ['initial']);
  assert.equal(h.find(node => node.type === 'section' && 'aria-busy' in node.props).props['aria-busy'], true);
  h.listRequests()[2].resolve({ shipments: [shipment('latest')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), ['latest']);
  assert.equal(h.find(node => node.type === 'section' && 'aria-busy' in node.props).props['aria-busy'], false);
  h.search('delayed query'); h.runTimers();
  h.search('final query'); h.runTimers();
  h.listRequests()[4].resolve({ shipments: [shipment('final')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), ['final']);
  h.listRequests()[3].resolve({ shipments: [shipment('late-obsolete')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), ['final'], 'Older response cannot replace an already completed newer search');
  h.unmount();
});

test('order entry cancels list ownership and does not fetch a list while the editor is active', async () => {
  const h = mount('order=order-1'); h.runTimers();
  h.requests[0].resolve(bootstrap());
  await settle(); h.render();
  const order = h.requests.find(request => request.action === 'orderDraft');
  assert.equal(order.args[0], 'order-1');
  order.resolve({ draft: domain.emptyDraft(), order_code: 'SO-1', previous: [] });
  await settle(); h.render(); await settle(); h.runTimers();
  assert.ok(h.find(node => node.type === 'AddressFields'), 'Order is shown in the editor');
  h.listRequests()[0].resolve({ shipments: [shipment('late-list')], count: 1 });
  await settle();
  assert.deepEqual(h.rows(), []);
  h.button('refresh').props.onClick();
  h.requests.at(-1).resolve(bootstrap());
  await settle(); h.runTimers();
  assert.equal(h.listRequests().length, 1, 'Editor reload must not start a list request');
  h.button('back').props.onClick(); h.runTimers();
  assert.equal(h.listRequests().length, 2, 'Returning to list refreshes it');
  assert.deepEqual(h.rows(), [], 'Late response from the previous view was not stored');
  h.unmount();
});
