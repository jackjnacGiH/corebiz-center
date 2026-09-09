import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { clearListCache, hasCache, swrList } from '../frontend/src/lib/cache.ts';

const source = readFileSync(new URL('../frontend/src/lib/AuthProvider.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const session = (id, token = 'first') => ({ user: { id }, access_token: token });
const profile = (id, changes = {}) => ({ id, role: 'staff', is_active: true, ...changes });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

// Run the actual provider with deterministic hooks, auth notifications and a
// manual timer queue. This covers races without a DOM or a real signed-in user.
function mount(initialSession) {
  const slots = [];
  const effects = [];
  const timers = new Map();
  const requests = [];
  const diagnostics = [];
  let cursor = 0;
  let nextTimer = 0;
  let listener;
  let insideAuthCallback = false;
  let sessionReads = 0;
  let cacheClears = 0;
  let stateWrites = 0;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => { throw new Error('No consumer needed'); },
    useRef: value => {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        ++stateWrites;
        slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      }];
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: (setup, deps) => {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, setup, cleanup: setup() };
        });
      }
    },
  };
  const emit = (event, value) => {
    insideAuthCallback = true;
    try { listener?.(event, value); } finally { insideAuthCallback = false; }
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (_type, props) => props };
      if (name === './cache') return { clearListCache: () => { ++cacheClears; clearListCache(); } };
      if (name !== './supabase') throw new Error(`Unexpected dependency ${name}`);
      return {
        supabase: { auth: {
          getSession: async () => {
            ++sessionReads;
            return { data: { session: initialSession } };
          },
          onAuthStateChange: callback => {
            listener = callback;
            queueMicrotask(() => {
              if (listener === callback) emit('INITIAL_SESSION', initialSession);
            });
            return { data: { subscription: { unsubscribe: () => { listener = undefined; } } } };
          },
        } },
        fetchProfile: id => {
          assert.equal(insideAuthCallback, false, 'Supabase query must run after the auth callback');
          return new Promise((resolve, reject) => requests.push({ id, resolve, reject }));
        },
      };
    },
    console: { error: message => diagnostics.push(message) },
    window: {
      setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: id => timers.delete(id),
    },
  });
  const render = () => {
    cursor = 0;
    const value = exports.AuthProvider({ children: 'child' }).value;
    while (effects.length) effects.shift()();
    return value;
  };
  render();
  return {
    emit, requests, diagnostics,
    get value() { return render(); },
    get sessionReads() { return sessionReads; },
    get cacheClears() { return cacheClears; },
    get stateWrites() { return stateWrites; },
    get pendingTimers() { return timers.size; },
    runTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    replayEffects() {
      for (const slot of slots) {
        if (!slot?.setup) continue;
        slot.cleanup?.();
        slot.cleanup = slot.setup();
      }
    },
  };
}

test('bootstrap uses one deferred profile query from INITIAL_SESSION, not a parallel session read', async () => {
  const h = mount(session('a'));
  assert.equal(h.value.loading, true);
  await settle();
  assert.equal(h.sessionReads, 0);
  assert.equal(h.requests.length, 0);
  h.runTimers();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(profile('a'));
  await settle();
  assert.equal(h.value.profile.id, 'a');
  assert.equal(h.value.loading, false);
  h.unmount();
});

test('empty or failed stored-session initialization exits loading without any profile access', async () => {
  // auth-js reports INITIAL_SESSION null both for no stored session and for a
  // failed stored-session recovery. The provider must handle this single path.
  const h = mount(null);
  await settle();
  h.runTimers();
  assert.equal(h.requests.length, 0);
  assert.equal(h.value.session, null);
  assert.equal(h.value.profile, null);
  assert.equal(h.value.loading, false);
  h.unmount();
});

test('every sign-in and token refresh revalidates current permissions even for the same user', async () => {
  const h = mount(session('a'));
  await settle();
  h.runTimers();
  h.requests[0].resolve(profile('a', { role: 'owner' }));
  await settle();
  for (const [index, event] of ['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED'].entries()) {
    h.emit(event, session('a', `token-${index}`));
    assert.equal(h.value.loading, true);
    assert.equal(h.value.profile, null);
    h.runTimers();
    assert.equal(h.requests.length, index + 2);
    h.requests[index + 1].resolve(profile('a', { role: 'viewer', is_active: false }));
    await settle();
    assert.equal(h.value.profile.role, 'viewer');
    assert.equal(h.value.profile.is_active, false);
    assert.equal(h.value.loading, false);
  }
  h.unmount();
});

test('a switched account invalidates an in-flight profile before its deferred query starts', async () => {
  const h = mount(session('a'));
  await settle();
  h.runTimers();
  h.emit('SIGNED_IN', session('b'));
  h.requests[0].resolve(profile('a', { role: 'owner' }));
  await settle();
  assert.equal(h.value.session.user.id, 'b');
  assert.equal(h.value.profile, null);
  assert.equal(h.value.loading, true);
  h.runTimers();
  assert.equal(h.requests[1].id, 'b');
  h.requests[1].resolve(profile('b'));
  await settle();
  assert.equal(h.value.profile.id, 'b');
  h.unmount();
});

test('signout cannot be reversed by a late profile response or obsolete queued auth event', async () => {
  const h = mount(session('a'));
  await settle();
  h.runTimers();
  h.emit('SIGNED_IN', session('b'));
  h.emit('SIGNED_OUT', null);
  assert.equal(h.pendingTimers, 1);
  h.requests[0].resolve(profile('a'));
  await settle();
  h.runTimers();
  assert.equal(h.requests.length, 1, 'obsolete account b must not issue a query');
  assert.equal(h.value.session, null);
  assert.equal(h.value.profile, null);
  assert.equal(h.value.loading, false);
  h.unmount();
});

test('explicit refresh always requests fresh data and uses the current account, not a stale closure', async () => {
  const h = mount(session('a'));
  await settle();
  h.runTimers();
  const oldRefresh = h.value.refresh;
  const refreshingA = oldRefresh();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(profile('a', { role: 'viewer' }));
  await refreshingA;
  h.requests[0].resolve(profile('a', { role: 'owner' }));
  await settle();
  assert.equal(h.value.profile.role, 'viewer');
  h.emit('SIGNED_IN', session('b'));
  const refreshingB = oldRefresh();
  assert.equal(h.requests[2].id, 'b');
  h.runTimers();
  assert.equal(h.requests.length, 3, 'explicit refresh supersedes the older queued load');
  h.requests[2].resolve(profile('b'));
  await refreshingB;
  assert.equal(h.value.profile.id, 'b');
  h.unmount();
});

test('null or rejected profile reads release loading and fail closed without stale access', async () => {
  const h = mount(session('a'));
  await settle();
  h.runTimers();
  h.requests[0].resolve(null);
  await settle();
  assert.equal(h.value.loading, false);
  assert.equal(h.value.profile, null);
  h.emit('SIGNED_IN', session('a'));
  h.runTimers();
  h.requests[1].reject(new Error('test network failure'));
  await settle();
  assert.equal(h.value.loading, false);
  assert.equal(h.value.profile, null);
  assert.equal(h.diagnostics.length, 1);
  h.unmount();
});

test('effect cleanup cancels queued reads and makes in-flight responses inert', async () => {
  const queued = mount(session('a'));
  await settle();
  queued.unmount();
  queued.runTimers();
  assert.equal(queued.requests.length, 0);
  const pending = mount(session('b'));
  await settle();
  pending.runTimers();
  pending.unmount();
  const writes = pending.stateWrites;
  pending.requests[0].resolve(profile('b'));
  await settle();
  assert.equal(pending.stateWrites, writes);
});

test('StrictMode setup-cleanup-setup keeps one active bootstrap subscription', async () => {
  const h = mount(session('a'));
  h.replayEffects();
  await settle();
  h.runTimers();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(profile('a'));
  await settle();
  assert.equal(h.value.loading, false);
  assert.equal(h.value.profile.id, 'a');
  h.unmount();
});

test('initial identity, account switch and signout clear lists while same-user auth events preserve the cache', async () => {
  await swrList('auth-before-initial', async () => ['previous provider']);
  const h = mount(session('a'));
  await settle();
  assert.equal(h.cacheClears, 1);
  assert.equal(hasCache('auth-before-initial'), false);
  await swrList('auth-user-a', async () => ['a']);
  h.emit('SIGNED_IN', session('a'));
  h.emit('TOKEN_REFRESHED', session('a', 'new-token'));
  assert.equal(h.cacheClears, 1);
  assert.equal(hasCache('auth-user-a'), true);
  h.emit('SIGNED_IN', session('b'));
  assert.equal(h.cacheClears, 2);
  assert.equal(hasCache('auth-user-a'), false);
  await swrList('auth-user-b', async () => ['b']);
  h.emit('SIGNED_OUT', null);
  assert.equal(h.cacheClears, 3);
  assert.equal(hasCache('auth-user-b'), false);
  h.runTimers();
  h.unmount();
});

test('a new user never joins or caches a previous users in-flight list request', async () => {
  const h = mount(session('a'));
  await settle();
  let resolveA;
  const oldRead = swrList('auth-pending', () => new Promise(resolve => { resolveA = resolve; }));
  await settle();
  h.emit('SIGNED_IN', session('b'));
  let bReads = 0;
  const newRead = swrList('auth-pending', async () => { ++bReads; return ['user-b-only']; });
  assert.deepEqual(await newRead, ['user-b-only']);
  assert.equal(bReads, 1);
  resolveA(['user-a-only']);
  await oldRead;
  assert.deepEqual(await swrList('auth-pending', async () => []), ['user-b-only']);
  h.unmount();
});

test('a null initial session clears any lists retained from a previous provider lifecycle', async () => {
  await swrList('auth-signed-out', async () => ['old data']);
  const h = mount(null);
  await settle();
  assert.equal(h.cacheClears, 1);
  assert.equal(hasCache('auth-signed-out'), false);
  h.runTimers();
  assert.equal(h.value.loading, false);
  h.unmount();
});
