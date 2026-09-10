import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as domain from '../supabase/functions/_shared/shipping-domain.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../frontend/src/pages/Shipping.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bootstrap = () => ({ manager: true, settings: { environment: 'uat', origin: domain.emptyAddress() },
  brand: { name: 'Test company' }, accounts: [], readReady: true, sendReady: false });
const shipment = (id, changes = {}) => ({ id, reference_no: id, draft: domain.emptyDraft(), status: 'draft', tracking_number: null, version: 3, created_at: '2026-09-09T00:00:00Z', ...changes });
const submittableShipment = id => {
  const address = suffix => ({
    ...domain.emptyAddress(), fullname: `Contact ${suffix}`, address: `Address ${suffix}`,
    county: 'แพรกษาใหม่', city: 'เมืองสมุทรปราการ', state: 'สมุทรปราการ',
    postcode: '10280', email: `${suffix}@example.test`, telephone1: '0800000000',
  });
  return shipment(id, { draft: {
    ...domain.emptyDraft(), carrier_code: 'EMS_SPEED', origin: address('origin'), destination: address('destination'),
    box_width: 10, box_height: 10, box_length: 10, box_weight: 100,
    products: [{ name: 'Test item', code: 'SKU-1', qty: 1, price: '0.00', weight: 0 }],
  } });
};

// Execute the actual component with deterministic hooks and deferred requests.
// JSX remains inspectable, so tests invoke the same handlers as user controls.
// This deliberately does not simulate browser layout, printing, or network time.
function mount(query = '') {
  const slots = [], effects = [], requests = [], confirmations = [], clipboard = [], popups = [], prints = [];
  const timers = new Map();
  let cursor = 0, timerId = 0, tree, dirty = false;
  let focusRestores = 0;
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
  const shippingWords = new Proxy({
    statuses: words,
    quoteIssues: words,
    submissionIssues: words,
    providerIssues: words,
  }, {
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
      if (name === '@/lib/shipping-validation') return {
        shippingDraftFieldIssueMessage: issue => `${issue.field}:${issue.reason}`,
      };
      if (name.endsWith('/shipping-domain')) return domain;
      if (name === '@/lib/shipping-carriers') return { shippingTrackingUrl: () => null };
      if (name === '@/lib/provider-label') return { providerLabelResource: link => ({ kind: 'external', href: link }) };
      if (name === '@/lib/print') return { printElement: (...args) => { prints.push(args); } };
      if (name === '@/components/ui/button') return { Button: 'Button' };
      if (name === '@/components/ui/input') return { Input: 'Input' };
      if (name === '@/components/ui/dialog') return Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, name]));
      if (name === '@/components/shipping/ShippingLabel') return { default: 'ShippingLabel', SHIPPING_LABEL_ID: 'shipping-label-batch' };
      if (name.startsWith('@/components/')) return { default: name.split('/').at(-1) };
      throw new Error(`Unexpected dependency ${name}`);
    },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    window: {
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
      addEventListener() {}, removeEventListener() {}, confirm: message => { confirmations.push(message); return confirmResult; },
      open() {
        const popup = { opener: {}, href: '', closed: false, location: { replace(value) { popup.href = value; } }, close() { popup.closed = true; } };
        popups.push(popup);
        return popup;
      },
    },
    navigator: { clipboard: { writeText: async value => { clipboard.push(value); } } },
    document: { activeElement: { focus() { focusRestores++; } }, addEventListener() {}, removeEventListener() {} },
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
      // The shared Dialog portal does not mount its children while closed.
      if (value.type === 'Dialog' && !value.props.open) return result;
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
    requests, confirmations, clipboard, popups, prints, render, find, button,
    focusRestores: () => focusRestores,
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

test('shipment list expands only one row and collapses it again', async () => {
  const first = shipment('compact-first');
  const second = shipment('compact-second');
  const h = await readyList([first, second]);

  assert.equal(h.card(first.id).props.expanded, false);
  assert.equal(h.card(second.id).props.expanded, false);

  h.card(first.id).props.onToggle();
  assert.equal(h.card(first.id).props.expanded, true);
  assert.equal(h.card(second.id).props.expanded, false);

  h.card(second.id).props.onToggle();
  assert.equal(h.card(first.id).props.expanded, false);
  assert.equal(h.card(second.id).props.expanded, true);

  h.card(second.id).props.onToggle();
  assert.equal(h.card(first.id).props.expanded, false);
  assert.equal(h.card(second.id).props.expanded, false);

  h.card(first.id).props.onToggle();
  h.search('another recipient');
  assert.equal(h.card(first.id).props.expanded, false, 'Changing the search closes the open row immediately');
  h.unmount();
});

test('list actions copy tracking, open a carrier label, and refresh a row without opening the editor', async () => {
  const row = shipment('tracked-list', {
    status: 'waiting', tracking_number: 'TRACK-1', version: 3,
    recipient_company: 'List-only recipient company',
    draft: { ...domain.emptyDraft(), carrier_code: 'FLASH_EXPRESS_SPEED' },
  });
  const h = await readyList([row]);
  const card = h.card(row.id);

  card.props.onCopyTracking('https://tracking.example.test/TRACK-1');
  await settle(); h.render();
  assert.deepEqual(h.clipboard, ['https://tracking.example.test/TRACK-1']);
  assert.equal(h.find(node => node.props.role === 'status').props.children, 'trackingCopied');
  assert.equal(h.requests.filter(request => request.action === 'get').length, 0, 'A list action must not open the editor');

  h.card(row.id).props.onCarrierLabel();
  assert.equal(h.popups.length, 1, 'The label tab is reserved during the click');
  const print = h.requests.at(-1);
  assert.equal(print.action, 'print');
  assert.equal(print.args[0].id, row.id);
  print.resolve({ link: 'https://labels.example.test/TRACK-1.pdf' });
  await settle(); h.render();
  assert.equal(h.popups[0].opener, null);
  assert.equal(h.popups[0].href, 'https://labels.example.test/TRACK-1.pdf');

  h.card(row.id).props.onRefreshStatus();
  const refresh = h.requests.at(-1);
  assert.equal(refresh.action, 'action');
  assert.equal(refresh.args[0], 'refresh_status');
  assert.equal(refresh.args[1].version, 3);
  const { recipient_company: _listOnlyCompany, ...detailShipment } = row;
  refresh.resolve({ shipment: { ...detailShipment, version: 4 } });
  await settle(); h.render();
  assert.equal(h.card(row.id).props.shipment.version, 4, 'The refreshed row is replaced in place');
  assert.equal(
    h.card(row.id).props.shipment.recipient_company,
    'List-only recipient company',
    'Status refresh must preserve list-only recipient details',
  );
  assert.equal(h.find(node => node.props.role === 'status').props.children, 'statusChecked: waiting');
  assert.equal(h.requests.filter(request => request.action === 'get').length, 0);
  h.unmount();
});

test('a list J NAC label preview waits for its lazy module then prints without provider or shipment mutations', async () => {
  const row = shipment('draft-label', {
    draft: { ...domain.emptyDraft(), parcel_total: 2 },
  });
  const h = await readyList([row]);
  const baselineRequests = h.requests.length;

  h.card(row.id).props.onJnacLabel();
  const dialogContent = h.find(node => node.props.role === 'dialog' && node.props['aria-label'] === 'labelPreview');
  assert.ok(dialogContent);
  assert.equal(h.find(node => node.type === 'Dialog' && node.props.open).props.open, true, 'The shared dialog provides focus trapping and Escape handling');
  assert.equal(h.find(node => node.type === 'ShippingLabel'), undefined, 'The preview waits for the lazy label module');
  assert.equal(h.button('printLabel').props.disabled, true);
  assert.equal(h.requests.length, baselineRequests, 'Opening a J NAC label must not call a provider or shipment API');

  await settle(); h.render();
  const preview = h.find(node => node.type === 'ShippingLabel');
  assert.equal(preview.props.shipment.id, row.id);
  assert.equal(preview.props.companyName, 'Test company');
  assert.equal(h.button('printLabel').props.disabled, false);
  h.button('printLabel').props.onClick();
  assert.equal(h.prints.length, 1);
  assert.equal(h.prints[0][0], 'shipping-label-batch');
  assert.equal(h.prints[0][1].title, 'labelPreview draft-label');
  assert.equal(h.prints[0][1].pageSize, 'label-100x150');
  assert.equal(h.requests.length, baselineRequests, 'Printing a J NAC label must not call shippingApi.print or consume carrier credit');
  assert.equal(h.find(node => node.type === 'AddressFields'), undefined, 'The list action never opens the editor');
  let focusDefaultPrevented = false;
  h.find(node => node.type === 'Dialog' && node.props.open).props.onOpenChange(false);
  dialogContent.props.onCloseAutoFocus({ preventDefault: () => { focusDefaultPrevented = true; } });
  h.render();
  assert.equal(h.find(node => node.props.role === 'dialog' && node.props['aria-label'] === 'labelPreview'), undefined);
  assert.equal(focusDefaultPrevented, true);
  assert.equal(h.focusRestores(), 1, 'Closing returns keyboard focus to the originating list action');
  h.unmount();
});

test('a carrier-label failure closes the reserved tab and reports the existing API error', async () => {
  const row = shipment('label-error', {
    status: 'waiting', tracking_number: 'TRACK-2',
    draft: { ...domain.emptyDraft(), carrier_code: 'FLASH_EXPRESS_SPEED' },
  });
  const h = await readyList([row]);
  h.card(row.id).props.onCarrierLabel();
  h.requests.at(-1).reject(new Error('provider_unreachable'));
  await settle(); h.render();
  assert.equal(h.popups[0].closed, true);
  assert.equal(h.find(node => node.props.role === 'alert').props.children, 'providerUnreachable');
  assert.equal(h.card(row.id).props.activeAction, null);
  h.unmount();
});

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
  h.card('draft-1').props.onDelete();
  assert.equal(h.confirmations.length, 0, 'Deletion must not open a native browser confirmation');
  assert.ok(h.find(node => node.type === 'DialogContent' && node.props.role === 'alertdialog'));
  assert.ok(h.find(node => node.type === 'p' && node.props.children === 'draft-1'));
  assert.equal(h.requests.filter(request => request.action === 'action').length, 0, 'Opening confirmation is not authorization to delete');
  h.button('cancel').props.onClick();
  assert.equal(h.find(node => node.type === 'Dialog'), undefined);
  assert.equal(h.requests.filter(request => request.action === 'action').length, 0);
  assert.deepEqual(h.rows(), ['draft-1']);
  h.unmount();
});

test('successful deletion waits for versioned archive acceptance then refreshes the first page once', async () => {
  const h = await readyList([shipment('page-0')], 26);
  h.button('next').props.onClick(); h.runTimers();
  h.listRequests()[1].resolve({ shipments: [shipment('page-1')], count: 26 });
  await settle();
  h.card('page-1').props.onDelete();
  const remove = h.button('confirmDeleteAction').props.onClick;
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
  remove.props.onClick();
  assert.ok(h.find(node => node.type === 'p' && node.props.children === 'deleteUnsaved'));
  h.button('cancel').props.onClick();
  assert.equal(h.find(node => node.type === 'AddressFields' && node.props.prefix === 'sender').props.value.fullname, 'Unsaved contact');
  h.button('deleteDraft').props.onClick();
  h.button('confirmDeleteAction').props.onClick();
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
    h.button('confirmDeleteAction').props.onClick();
    h.requests.at(-1).reject(new Error(reason));
    await settle(); h.runTimers();
    assert.equal(h.find(node => node.type === 'AddressFields' && node.props.prefix === 'sender').props.value.fullname, 'Unsaved contact');
    assert.equal(h.listRequests().length, 1);
    assert.equal(h.button('deleteDraft').props.disabled, false);
    assert.equal(h.find(node => node.props.role === 'alert').props.children, reason === 'conflict' ? 'conflict' : 'providerRejected');
    h.unmount();
  }
});

test('definite submit rejection syncs the restored draft version before another edit action', async () => {
  const row = submittableShipment('rejected-submit');
  const h = mount(); h.runTimers();
  h.requests[0].resolve({ ...bootstrap(), sendReady: true });
  h.listRequests()[0].resolve({ shipments: [row], count: 1 });
  await settle(); h.render();
  h.card(row.id).props.onOpen();
  h.requests.at(-1).resolve({ shipment: row, events: [] });
  await settle(); h.render();

  assert.equal(h.find(node => node.type === 'Input' && node.props['aria-label'] === 'weight 1'), undefined);
  h.button('submit').props.onClick();
  assert.equal(h.confirmations.length, 0, 'Submit starts directly without a browser confirmation');
  const submit = h.requests.at(-1);
  assert.equal(submit.action, 'action');
  assert.equal(submit.args[0], 'submit');
  const restored = { ...row, status: 'draft', version: 5 };
  submit.reject(Object.assign(new Error('provider_rejected'), { shipment: restored }));
  await settle(); h.render();

  assert.equal(h.find(node => node.props.role === 'alert').props.children, 'providerRejected');
  h.button('deleteDraft').props.onClick();
  h.button('confirmDeleteAction').props.onClick();
  const nextAction = h.requests.at(-1);
  assert.equal(nextAction.args[0], 'archive');
  assert.equal(nextAction.args[1].version, 5, 'the page must use the restored server version');
  h.unmount();
});

test('a safe provider rejection detail replaces the generic error with an actionable reason', async () => {
  const row = submittableShipment('phone-rejected');
  const h = mount(); h.runTimers();
  h.requests[0].resolve({ ...bootstrap(), sendReady: true });
  h.listRequests()[0].resolve({ shipments: [row], count: 1 });
  await settle(); h.render();
  h.card(row.id).props.onOpen();
  h.requests.at(-1).resolve({ shipment: row, events: [] });
  await settle(); h.render();

  h.button('submit').props.onClick();
  h.requests.at(-1).reject(Object.assign(new Error('provider_rejected'), {
    shipment: { ...row, version: 5 }, detail: 'invalid_phone',
  }));
  await settle(); h.render();

  assert.equal(h.find(node => node.props.role === 'alert').props.children, 'invalid_phone');
  h.unmount();
});

test('an oversized box shows the specific dimension blocker before quote or submit', async () => {
  const row = submittableShipment('oversized-box');
  row.draft.box_length = domain.SHIPPING_BOX_DIMENSION_MAX_CM + 1;
  const h = mount(); h.runTimers();
  h.requests[0].resolve({ ...bootstrap(), sendReady: true });
  h.listRequests()[0].resolve({ shipments: [row], count: 1 });
  await settle(); h.render();
  h.card(row.id).props.onOpen();
  h.requests.at(-1).resolve({ shipment: row, events: [] });
  await settle(); h.render();

  const comparison = h.find(node => node.type === 'ShippingRateComparison');
  assert.deepEqual([...comparison.props.blockers], ['box_length', 'box_length:number_above_max']);
  assert.equal(h.button('submit').props.disabled, true);
  assert.equal(h.requests.filter(request => request.action === 'action').length, 0);
  h.unmount();
});

test('deletion handler refuses non-drafts and any draft that already has tracking', async () => {
  for (const changes of [
    { status: 'submitting' }, { status: 'outcome_unknown' }, { status: 'waiting' },
    { status: 'delivered' }, { status: 'archived' }, { tracking_number: 'TRACK-1' },
  ]) {
    const row = shipment('protected', changes), h = await readyList([row]);
    h.card(row.id).props.onDelete();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.find(node => node.type === 'Dialog'), undefined);
    assert.equal(h.requests.filter(request => request.action === 'action').length, 0);
    h.card(row.id).props.onOpen();
    h.requests.at(-1).resolve({ shipment: row, events: [] });
    await settle(); h.render();
    assert.equal(h.button('deleteDraft'), undefined);
    h.unmount();
  }
});

test('actual list card stays compact until expanded and preserves shipment actions', () => {
  const cardCode = ts.transpileModule(readFileSync(new URL('../frontend/src/components/shipping/ShipmentListCard.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(cardCode, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => key });
    if (name === '@/components/ui/button') return { Button: 'Button' };
    if (name === '@/i18n') return { useLanguage: () => ({ language: 'en', t: { common: { edit: 'Edit' }, shipping: new Proxy({ open: 'Open', deleteDraft: 'Delete draft', statuses: {} }, { get: (target, key) => key in target ? target[key] : key }) } }) };
    if (name === '@/lib/shipping-carriers') return {
      SHIPPING_CARRIER_OPTIONS: [], shippingCarrierBrand: () => ({ name: '' }),
      shippingTrackingUrl: (_carrier, tracking) => `https://tracking.example.test/${tracking}`,
    };
    if (name.endsWith('/shipping-domain')) return domain;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const nodes = value => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object') return [];
    return [value, ...nodes(value.props?.children)];
  };
  const buttons = value => nodes(value).filter(node => node.type === 'Button');
  const renderCard = (row, changes = {}) => exports.default({
    shipment: row, expanded: false, busy: false, readReady: true, activeAction: null,
    onToggle() {}, onOpen() {}, onDelete() {}, onJnacLabel() {}, onCopyTracking() {}, onCarrierLabel() {}, onRefreshStatus() {},
    ...changes,
  });
  for (const changes of [{}, { status: 'waiting' }, { status: 'submitting' }, { status: 'outcome_unknown' }]) {
    let toggled = 0, opened = 0, deleted = 0;
    const row = shipment('card', changes);
    const collapsed = renderCard(row, { onToggle: () => toggled++ });
    const summary = nodes(collapsed).find(node => node.type === 'button' && node.props['data-shipment-block'] === 'summary');
    assert.ok(summary, 'Collapsed row has one full-width summary trigger');
    assert.equal(summary.props['aria-expanded'], false);
    assert.equal(buttons(collapsed).length, 0, 'Collapsed rows expose no command controls');
    assert.deepEqual(nodes(collapsed).filter(node => node.props?.['data-shipment-block']).map(node => node.props['data-shipment-block']), ['summary']);
    summary.props.onClick(); assert.equal(toggled, 1);

    const controls = buttons(renderCard(row, { expanded: true, onOpen: () => opened++, onDelete: () => deleted++ }));
    const editable = row.status === 'draft' && !row.tracking_number;
    assert.equal(controls.length, editable ? 3 : 2);
    assert.ok(controls.find(button => button.props['aria-label'] === `jnacPrint ${row.reference_no}`), 'Every saved shipment has a J NAC label action');
    assert.equal(controls[0].props.children.at(-1), editable ? 'Edit' : 'Open');
    controls[0].props.onClick(); assert.equal(opened, 1);
    if (editable) { controls[1].props.onClick(); assert.equal(deleted, 1); }
    assert.ok(buttons(renderCard(row, { expanded: true, busy: true })).every(button => button.props.disabled));
  }

  const tracked = shipment('tracked', {
    status: 'waiting', tracking_number: 'TRACK-1',
    draft: { ...domain.emptyDraft(), carrier_code: 'FLASH_EXPRESS_SPEED' },
  });
  let copied = '', jnacLabels = 0, labels = 0, refreshed = 0, bubbles = 0;
  const tree = renderCard(tracked, {
    expanded: true,
    onJnacLabel: () => jnacLabels++,
    onCopyTracking: url => { copied = url; },
    onCarrierLabel: () => labels++, onRefreshStatus: () => refreshed++,
  });
  const blocks = new Map(nodes(tree)
    .filter(node => node.props?.['data-shipment-block'])
    .map(node => [node.props['data-shipment-block'], node]));
  assert.deepEqual([...blocks.keys()], ['summary', 'details', 'recipient', 'sender', 'parcel', 'actions']);
  assert.match(tree.props.className, /border-l-\[var\(--brand-blue\)\]/);
  assert.equal(blocks.get('summary').props['aria-expanded'], true);
  assert.equal(blocks.get('summary').props['aria-controls'], blocks.get('details').props.id);
  assert.equal(blocks.get('details').props.role, 'region');
  const cardHeadings = nodes(tree).filter(node => node.type === 'h3');
  assert.ok(cardHeadings.every(heading => heading.props.className.includes('shipment-list-card-heading')));
  assert.match(
    readFileSync(new URL('../frontend/src/index.css', import.meta.url), 'utf8'),
    /\.shipment-list-card-heading\s*\{\s*color:\s*#FFFFFF;\s*\}/,
    'The unlayered heading color must override the legacy global heading rule',
  );
  const sectionBackgrounds = ['recipient', 'sender', 'parcel', 'actions'].map(name =>
    blocks.get(name).props.className.split(' ').find(className => className.startsWith('bg-')),
  );
  assert.equal(new Set(sectionBackgrounds).size, 4, 'Each shipment section uses a distinct background');
  for (const name of ['recipient', 'sender', 'parcel', 'actions']) {
    const labelledBy = blocks.get(name).props['aria-labelledby'];
    assert.ok(nodes(blocks.get(name)).some(node => node.props?.id === labelledBy), `${name} block has a visible heading`);
  }
  const controls = buttons(tree);
  assert.equal(controls.length, 6, 'Open plus the J NAC label and four tracked-shipment actions');
  const event = { stopPropagation: () => bubbles++ };
  controls.find(button => button.props['aria-label'] === `jnacPrint ${tracked.reference_no}`).props.onClick(event);
  controls.find(button => button.props['aria-label'] === 'copyTrackingLink').props.onClick(event);
  controls.find(button => button.props['aria-label'] === 'carrierPrint').props.onClick(event);
  controls.find(button => button.props['aria-label'] === 'poll').props.onClick(event);
  const trackingAnchor = nodes(tree).find(node => node.type === 'a' && node.props['aria-label'] === 'openTracking');
  trackingAnchor.props.onClick(event);
  assert.equal(copied, 'https://tracking.example.test/TRACK-1');
  assert.equal(jnacLabels, 1);
  assert.equal(labels, 1);
  assert.equal(refreshed, 1);
  assert.equal(bubbles, 5, 'Every list action stops the surrounding card event');
  assert.equal(trackingAnchor.props.rel, 'noopener noreferrer');

  const pricedTree = renderCard({ ...tracked, order_shipping_fee: 45.5 }, { expanded: false });
  assert.match(JSON.stringify(pricedTree), /45\.50/, 'The compact row displays the persisted order shipping fee');
  assert.match(JSON.stringify(renderCard(tracked)), /shippingFeeUnavailable/, 'Missing shipping fees use an explicit fallback');
  assert.match(JSON.stringify(renderCard({ ...tracked, order_shipping_fee: 0 })), /shippingFeeUnavailable/, 'An ambiguous default zero is not presented as a confirmed carrier price');

  const disconnected = buttons(renderCard(tracked, { expanded: true, readReady: false }));
  assert.equal(disconnected.find(button => button.props['aria-label'] === `jnacPrint ${tracked.reference_no}`).props.disabled, false);
  assert.equal(disconnected.find(button => button.props['aria-label'] === 'carrierPrint').props.disabled, true);
  assert.equal(disconnected.find(button => button.props['aria-label'] === 'poll').props.disabled, true);
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
