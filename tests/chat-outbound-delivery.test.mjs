import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { deferred, settle } from './helpers/component-harness.mjs';

const apiSource = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
const senderSource = apiSource.slice(apiSource.indexOf('async sendMessage(input:'), apiSource.indexOf('async setStatus(', apiSource.indexOf('async sendMessage(input:')));
const helperSource = readFileSync(new URL('../frontend/src/lib/chat-outbound.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client({ channel = 'messenger', externalId = 'recipient', lookupError = null, updateError = null, invoke = () => Promise.resolve({ data: { ok: true }, error: null }) } = {}) {
  const inserts = [], calls = [], updates = [], diagnostics = [];
  class Query {
    constructor(table) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    maybeSingle() { return Promise.resolve({ data: lookupError ? null : { channel, external_id: externalId }, error: lookupError }); }
    insert(row) { this.insertRow = structuredClone(row); return this; }
    single() { const row = { id: 'stored-message', ...this.insertRow }; inserts.push(row); return Promise.resolve({ data: structuredClone(row), error: null }); }
    update(patch) { this.patch = structuredClone(patch); return this; }
    then(resolve, reject) { updates.push(this.patch); if (!updateError) Object.assign(inserts[0], this.patch); return Promise.resolve({ error: updateError }).then(resolve, reject); }
  }
  const supabase = {
    from: table => new Query(table),
    auth: { getUser: async () => ({ data: { user: { id: 'staff', email: 'staff@example.test' } }, error: null }) },
    functions: { invoke: (name, options) => { calls.push({ name, body: structuredClone(options.body) }); return invoke(); } },
  };
  const helper = {};
  runInNewContext(compile(helperSource), { exports: helper, URL, require: () => ({ supabase }), console: { warn: (...args) => diagnostics.push(args) } });
  const api = {};
  runInNewContext(compile(`export const api = { ${senderSource} };`), { exports: api, supabase, ...helper });
  return { api: api.api, inserts, calls, updates, diagnostics };
}

test('Messenger sends the stored message ID, returns pending before deferred receipt, then records delivery', async () => {
  const delivery = deferred(); const c = client({ invoke: () => delivery.promise });
  const message = await c.api.sendMessage({ conversationId: 'room', content: 'Question answered', senderName: 'Staff', replyTo: { id: 'quoted', sender_type: 'customer', preview: 'question' } });
  assert.equal(message.metadata.outbound_delivery, 'pending');
  assert.deepEqual(c.calls, [{ name: 'messenger-push', body: { message_id: 'stored-message' } }]);
  assert.equal(c.updates.length, 0);
  delivery.resolve({ data: { ok: true, state: 'delivered' }, error: null }); await settle();
  assert.equal(c.inserts[0].metadata.outbound_delivery, 'delivered');
  assert.equal(c.inserts[0].metadata.messenger_push_failed, false);
  assert.equal(c.inserts[0].metadata.reply_to.id, 'quoted');
});

test('body errors and SDK HTTP errors mark a definite Messenger rejection as failed', async () => {
  for (const result of [
    { data: { ok: false, error: 'facebook_channel_not_ready' }, error: null },
    { data: null, error: { context: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) } },
  ]) {
    const c = client({ invoke: async () => result });
    await c.api.sendMessage({ conversationId: 'room', content: 'reply' }); await settle();
    // Reading a cloned Response body is asynchronous even though no network exists.
    for (let i = 0; i < 5 && !c.updates.length; i++) await settle();
    assert.equal(c.inserts[0].metadata.outbound_delivery, 'failed');
    assert.equal(c.inserts[0].metadata.messenger_push_failed, true);
  }
});

test('uncertain transport or ledger outcomes remain pending for review, without automatic re-send', async () => {
  for (const invoke of [
    async () => { throw new Error('network lost after dispatch'); },
    async () => ({ data: { error: 'delivery_requires_review', state: 'delivery_unknown' }, error: null }),
    async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'delivery_pending_review' }), { status: 503 }) } }),
  ]) {
    const c = client({ invoke });
    await c.api.sendMessage({ conversationId: 'room', content: 'reply' });
    for (let i = 0; i < 6 && !c.updates.length; i++) await settle();
    assert.equal(c.inserts[0].metadata.outbound_delivery, 'pending');
    assert.equal(c.inserts[0].metadata.messenger_push_failed, false);
    assert.equal(c.calls.length, 1);
  }
});

test('LINE keeps background sending, human name and quote token and checks a 200 response body rejection', async () => {
  const delivery = deferred(); const c = client({ channel: 'line', invoke: () => delivery.promise });
  const message = await c.api.sendMessage({ conversationId: 'room', content: 'hello', senderName: 'Cherry', replyTo: { id: 'quoted', sender_type: 'customer', preview: 'question', quoteToken: 'quote-token' } });
  assert.equal(message.metadata.outbound_delivery, 'pending');
  assert.deepEqual(c.calls[0], { name: 'line-push', body: { conversation_id: 'room', text: 'Cherry: hello', quote_token: 'quote-token' } });
  delivery.resolve({ data: { ok: false, error: 'line_push_failed', status: 429 }, error: null }); await settle();
  assert.equal(c.inserts[0].metadata.outbound_delivery, 'failed'); assert.equal(c.inserts[0].metadata.line_push_failed, true);
});

test('private file locator and signed link survive Messenger delivery state updates', async () => {
  const c = client();
  const url = 'https://example.supabase.co/storage/v1/object/sign/chat-private-attachments/room/document.pdf?token=old';
  const message = await c.api.sendFileMessage({ conversationId: 'room', fileUrl: url, fileName: 'document.pdf', mimeType: 'application/pdf' });
  assert.equal(message.metadata.file_bucket, 'chat-private-attachments'); assert.equal(message.metadata.file_path, 'room/document.pdf');
  assert.equal(message.metadata.file_url, url);
  assert.deepEqual(c.calls[0], { name: 'messenger-push', body: { message_id: 'stored-message' } });
  await settle(); assert.equal(c.inserts[0].metadata.file_url, url); assert.equal(c.inserts[0].metadata.outbound_delivery, 'delivered');
});

test('unsupported channels and failed conversation lookup reject before saving a false outbound message', async () => {
  for (const options of [{ channel: 'email' }, { channel: 'whatsapp' }, { channel: 'instagram' }, { channel: 'line', externalId: null }, { lookupError: new Error('lookup failed') }]) {
    const c = client(options);
    await assert.rejects(c.api.sendMessage({ conversationId: 'room', content: 'reply' }));
    await assert.rejects(c.api.sendFileMessage({ conversationId: 'room', fileUrl: 'https://example.test/file.pdf', fileName: 'file.pdf' }));
    assert.equal(c.inserts.length, 0); assert.equal(c.calls.length, 0);
  }
});

test('local livechat needs no platform mutation and receipt persistence errors stay visible as pending', async () => {
  const local = client({ channel: 'livechat' });
  const message = await local.api.sendMessage({ conversationId: 'room', content: 'reply' });
  assert.equal(message.metadata.outbound_delivery, 'delivered'); assert.equal(local.calls.length, 0);
  const denied = client({ updateError: { code: '42501' } });
  await denied.api.sendMessage({ conversationId: 'room', content: 'reply' }); await settle();
  assert.equal(denied.inserts[0].metadata.outbound_delivery, 'pending'); assert.equal(denied.diagnostics.length, 1);
});
