import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../frontend/src/lib/refreshQueue.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('the first event starts immediately and a burst shares one trailing query', async () => {
  const reads = [];
  const queue = createRefreshQueue(() => {
    const read = deferred(); reads.push(read); return read.promise;
  });
  const cycle = queue.request();
  assert.equal(reads.length, 1, 'no microtask or debounce before the first query');
  for (let i = 0; i < 100; i++) assert.strictEqual(queue.request(), cycle);
  assert.equal(reads.length, 1, 'burst does not overlap active queries');
  reads[0].resolve();
  await settled();
  assert.equal(reads.length, 2);
  reads[1].resolve();
  await cycle;
  assert.equal(reads.length, 2, '100 overlapping events require one follow-up');
});

test('events received during a trailing query trigger another query and are never dropped', async () => {
  const reads = [];
  const queue = createRefreshQueue(() => {
    const read = deferred(); reads.push(read); return read.promise;
  });
  const cycle = queue.request();
  queue.request();
  reads[0].resolve();
  await settled();
  for (let i = 0; i < 20; i++) queue.request();
  reads[1].resolve();
  await settled();
  assert.equal(reads.length, 3);
  reads[2].resolve();
  await cycle;
  const next = queue.request();
  assert.equal(reads.length, 4, 'a later event starts a new immediate cycle');
  reads[3].resolve();
  await next;
});

test('failure does not discard queued changes and a successful follow-up recovers the cycle', async () => {
  const reads = [];
  const queue = createRefreshQueue(() => {
    const read = deferred(); reads.push(read); return read.promise;
  });
  const cycle = queue.request();
  queue.request();
  reads[0].reject(new Error('transient error'));
  await settled();
  assert.equal(reads.length, 2);
  reads[1].resolve();
  await cycle;
});

test('a final failure remains observable to awaiting callers and permits a later retry', async () => {
  let requests = 0;
  const queue = createRefreshQueue(async () => {
    requests++;
    if (requests === 1) throw new Error('offline');
  });
  await assert.rejects(queue.request(), /offline/);
  await queue.request();
  assert.equal(requests, 2);
});

test('fire-and-forget realtime failures are observed without an unhandled rejection', async () => {
  const queue = createRefreshQueue(async () => { throw new Error('offline'); });
  void queue.request();
  await settled(); // node:test also fails if an unhandled rejection occurs
});

test('disposing during a request drops queued work and never starts another query', async () => {
  const response = deferred();
  let requests = 0;
  const queue = createRefreshQueue(() => { requests++; return response.promise; });
  const cycle = queue.request();
  queue.request();
  queue.dispose();
  response.resolve();
  await cycle;
  await queue.request();
  assert.equal(requests, 1);
});

test('synchronous throws are reported and do not poison a new cycle', async () => {
  let requests = 0;
  const queue = createRefreshQueue(() => {
    requests++;
    if (requests === 1) throw new Error('synchronous failure');
    return Promise.resolve();
  });
  await assert.rejects(queue.request(), /synchronous failure/);
  await queue.request();
  assert.equal(requests, 2);
});

test('reentrant events during query startup are queued instead of starting parallel work', async () => {
  let requests = 0;
  const queue = createRefreshQueue(async () => {
    requests++;
    if (requests === 1) queue.request();
  });
  await queue.request();
  assert.equal(requests, 2);
});
