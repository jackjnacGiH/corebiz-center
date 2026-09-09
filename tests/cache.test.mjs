import test from 'node:test';
import assert from 'node:assert/strict';
import { swrList, prefetchList, invalidateList, clearListCache, hasCache } from '../frontend/src/lib/cache.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('concurrent cold readers share one fetch and keep the same returned data', async () => {
  const response = deferred();
  let requests = 0;
  const fetcher = () => { requests++; return response.promise; };
  const first = swrList('cold', fetcher);
  const second = swrList('cold', fetcher);
  assert.equal(hasCache('cold'), false);
  await Promise.resolve();
  assert.equal(requests, 1);
  const rows = [{ id: 1 }];
  response.resolve(rows);
  assert.strictEqual(await first, rows);
  assert.strictEqual(await second, rows);
  assert.equal(hasCache('cold'), true);
  assert.strictEqual(await swrList('cold', fetcher), rows);
  assert.equal(requests, 1);
});

test('prefetch and foreground loads share work in either arrival order', async () => {
  for (const prefetchFirst of [true, false]) {
    const key = `prefetch-${prefetchFirst}`;
    const response = deferred();
    let requests = 0;
    const fetcher = () => { requests++; return response.promise; };
    if (prefetchFirst) prefetchList(key, fetcher);
    const page = swrList(key, fetcher);
    prefetchList(key, fetcher);
    prefetchList(key, fetcher);
    await Promise.resolve();
    assert.equal(requests, 1);
    response.resolve(['ready']);
    assert.deepEqual(await page, ['ready']);
    prefetchList(key, fetcher);
    assert.equal(requests, 1);
  }
});

test('all stale subscribers get the same fresh result without duplicate requests', async () => {
  const key = 'stale-listeners';
  await swrList(key, async () => ['old']);
  const response = deferred();
  let requests = 0;
  const fetcher = () => { requests++; return response.promise; };
  const received = [];
  assert.deepEqual(await swrList(key, fetcher, { staleMs: -1, onFresh: rows => received.push(['first', rows]) }), ['old']);
  assert.deepEqual(await swrList(key, fetcher, { staleMs: -1, onFresh: () => { throw new Error('unmounted view'); } }), ['old']);
  assert.deepEqual(await swrList(key, fetcher, { staleMs: -1, onFresh: rows => received.push(['second', rows]) }), ['old']);
  assert.equal(requests, 1);
  response.resolve(['fresh']);
  await settled();
  assert.deepEqual(received, [['first', ['fresh']], ['second', ['fresh']]]);
  assert.deepEqual(await swrList(key, fetcher), ['fresh']);
});

test('forced reload starts after-write work and older results cannot replace it', async () => {
  const key = 'forced-generation';
  const oldResponse = deferred();
  const newResponse = deferred();
  let requests = 0;
  const old = swrList(key, () => { requests++; return oldResponse.promise; });
  const fresh = swrList(key, () => { requests++; return newResponse.promise; }, { force: true });
  const joined = swrList(key, () => { throw new Error('must share the current generation'); });
  await Promise.resolve();
  assert.equal(requests, 2);
  newResponse.resolve(['after-write']);
  assert.deepEqual(await fresh, ['after-write']);
  assert.deepEqual(await joined, ['after-write']);
  oldResponse.resolve(['before-write']);
  assert.deepEqual(await old, ['before-write']);
  assert.deepEqual(await swrList(key, async () => []), ['after-write']);
});

test('forced reload supersedes a stale refresh while preserving its subscribers', async () => {
  const key = 'forced-listeners';
  await swrList(key, async () => ['old']);
  const background = deferred();
  const forced = deferred();
  const received = [];
  await swrList(key, () => background.promise, { staleMs: -1, onFresh: rows => received.push(rows) });
  const reload = swrList(key, () => forced.promise, { force: true });
  background.resolve(['outdated']);
  await settled();
  assert.deepEqual(received, []);
  forced.resolve(['latest']);
  await reload;
  assert.deepEqual(received, [['latest']]);
});

test('invalidation detaches pending results and permits a fresh request', async () => {
  const key = 'invalidate-pending';
  const before = deferred();
  const after = deferred();
  const old = swrList(key, () => before.promise);
  invalidateList(key);
  assert.equal(hasCache(key), false);
  const fresh = swrList(key, () => after.promise);
  before.resolve(['obsolete']);
  await old;
  assert.equal(hasCache(key), false);
  const joined = swrList(key, () => { throw new Error('old cleanup must not remove new pending work'); });
  after.resolve(['current']);
  assert.deepEqual(await fresh, ['current']);
  assert.deepEqual(await joined, ['current']);
});

test('invalidated background and prefetch work cannot refill the cache or notify old views', async () => {
  const key = 'invalidate-background';
  await swrList(key, async () => ['old']);
  const response = deferred();
  let notified = false;
  await swrList(key, () => response.promise, { staleMs: -1, onFresh: () => { notified = true; } });
  const prefetch = deferred();
  prefetchList('invalidate-prefetch', () => prefetch.promise);
  invalidateList(key, 'invalidate-prefetch');
  response.resolve(['obsolete']);
  prefetch.resolve(['obsolete']);
  await settled();
  assert.equal(hasCache(key), false);
  assert.equal(hasCache('invalidate-prefetch'), false);
  assert.equal(notified, false);
});

test('cold failures reach every caller and retries are not stuck behind failed work', async () => {
  const response = deferred();
  const first = swrList('cold-failure', () => response.promise);
  const second = swrList('cold-failure', () => response.promise);
  const results = Promise.allSettled([first, second]);
  const error = new Error('offline');
  response.reject(error);
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.strictEqual(result.reason, error);
  }
  assert.equal(hasCache('cold-failure'), false);
  assert.deepEqual(await swrList('cold-failure', async () => ['retried']), ['retried']);
  await assert.rejects(swrList('sync-failure', () => { throw error; }), /offline/);
});

test('background and prefetch failures remain best-effort; forced errors preserve cached data', async () => {
  const key = 'stale-failure';
  await swrList(key, async () => ['cached']);
  let notified = false;
  assert.deepEqual(await swrList(key, async () => { throw new Error('offline'); }, {
    staleMs: -1, onFresh: () => { notified = true; },
  }), ['cached']);
  prefetchList('prefetch-failure', async () => { throw new Error('offline'); });
  await settled();
  assert.equal(notified, false);
  assert.equal(hasCache('prefetch-failure'), false);
  await assert.rejects(swrList(key, async () => { throw new Error('offline'); }, { force: true }), /offline/);
  assert.deepEqual(await swrList(key, async () => []), ['cached']);
});

test('identity cache reset isolates new cold requests from late reads and subscribers of the previous account', async () => {
  const coldA = deferred();
  const staleA = deferred();
  const coldB = deferred();
  let oldAccountNotified = false;
  const accountARead = swrList('identity-cold', () => coldA.promise);
  await swrList('identity-stale', async () => ['account A cached']);
  await swrList('identity-stale', () => staleA.promise, {
    staleMs: -1, onFresh: () => { oldAccountNotified = true; },
  });
  clearListCache();
  assert.equal(hasCache('identity-cold'), false);
  assert.equal(hasCache('identity-stale'), false);
  let newAccountRequests = 0;
  const accountBRead = swrList('identity-cold', () => {
    newAccountRequests++;
    return coldB.promise;
  });
  await Promise.resolve();
  assert.equal(newAccountRequests, 1, 'new account cannot join previous account pending reads');
  coldB.resolve(['account B']);
  assert.deepEqual(await accountBRead, ['account B']);
  coldA.resolve(['account A late']);
  staleA.resolve(['account A late']);
  await accountARead;
  await settled();
  assert.deepEqual(await swrList('identity-cold', async () => []), ['account B']);
  assert.equal(hasCache('identity-stale'), false);
  assert.equal(oldAccountNotified, false);
});
