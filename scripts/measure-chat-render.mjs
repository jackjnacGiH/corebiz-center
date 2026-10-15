import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { mountComponent, settle, elements, text } from '../tests/helpers/component-harness.mjs';
const path = 'frontend/src/pages/Chat.tsx';
const baseline = execFileSync('git', ['show', `${process.argv[2] ?? 'origin/main'}:${path}`], { encoding: 'utf8' });
const conversations = Array.from({ length: 500 }, (_, index) => ({ id: String(index), channel: 'line', display_name: `Room ${index}`, status: 'assigned', unread_count: 0, customer_id: null, last_customer_message_at: null, last_message_at: '2026-10-01', created_at: '2026-10-01', updated_at: '2026-10-01', tags: [], auto_tags: [], metadata: {} }));
const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel: async () => {} };
for (const [name, source] of [['before', baseline], ['after', readFileSync(path, 'utf8')]]) {
  const h = mountComponent(path, {}, { '../lib/supabase': { supabase }, '../lib/api': { chatProfileApi: {}, chatInboxApi: {
    listConversations: async (_filters, onBase) => { const page = { conversations, hasMore: false, cursor: null }; onBase?.(page); return page; },
    listMessages: async () => ({ messages: [], hasMore: false }), markRead: async () => true,
  } } }, source);
  await settle(); h.render();
  elements(h.tree, node => node.type === 'button' && text(node).includes('Room 0'))[0].props.onClick();
  h.render(); await settle(); h.render();
  const input = elements(h.tree, node => node.type === 'textarea')[0];
  const start = performance.now();
  for (let i = 0; i < 100; i++) { input.props.onChange({ target: { value: `typing ${i}` } }); h.render(); }
  console.log(JSON.stringify({ name, rooms: 500, composerUpdates: 100, elapsedMs: Math.round(performance.now() - start) }));
  h.unmount();
}
