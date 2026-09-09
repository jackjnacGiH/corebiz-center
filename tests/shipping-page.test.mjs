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
const shipment = (id, changes = {}) => ({ id, reference_no: id, draft: domain.emptyDraft(), status: 'draft', tracking_number: null, version: 3, created_at: '2026-09-09T00:00:00Z', ...changes });

// Execute the actual component with deterministic hooks and deferred requests.
// JSX remains inspectable, so tests invoke the same handlers as user controls.
// This deliberately does not simulate browser layout, printing, or network time.
function mount(query = '') {
  const slots = [], effects = [], requests = [], confirmations = [];
  const timers = new Map();
  let cursor = 0, timerId = 0, tree, dirty = false;
  let params = new URLSearchParams(query);
  let confirmResult = true;
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
      addEventListener() {}, removeEventListener() {}, confirm: message => { confirmations.push(message); return confirmResult; },
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
    requests, confirmations, render, find, button,
    confirmWith(value) { confirmResult = value; },
    card: id => find(node => node.type === 'ShipmentListCard' && node.props.shipment.id === id),
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

async function readyList(rows = [shipment('draft-1')], count = rows.length) {
  const h = mount(); h.runTimers();
  h.requests[0].resolve(bootstrap());
  h.listRequests()[0].resolve({ shipments: rows, count });
  await settle(); h.render();
  return h;
}

async function editDraft(h, row) {
  h.card(row.id).props.onOpen();
  const get = h.requests.at(-1);
  assert.equal(get.action, 'get');
  get.resolve({ shipment: row, events: [] });
  await settle(); h.render();
  const sender = h.find(node => node.type === 'AddressFields' && node.props.prefix === 'sender');
  sender.props.onChange({ ...sender.props.value, fullname: 'Unsaved contact' });
  h.render();
}

test('canceling deletion retains the draft and does not send a mutation', async () => {
  const h = await readyList();
  h.confirmWith(false);
  h.card('draft-1').props.onDelete();
  assert.equal(h.confirmations.length, 1);
  assert.ok(h.confirmations[0].includes('draft-1'));
  assert.equal(h.requests.filter(request => request.action === 'action').length, 0);
  assert.deepEqual(h.rows(), ['draft-1']);
  h.unmount();
});

test('successful deletion waits for versioned archive acceptance then refreshes the first page once', async () => {
  const h = await readyList([shipment('page-0')], 26);
  h.button('next').props.onClick(); h.runTimers();
  h.listRequests()[1].resolve({ shipments: [shipment('page-1')], count: 26 });
  await settle();
  const remove = h.card('page-1').props.onDelete;
  remove(); remove();
  const actions = h.requests.filter(request => request.action === 'action');
  assert.equal(actions.length, 1, 'Repeated clicks while deleting share one mutation');
  assert.equal(actions[0].args[0], 'archive');
  assert.equal(actions[0].args[1].id, 'page-1');
  assert.equal(actions[0].args[1].version, 3);
  assert.deepEqual(h.rows(), ['page-1'], 'Do not optimistically remove before acceptance');
  actions[0].resolve({ shipment: shipment('page-1', { status: 'archived', version: 4 }) });
  await settle(); h.runTimers();
  assert.equal(h.listRequests().length, 3);
  assert.equal(h.listRequests()[2].args[0], 0);
  h.listRequests()[2].resolve({ shipments: [shipment('remaining')], count: 25 });
  await settle();
  assert.deepEqual(h.rows(), ['remaining']);
  assert.equal(h.find(node => node.props.role === 'status').props.children, 'draftDeleted');
  h.unmount();
});

test('dirty draft deletion requires explicit discard confirmation but never requires a save', async () => {
  const row = shipment('dirty-draft');
  const h = await readyList([row]); await editDraft(h, row);
  const remove = h.button('deleteDraft');
  assert.equal(remove.props.disabled, false);
  h.confirmWith(false); remove.props.onClick();
  assert.ok(h.confirmations.at(-1).includes('deleteUnsaved'));
  assert.equal(h.find(node => node.type === 'AddressFields' && node.props.prefix === 'sender').props.value.fullname, 'Unsaved contact');
  h.confirmWith(true); h.button('deleteDraft').props.onClick();
  const action = h.requests.at(-1);
  assert.equal(action.action, 'action');
  assert.equal(action.args[0], 'archive');
  assert.equal(h.requests.filter(request => request.action === 'save').length, 0);
  action.resolve({ shipment: { ...row, status: 'archived' } });
  await settle(); h.runTimers();
  assert.equal(h.find(node => node.type === 'AddressFields'), undefined);
  assert.equal(h.listRequests().at(-1).args[0], 0);
  h.unmount();
});

test('failed deletion and version conflict keep dirty editor input and do not refresh away the draft', async () => {
  for (const reason of ['provider_rejected', 'conflict']) {
    const row = shipment(`failed-${reason}`);
    const h = await readyList([row]); await editDraft(h, row);
    h.button('deleteDraft').props.onClick();
    h.requests.at(-1).reject(new Error(reason));
    await settle(); h.runTimers();
    assert.equal(h.find(node => node.type === 'AddressFields' && node.props.prefix === 'sender').props.value.fullname, 'Unsaved contact');
    assert.equal(h.listRequests().length, 1);
    assert.equal(h.button('deleteDraft').props.disabled, false);
    assert.equal(h.find(node => node.props.role === 'alert').props.children, reason === 'conflict' ? 'conflict' : 'providerRejected');
    h.unmount();
  }
});

test('deletion handler refuses non-drafts and any draft that already has tracking', async () => {
  for (const changes of [
    { status: 'submitting' }, { status: 'outcome_unknown' }, { status: 'waiting' },
    { status: 'delivered' }, { status: 'archived' }, { tracking_number: 'TRACK-1' },
  ]) {
    const row = shipment('protected', changes), h = await readyList([row]);
    h.card(row.id).props.onDelete();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.requests.filter(request => request.action === 'action').length, 0);
    h.card(row.id).props.onOpen();
    h.requests.at(-1).resolve({ shipment: row, events: [] });
    await settle(); h.render();
    assert.equal(h.button('deleteDraft'), undefined);
    h.unmount();
  }
});

test('actual list card offers edit/delete only for untracked drafts and open for protected shipments', () => {
  const cardCode = ts.transpileModule(readFileSync(new URL('../frontend/src/components/shipping/ShipmentListCard.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(cardCode, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => key });
    if (name === '@/components/ui/button') return { Button: 'Button' };
    if (name === '@/i18n') return { useLanguage: () => ({ language: 'en', t: { common: { edit: 'Edit' }, shipping: { open: 'Open', deleteDraft: 'Delete draft', statuses: {} } } }) };
    if (name === '@/lib/shipping-carriers') return { SHIPPING_CARRIER_OPTIONS: [], shippingCarrierBrand: () => ({ name: '' }) };
    if (name.endsWith('/shipping-domain')) return domain;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const buttons = value => {
    if (Array.isArray(value)) return value.flatMap(buttons);
    if (!value || typeof value !== 'object') return [];
    return value.type === 'Button' ? [value] : buttons(value.props?.children);
  };
  for (const changes of [{}, { status: 'waiting' }, { status: 'submitting' }, { status: 'outcome_unknown' }, { tracking_number: 'TRACK-1' }]) {
    let opened = 0, deleted = 0;
    const row = shipment('card', changes);
    const controls = buttons(exports.default({ shipment: row, busy: false, onOpen: () => opened++, onDelete: () => deleted++ }));
    const editable = row.status === 'draft' && !row.tracking_number;
    assert.equal(controls.length, editable ? 2 : 1);
    assert.equal(controls[0].props.children.at(-1), editable ? 'Edit' : 'Open');
    controls[0].props.onClick(); assert.equal(opened, 1);
    if (editable) { controls[1].props.onClick(); assert.equal(deleted, 1); }
    assert.ok(buttons(exports.default({ shipment: row, busy: true, onOpen() {}, onDelete() {} })).every(button => button.props.disabled));
  }
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
