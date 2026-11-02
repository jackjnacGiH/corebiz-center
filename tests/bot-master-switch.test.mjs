import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canSeeSettings } from '../frontend/src/lib/permissions.ts';
import { deferred, elements, mountComponent, settle, text } from './helpers/component-harness.mjs';

const componentPath = 'frontend/src/components/chat/BotMasterSwitch.tsx';
const source = readFileSync(new URL(`../${componentPath}`, import.meta.url), 'utf8');
const browserImport = "import { window, document } from 'test-browser';\n";
const controlSource = browserImport + source.replace('export default function BotMasterSwitch()', 'function BotMasterSwitch()') + '\nexport default BotMasterSwitchControl;\n';
const labels = {
  title: 'Master Kill-Switch', label: 'All-channel bot', shortLabel: 'Bot',
  on: 'ON', off: 'OFF', unknown: 'Unknown', loading: 'Loading', saving: 'Saving',
  confirmOff: 'Turn off the bot for all channels?', readError: 'Read failed',
  saveError: 'Save failed', retry: 'Retry',
};

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    emit(name) { for (const listener of listeners.get(name) ?? []) listener(); },
    count(name) { return listeners.get(name)?.size ?? 0; },
  };
}

function fixture(t, options = {}) {
  const reads = [], writes = [], confirmations = [];
  const window = eventTarget({ confirm: message => { confirmations.push(message); return options.confirm !== false; } });
  const document = eventTarget({ visibilityState: 'visible' });
  const services = {
    'test-browser': { window, document },
    '@/i18n': { useLanguage: () => ({ t: { chat: { masterBot: labels } } }) },
    '@/lib/AuthProvider': { useAuth: () => ({ profile: options.profile ?? { id: 'owner-A', role: 'owner' } }) },
    '@/lib/permissions': { canSeeSettings },
    '@/lib/api': { orgSettingsApi: {
      async getBotEnabled() { reads.push(reads.length); return options.read ? options.read(reads.length - 1) : true; },
      async setBotEnabled(value) { writes.push(value); if (options.write) return options.write(value); },
    } },
  };
  const app = mountComponent(componentPath, {}, services, options.outer ? browserImport + source : controlSource);
  t.after(() => app.unmount());
  return { app, reads, writes, confirmations, window, document };
}

function toggle(app) {
  const [button] = elements(app.tree, node => node.type === 'button' && node.props['aria-label']?.startsWith(labels.title));
  assert.ok(button, 'master switch control is rendered');
  return button;
}

async function loaded(app) { await settle(); app.render(); return toggle(app); }
const alerts = app => elements(app.tree, node => node.props.role === 'alert');

test('master switch stays unknown and cannot write until the first read completes', async t => {
  const first = deferred();
  const { app, writes, confirmations } = fixture(t, { read: () => first.promise });
  const button = toggle(app);
  assert.equal(button.props.disabled, true);
  assert.equal(button.props['aria-checked'], undefined);
  button.props.onClick();
  assert.deepEqual(writes, []);
  assert.deepEqual(confirmations, []);
  first.resolve(false);
  const ready = await loaded(app);
  assert.equal(ready.props.disabled, false);
  assert.equal(ready.props.role, 'switch');
  assert.equal(ready.props['aria-checked'], false);
});

test('cancelling the global OFF confirmation preserves ON without a write', async t => {
  const { app, writes, confirmations } = fixture(t, { confirm: false });
  (await loaded(app)).props.onClick();
  await settle(); app.render();
  assert.deepEqual(confirmations, [labels.confirmOff]);
  assert.deepEqual(writes, []);
  assert.equal(toggle(app).props['aria-checked'], true);
});

test('confirmed OFF waits for the write and authoritative read-back before displaying OFF', async t => {
  const save = deferred(), verify = deferred();
  const { app, reads, writes } = fixture(t, {
    read: index => index === 0 ? true : verify.promise,
    write: () => save.promise,
  });
  (await loaded(app)).props.onClick(); app.render();
  assert.deepEqual(writes, [false]);
  assert.equal(toggle(app).props.disabled, true);
  assert.equal(toggle(app).props['aria-checked'], true);
  save.resolve(); await settle(); app.render();
  assert.equal(reads.length, 2);
  assert.equal(toggle(app).props['aria-checked'], true);
  assert.equal(toggle(app).props.disabled, true);
  verify.resolve(false);
  const ready = await loaded(app);
  assert.equal(ready.props['aria-checked'], false);
  assert.equal(ready.props.disabled, false);
  assert.equal(alerts(app).length, 0);
});

test('a zero-row or competing update cannot falsely claim the global bot is OFF', async t => {
  const { app, writes, reads } = fixture(t, { read: () => true });
  (await loaded(app)).props.onClick();
  await settle(); app.render();
  assert.deepEqual(writes, [false]);
  assert.equal(reads.length, 2);
  assert.equal(toggle(app).props['aria-checked'], true);
  assert.equal(alerts(app).length, 1);
  assert.match(text(alerts(app)[0]), /Save failed/);
});

test('a failed write produces unknown state and retry recovers from the server', async t => {
  const { app, writes } = fixture(t, {
    read: index => index === 0 ? true : false,
    write: () => { throw new Error('denied'); },
  });
  (await loaded(app)).props.onClick();
  await settle(); app.render();
  assert.deepEqual(writes, [false]);
  assert.equal(toggle(app).props['aria-checked'], undefined);
  assert.equal(toggle(app).props.disabled, true);
  assert.match(text(alerts(app)[0]), /Save failed/);
  const [retry] = elements(alerts(app)[0], node => node.type === 'button' && text(node) === labels.retry);
  retry.props.onClick();
  const ready = await loaded(app);
  assert.equal(ready.props['aria-checked'], false);
  assert.equal(ready.props.disabled, false);
  assert.equal(alerts(app).length, 0);
});

test('two clicks before rerender produce one global write and one confirmation', async t => {
  const save = deferred();
  const { app, writes, confirmations } = fixture(t, {
    read: index => index === 0 ? true : false,
    write: () => save.promise,
  });
  const button = await loaded(app);
  button.props.onClick(); button.props.onClick();
  assert.deepEqual(writes, [false]);
  assert.deepEqual(confirmations, [labels.confirmOff]);
  save.resolve(); await loaded(app);
  assert.equal(toggle(app).props['aria-checked'], false);
});

test('a focus read superseded by a write cannot overwrite its state or leave it busy', async t => {
  const stale = deferred();
  const { app, window, writes } = fixture(t, {
    read: index => index === 0 ? true : index === 1 ? stale.promise : false,
  });
  const button = await loaded(app);
  window.emit('focus');
  // Focus and click can arrive before React commits the loading rerender.
  button.props.onClick();
  await settle(); app.render();
  assert.deepEqual(writes, [false]);
  assert.equal(toggle(app).props['aria-checked'], false);
  stale.resolve(true); await settle(); app.render();
  assert.equal(toggle(app).props['aria-checked'], false);
  assert.equal(toggle(app).props.disabled, false);
  assert.equal(toggle(app).props['aria-busy'], false);
});

test('unmount cleans browser listeners and ignores a pending read result', async t => {
  const read = deferred();
  const { app, window, document } = fixture(t, { read: () => read.promise });
  assert.equal(window.count('focus'), 1);
  assert.equal(document.count('visibilitychange'), 1);
  app.unmount();
  assert.equal(window.count('focus'), 0);
  assert.equal(document.count('visibilitychange'), 0);
  read.resolve(true); await settle(); app.render();
  assert.equal(toggle(app).props['aria-checked'], undefined);
});

test('header control retains Settings role access: owner/admin only', t => {
  for (const role of ['owner', 'admin', 'staff', 'agent', 'viewer', 'customer']) {
    const { app } = fixture(t, { outer: true, profile: { id: `${role}-user`, role } });
    if (role === 'owner' || role === 'admin') {
      assert.equal(app.tree.type.name, 'BotMasterSwitchControl');
    } else {
      assert.equal(app.tree, null, `${role} cannot mount the global control`);
    }
  }
});
