import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { conversationCursorFilter, inboxSearchPattern } from '../frontend/src/lib/chat-inbox-pagination.ts';

const source = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
function method(start, end, globals) {
  const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const compiled = ts.transpileModule(`export const api = { ${body} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; runInNewContext(compiled, { exports, ...globals }); return exports.api;
}
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const rows = Array.from({ length: 643 }, (_, index) => ({ id: id(index), channel: 'line', status: 'open', display_name: index % 2 ? 'search' : 'other', created_at: `2026-01-${String(index % 5 + 1).padStart(2, '0')}T00:00:00Z`, last_message_at: index < 550 ? `2026-02-${String(index % 5 + 1).padStart(2, '0')}T00:00:00Z` : null }));
function clauses(input) { const values = []; let depth = 0, start = 0; for (let i = 0; i < input.length; i++) { if (input[i] === '(') depth++; if (input[i] === ')') depth--; if (input[i] === ',' && !depth) { values.push(input.slice(start, i)); start = i + 1; } } values.push(input.slice(start)); return values; }
function matches(row, input) {
  if (input.startsWith('and(')) return clauses(input.slice(4, -1)).every(clause => matches(row, clause));
  if (input.startsWith('or(')) return clauses(input.slice(3, -1)).some(clause => matches(row, clause));
  const [, key, operation, value] = input.match(/^([^.]+)\.([^.]+)\.(.*)$/);
  if (operation === 'is') return row[key] === null;
  if (operation === 'lt') return row[key] !== null && row[key] < value;
  if (operation === 'eq') return row[key] === value;
  if (operation === 'ilike') return String(row[key] ?? '').includes(value.replace(/["%]/g, ''));
  throw new Error(`Unexpected predicate ${input}`);
}
function database(data, { notes = [], error = null } = {}) {
  const queries = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.sorts = []; queries.push(this); }
    select(columns) { this.columns = columns; return this; }
    order(key, opts) { this.sorts.push([key, opts]); return this; }
    limit(value) { this.limitValue = value; return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    or(input) { this.orValue = input; this.filters.push(row => matches(row, `or(${input})`)); return this; }
    then(resolve, reject) {
      if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
      let values = (this.table === 'chat_conversations' ? data : notes).filter(row => this.filters.every(filter => filter(row)));
      values.sort((a, b) => { for (const [key, opts] of this.sorts) { if (a[key] === b[key]) continue; if (a[key] == null) return opts.nullsFirst === false ? 1 : -1; if (b[key] == null) return opts.nullsFirst === false ? -1 : 1; return (a[key] < b[key] ? -1 : 1) * (opts.ascending ? 1 : -1); } return 0; });
      values = this.bounds ? values.slice(this.bounds[0], this.bounds[1] + 1) : values.slice(0, this.limitValue ?? values.length);
      if (this.columns === 'conversation_id,company:address->>company') values = values.map(row => ({ conversation_id: row.conversation_id, company: row.address?.company ?? null }));
      return Promise.resolve({ data: values, error: null }).then(resolve, reject);
    }
  }
  const supabase = { from: table => new Query(table), rpc: async () => ({ data: [] }) };
  return { api: method('async listConversations(', '/** One cursor-paginated message page', { supabase, conversationCursorFilter, inboxSearchPattern }), queries };
}

test('keyset pages traverse all 643 rooms exactly once, including equal timestamps and NULL activity', async () => {
  const db = database(rows); let after = null, seen = [];
  for (;;) { const page = await db.api.listConversations({ limit: 100, after }); seen.push(...page.conversations.map(row => row.id)); after = page.cursor; if (!page.hasMore) break; }
  assert.equal(seen.length, 643); assert.equal(new Set(seen).size, 643);
  assert.equal(db.queries.filter(query => query.table === 'chat_conversations').length, 7);
  assert.ok(db.queries.every(query => query.table !== 'chat_conversations' || query.limitValue === 101));
});

test('search and cursor predicates stay AND-combined and a newer insert does not duplicate older pages', async () => {
  const data = [...rows]; const db = database(data);
  const first = await db.api.listConversations({ search: 'search', limit: 30 });
  data.unshift({ ...rows[1], id: id(999), last_message_at: '2026-09-01T00:00:00Z' });
  const second = await db.api.listConversations({ search: 'search', limit: 30, after: first.cursor });
  assert.ok(second.conversations.every(row => row.display_name === 'search'));
  assert.equal(new Set([...first.conversations, ...second.conversations].map(row => row.id)).size, 60);
  assert.ok(!second.conversations.some(row => row.id === id(999)));
  assert.match(db.queries.findLast(query => query.table === 'chat_conversations').orValue, /^and\(or\(/);
});

test('inbox traversal also remains complete beyond the PostgREST default 1000-row cap', async () => {
  const data = Array.from({ length: 1303 }, (_, index) => ({ ...rows[index % rows.length], id: id(index) }));
  const db = database(data); let after = null, seen = [];
  for (;;) { const page = await db.api.listConversations({ after }); seen.push(...page.conversations.map(row => row.id)); if (!page.hasMore) break; after = page.cursor; }
  assert.equal(seen.length, 1303); assert.equal(new Set(seen).size, 1303);
});

test('bulk enrichment selects company text only and excludes full customer notes', async () => {
  const notes = [{ conversation_id: id(1), note_type: 'tax_invoice', address: { company: 'Factory', tax_id: 'private' }, content: 'private note' }];
  const db = database(rows.slice(0, 3), { notes });
  let base;
  const page = await db.api.listConversations({}, value => { base = value; });
  assert.equal(base.conversations.find(row => row.id === id(1)).company, undefined);
  assert.equal(page.conversations.find(row => row.id === id(1)).company, 'Factory');
  const query = db.queries.find(query => query.table === 'chat_contact_notes');
  assert.equal(query.columns, 'conversation_id,company:address->>company');
  assert.ok(!JSON.stringify(page).includes('private'));
});

test('note reorder reports returned errors as well as rejected promises', async () => {
  const notesTable = () => ({ update: () => ({ eq: (_, value) => value === 'denied' ? Promise.resolve({ error: { code: '42501' } }) : value === 'offline' ? Promise.reject(new Error('offline')) : Promise.resolve({ error: null }) }) });
  const api = method('async reorder(orderedIds: string[]): Promise<void> {', 'async create(', { notesTable });
  await assert.rejects(api.reorder(['ok', 'denied', 'offline']), /2\/3/);
  await api.reorder(['ok']);
});
