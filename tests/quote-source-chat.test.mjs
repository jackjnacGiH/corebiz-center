import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('export const quoteRecordApi ='), source.indexOf('export interface SalesDocumentCursor'));
const compiled = ts.transpileModule(apiSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const quote = '00000000-0000-4000-8000-000000000001';
const roomA = '11111111-1111-4111-8111-111111111111';
const roomB = '22222222-2222-4222-8222-222222222222';

function fixture(responses = {}) {
  const reads = [], exports = {};
  const supabase = { from(table) {
    const read = { table, filters: [], columns: null };
    reads.push(read);
    const query = {
      select(columns) { read.columns = columns; return this; },
      eq(column, value) { read.filters.push([column, value]); return this; },
      contains(column, value) { read.filters.push([column, JSON.parse(JSON.stringify(value))]); return this; },
      maybeSingle() { return Promise.resolve(responses[table] ?? { data: null, error: null }); },
      then(resolve, reject) { return Promise.resolve(responses[table] ?? { data: [], error: null }).then(resolve, reject); },
    };
    return query;
  } };
  runInNewContext(compiled, { exports, supabase, Error });
  return { api: exports.quoteRecordApi, reads };
}
const tasks = ids => ({ data: ids.map(id => ({ payload: { conversation_id: id } })), error: null });
const messages = ids => ({ data: ids.map(conversation_id => ({ conversation_id })), error: null });
const room = id => ({ data: { id }, error: null });

test('quote creation task wins over a forwarded quote or a newer customer room', async () => {
  const f = fixture({ agent_tasks: tasks([roomA]), chat_messages: messages([roomB]), chat_conversations: room(roomA) });
  assert.equal(await f.api.getSourceConversationId(quote), roomA);
  assert.deepEqual(f.reads.map(read => read.table), ['agent_tasks', 'chat_conversations']);
  assert.deepEqual(f.reads[0].filters, [['related_type', 'quote'], ['related_id', quote], ['kind', 'sales.quote_request'], ['payload->>quote_id', quote]]);
  assert.equal(f.reads[0].filters.some(([key]) => key === 'status'), false);
  assert.deepEqual(f.reads[1].filters, [['id', roomA]]);
});

test('repeated task evidence for the same room is still one origin', async () => {
  const f = fixture({ agent_tasks: tasks([roomA, roomA]), chat_conversations: room(roomA) });
  assert.equal(await f.api.getSourceConversationId(quote), roomA);
});

test('conflicting task origins cannot select whichever room happens to be first', async () => {
  const f = fixture({ agent_tasks: tasks([roomA, roomB]) });
  await assert.rejects(f.api.getSourceConversationId(quote), /quote_source_chat_ambiguous/);
  assert.deepEqual(f.reads.map(read => read.table), ['agent_tasks']);
});

test('legacy fallback requires the exact bot quote-link metadata, not matching message text', async () => {
  const f = fixture({ chat_messages: messages([roomA, roomA]), chat_conversations: room(roomA) });
  assert.equal(await f.api.getSourceConversationId(quote), roomA);
  assert.deepEqual(f.reads[1].filters, [['sender_type', 'bot'], ['metadata', { quote_id: quote, quote_link: true }]]);
});

test('storefront/manual quotes with no origin stay unlinked instead of using CRM recency', async () => {
  const f = fixture();
  assert.equal(await f.api.getSourceConversationId(quote), null);
  assert.deepEqual(f.reads.map(read => read.table), ['agent_tasks', 'chat_messages']);
});

test('invalid source identifiers and conflicting legacy messages cannot open another room', async () => {
  const invalid = fixture({ agent_tasks: tasks([null, 'https://example.invalid/chat', 'not-a-room']) });
  assert.equal(await invalid.api.getSourceConversationId(quote), null);
  const conflicting = fixture({ chat_messages: messages([roomA, roomB]) });
  await assert.rejects(conflicting.api.getSourceConversationId(quote), /quote_source_chat_ambiguous/);
});

test('lookup failures remain retryable errors, never a fabricated no-chat result', async () => {
  for (const table of ['agent_tasks', 'chat_messages', 'chat_conversations']) {
    const error = new Error('temporary lookup failure');
    const responses = { [table]: { data: null, error } };
    if (table === 'chat_conversations') responses.agent_tasks = tasks([roomA]);
    const f = fixture(responses);
    await assert.rejects(f.api.getSourceConversationId(quote), /temporary lookup failure/);
  }
});

test('deleted or inaccessible originating chats do not navigate to an empty thread', async () => {
  const f = fixture({ agent_tasks: tasks([roomA]) });
  await assert.rejects(f.api.getSourceConversationId(quote), /quote_source_chat_unavailable/);
});
