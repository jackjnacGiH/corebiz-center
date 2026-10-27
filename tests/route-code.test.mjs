import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sharedRouteImport, preloadRequestedRoute } from '../frontend/src/lib/route-code.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('requested code starts while authentication is pending, with one shared download', async () => {
  const code = deferred(), auth = deferred();
  let downloads = 0, mounted = false, otherDownloads = 0;
  const load = sharedRouteImport(() => { downloads++; return code.promise; });
  const navigation = auth.promise.then(async () => { await load(); mounted = true; });
  preloadRequestedRoute('/chat', { chat: load, shipping: async () => { otherDownloads++; } });
  assert.equal(downloads, 1);
  assert.equal(mounted, false);
  assert.equal(otherDownloads, 0);
  const first = load();
  assert.equal(load(), first);
  code.resolve({ default: 'route' });
  await first;
  assert.equal(mounted, false, 'download alone must not mount a protected route');
  auth.resolve();
  await navigation;
  assert.equal(mounted, true);
  assert.equal(downloads, 1);
});

test('a failed speculative download is handled and a later route load can retry', async () => {
  let calls = 0;
  const load = sharedRouteImport(() => ++calls === 1
    ? Promise.reject(new Error('offline')) : Promise.resolve({ default: 'route' }));
  preloadRequestedRoute('/shipping/', { chat: async () => assert.fail(), shipping: load });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await load(), { default: 'route' });
  assert.equal(calls, 2);
});

test('interrupted navigation and unrelated/public routes never load extra routes', async () => {
  const pending = deferred();
  let chat = 0, shipping = 0;
  const loaders = {
    chat: sharedRouteImport(() => { chat++; return pending.promise; }),
    shipping: sharedRouteImport(async () => { shipping++; }),
  };
  preloadRequestedRoute('/chat', loaders);
  for (const path of ['/login', '/widget', '/q/token', '/', '/chat-other', '/shipping/editor']) {
    preloadRequestedRoute(path, loaders);
  }
  assert.equal(chat, 1);
  assert.equal(shipping, 0);
  preloadRequestedRoute('/shipping', loaders);
  assert.equal(shipping, 1);
  pending.resolve();
  await loaders.chat();
  assert.equal(chat, 1);
});

test('warmup stays outside protected content while auth and role guards remain in place', () => {
  const app = readFileSync(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../frontend/src/components/layout/Layout.tsx', import.meta.url), 'utf8');
  assert.match(app, /<BrowserRouter basename="\/center">\s*<RouteCodeWarmup \/>/);
  assert.match(app, /<ProtectedRoute>\s*<Layout \/>/);
  assert.match(app, /roles=\{\['owner', 'admin', 'staff'\]\}><Shipping/);
  assert.match(layout, /location.pathname === '\/chat'/);
});
