import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRefreshQueue } from '../frontend/src/lib/refreshQueue.ts';

// Exercise the real hook against a small commit/effect lifecycle and a mock
// channel. No DOM or database is needed to verify subscription ownership.
function harness() {
  const slots = [];
  let index = 0;
  let scheduled = [];
  const channels = [];
  const removed = [];
  function effect(phase, setup, deps) {
    const slotIndex = index++;
    const previous = slots[slotIndex];
    if (!previous || deps.some((dependency, i) => !Object.is(dependency, previous.deps[i]))) {
      scheduled.push({ phase, slotIndex, setup, deps });
    }
  }
  const react = {
    useRef(initial) {
      const slotIndex = index++;
      return slots[slotIndex] ??= { current: initial };
    },
    useCallback(callback, deps) {
      const slotIndex = index++;
      const previous = slots[slotIndex];
      if (!previous || deps.some((dependency, i) => !Object.is(dependency, previous.deps[i]))) {
        slots[slotIndex] = { callback, deps };
      }
      return slots[slotIndex].callback;
    },
    useLayoutEffect: (setup, deps) => effect(0, setup, deps),
    useEffect: (setup, deps) => effect(1, setup, deps),
  };
  const supabase = {
    channel(name) {
      const channel = {
        name,
        on(event, filter, callback) { Object.assign(this, { event, filter, callback }); return this; },
        subscribe() { channels.push(this); return this; },
      };
      return channel;
    },
    removeChannel(channel) { removed.push(channel); return Promise.resolve(); },
  };
  const source = readFileSync(new URL('../frontend/src/lib/useRealtimeTable.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(outputText, { exports, require: name => {
    if (name === 'react') return react;
    if (name === './supabase') return { supabase };
    if (name === './refreshQueue') return { createRefreshQueue };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return {
    channels, removed,
    render(table, onChange) { index = 0; scheduled = []; exports.useRealtimeTable(table, onChange); },
    renderMany(tables, onRefresh) {
      index = 0; scheduled = [];
      const refresh = exports.useRealtimeRefresh(onRefresh);
      for (const table of tables) exports.useRealtimeTable(table, refresh);
    },
    commit() {
      for (const next of scheduled.sort((a, b) => a.phase - b.phase)) {
        slots[next.slotIndex]?.cleanup?.();
        slots[next.slotIndex] = { deps: next.deps, setup: next.setup, phase: next.phase, cleanup: next.setup() };
      }
      scheduled = [];
    },
    replayEffects() {
      const effects = slots.filter(slot => slot?.setup).sort((a, b) => a.phase - b.phase);
      for (const slot of effects) slot.cleanup?.();
      for (const slot of effects) slot.cleanup = slot.setup();
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('inline callback changes keep one subscription and call the latest committed handler', () => {
  const hooks = harness();
  const called = [];
  hooks.render('inventory', () => called.push('first'));
  hooks.commit();
  const channel = hooks.channels[0];
  assert.equal(channel.name, 'realtime:inventory');
  assert.equal(channel.filter.table, 'inventory');
  assert.equal(channel.filter.event, '*');
  channel.callback();
  for (let i = 0; i < 10; i++) {
    hooks.render('inventory', () => called.push(`render-${i}`));
    hooks.commit();
  }
  channel.callback();
  assert.deepEqual(called, ['first', 'render-9']);
  assert.equal(hooks.channels.length, 1);
  assert.equal(hooks.removed.length, 0);
  hooks.unmount();
  assert.deepEqual(hooks.removed, [channel]);
});

test('an uncommitted render never changes the active callback', () => {
  const hooks = harness();
  const called = [];
  hooks.render('orders', () => called.push('committed'));
  hooks.commit();
  hooks.render('orders', () => called.push('discarded'));
  hooks.channels[0].callback();
  assert.deepEqual(called, ['committed']);
  hooks.render('orders', () => called.push('next'));
  hooks.commit();
  hooks.channels[0].callback();
  assert.deepEqual(called, ['committed', 'next']);
});

test('table changes replace only their channel and clean up on unmount', () => {
  const hooks = harness();
  const called = [];
  hooks.render('orders', () => called.push('orders'));
  hooks.commit();
  hooks.render('quotes', () => called.push('quotes'));
  hooks.commit();
  assert.equal(hooks.channels.length, 2);
  assert.strictEqual(hooks.removed[0], hooks.channels[0]);
  assert.equal(hooks.channels[1].filter.table, 'quotes');
  hooks.channels[1].callback();
  assert.deepEqual(called, ['quotes']);
  hooks.unmount();
  assert.deepEqual(hooks.removed, hooks.channels);
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('multiple table subscriptions share one refresh queue and its latest committed callback', async () => {
  const hooks = harness();
  const first = deferred();
  const second = deferred();
  const called = [];
  hooks.renderMany(['products', 'inventory', 'product_groups'], () => {
    called.push('first'); return first.promise;
  });
  hooks.commit();
  const cycle = hooks.channels[0].callback();
  assert.deepEqual(called, ['first']);
  hooks.channels[1].callback();
  hooks.channels[2].callback();
  hooks.renderMany(['products', 'inventory', 'product_groups'], () => {
    called.push('latest'); return second.promise;
  });
  hooks.commit();
  assert.equal(hooks.channels.length, 3, 'rerender retains all existing channels');
  first.resolve();
  await settled();
  assert.deepEqual(called, ['first', 'latest']);
  second.resolve();
  await cycle;
  hooks.unmount();
  assert.equal(hooks.removed.length, 3);
});

test('discarded render callbacks never run in queued refreshes', async () => {
  const hooks = harness();
  const first = deferred();
  let committed = 0, discarded = 0;
  hooks.renderMany(['orders', 'quotes'], () => {
    committed++; return committed === 1 ? first.promise : Promise.resolve();
  });
  hooks.commit();
  const cycle = hooks.channels[0].callback();
  hooks.channels[1].callback();
  hooks.renderMany(['orders', 'quotes'], async () => { discarded++; });
  first.resolve();
  await cycle;
  assert.equal(committed, 2);
  assert.equal(discarded, 0);
});

test('StrictMode effect cleanup/reactivation replaces the queue without reviving disposed work', async () => {
  const hooks = harness();
  const reads = [];
  hooks.renderMany(['inventory'], () => {
    const read = deferred(); reads.push(read); return read.promise;
  });
  hooks.commit();
  const oldCycle = hooks.channels[0].callback();
  hooks.channels[0].callback();
  hooks.replayEffects();
  assert.strictEqual(hooks.removed[0], hooks.channels[0]);
  const newCycle = hooks.channels[1].callback();
  assert.equal(reads.length, 2);
  reads[0].resolve();
  await oldCycle;
  assert.equal(reads.length, 2, 'disposed queue does not run its previous trailing work');
  reads[1].resolve();
  await newCycle;
  hooks.unmount();
  await hooks.channels[1].callback();
  assert.equal(reads.length, 2, 'late event after unmount cannot start a query');
});
