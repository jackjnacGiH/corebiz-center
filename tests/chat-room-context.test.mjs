import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, elements, mountComponent, settle, text } from './helpers/component-harness.mjs';

const room = id => ({ id, channel: 'line', display_name: `Room ${id}`, status: 'assigned', unread_count: 0, customer_id: null, last_customer_message_at: null, last_message_at: '2026-10-01', created_at: '2026-10-01', updated_at: '2026-10-01', tags: [], auto_tags: [], metadata: {} });
const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel: async () => {} };
const clickRoom = (h, id) => { const button = elements(h.tree, node => node.type === 'button' && text(node).includes(`Room ${id}`))[0]; assert.ok(button); button.props.onClick(); h.render(); };
const input = h => elements(h.tree, node => node.type === 'textarea')[0];

test('actual Chat keeps drafts and pending send completion scoped to room A while writing in B', async () => {
  const send = deferred(), sends = [];
  const conversations = [room('A'), room('B')];
  const h = mountComponent('frontend/src/pages/Chat.tsx', {}, {
    '../lib/supabase': { supabase },
    '../lib/api': { chatProfileApi: {}, chatInboxApi: {
      listConversations: async (_filters, onBase) => { const page = { conversations, hasMore: false, cursor: null }; onBase?.(page); return page; },
      listMessages: async () => ({ messages: [], hasMore: false }),
      markRead: async () => false,
      sendMessage: args => { sends.push(args); return send.promise; },
    } },
  });
  await settle(); h.render(); clickRoom(h, 'A'); await settle(); h.render();
  input(h).props.onChange({ target: { value: 'Draft A' } }); h.render();
  clickRoom(h, 'B'); await settle(); h.render();
  assert.equal(input(h).props.value, '');
  input(h).props.onChange({ target: { value: 'Draft B' } }); h.render();
  clickRoom(h, 'A'); await settle(); h.render();
  assert.equal(input(h).props.value, 'Draft A');
  const form = elements(h.tree, node => node.type === 'form' && node.props.onSubmit)[0];
  const sending = form.props.onSubmit({ preventDefault() {} });
  h.render(); assert.equal(input(h).props.disabled, true);
  clickRoom(h, 'B'); await settle(); h.render();
  assert.equal(input(h).props.value, 'Draft B'); assert.equal(input(h).props.disabled, false);
  send.resolve({ id: 'sent-A', conversation_id: 'A', sender_type: 'agent', content: 'Draft A', created_at: '2026-10-08', metadata: {} });
  await sending; await settle(); h.render();
  assert.equal(input(h).props.value, 'Draft B'); assert.equal(input(h).props.disabled, false);
  assert.equal(sends[0].conversationId, 'A'); assert.equal(sends[0].content, 'Draft A');
  clickRoom(h, 'A'); await settle(); h.render(); assert.equal(input(h).props.value, '');
  h.unmount();
});

test('actual ContactPanel starts memory B after switching during memory A and ignores late A', async () => {
  const a = deferred(), b = deferred(), reads = [];
  const h = mountComponent('frontend/src/components/chat/ContactPanel.tsx', { conversation: room('A') }, {
    '../../lib/supabase': { supabase },
    '../../lib/api': { profilesApi: { listStaff: async () => [] }, chatNotesApi: { list: async () => [] } },
    '../../lib/bot-memory-api': { botMemoryApi: { getConversationMemory: id => { reads.push(id); return id === 'A' ? a.promise : b.promise; } } },
    '../../lib/chat-delivery-recovery': { listChatDeliveryRecovery: async () => [] },
  });
  const memoryButton = () => elements(h.tree, node => node.type === 'button' && text(node).includes('ความจำของบอทในห้องนี้'))[0];
  memoryButton().props.onClick(); h.render(); assert.deepEqual(reads, ['A']);
  h.render({ conversation: room('B') }); h.render(); memoryButton().props.onClick(); h.render();
  assert.deepEqual(reads, ['A', 'B']);
  b.resolve({ summary: 'B-only', products: [], staff_note: '', staff_locked: false }); await settle(); h.render();
  assert.match(text(h.tree), /B-only/);
  a.resolve({ summary: 'A-only', products: [], staff_note: '', staff_locked: false }); await settle(); h.render();
  assert.match(text(h.tree), /B-only/); assert.doesNotMatch(text(h.tree), /A-only/);
  h.unmount();
});

test('a queued realtime message from old room A cannot enter room B after unsubscribe', async () => {
  const subscriptions = [];
  const realtime = { channel(name) { const channel = { name, handlers: [], on(_kind, filter, callback) { this.handlers.push({ filter, callback }); return this; }, subscribe() { subscriptions.push(this); return this; } }; return channel; }, removeChannel: async () => {} };
  const conversations = [room('A'), room('B')];
  const h = mountComponent('frontend/src/pages/Chat.tsx', {}, {
    '../lib/supabase': { supabase: realtime },
    '../lib/api': { chatProfileApi: {}, chatInboxApi: { listConversations: async (_filters, onBase) => { const page = { conversations, hasMore: false, cursor: null }; onBase?.(page); return page; }, listMessages: async () => ({ messages: [], hasMore: false }), markRead: async () => false } },
  });
  await settle(); h.render(); clickRoom(h, 'A'); await settle(); h.render();
  const oldInsert = subscriptions.find(channel => channel.name === 'chat:msgs:A').handlers.find(handler => handler.filter.event === 'INSERT').callback;
  clickRoom(h, 'B'); await settle(); h.render();
  oldInsert({ new: { id: 'late-A', conversation_id: 'A', sender_type: 'agent', content: 'old', created_at: '2026-10-08', metadata: {} } }); h.render();
  assert.equal(elements(h.tree, node => node.props.msg?.id === 'late-A').length, 0);
  h.unmount();
});

test('actual editable table retains both discount levels in VAT and save payload', async () => {
  let saved;
  const h = mountComponent('frontend/src/components/EditableQuoteItems.tsx', {
    initial: [{ sku: 'SKU', product_name: 'Item', quantity: 1, unit_price: 100, discount: 10 }], initialDiscount: 5,
    products: [], format: value => value.toFixed(2), onSave: (lines, discount) => { saved = { lines, discount }; }, onCancel() {},
  }, { '../lib/api': {} });
  assert.match(text(h.tree), /90\.95/);
  const save = elements(h.tree, node => !!node.props.onClick && /บันทึก/.test(text(node)))[0];
  save.props.onClick();
  assert.equal(saved.lines[0].discount, 10); assert.equal(saved.discount, 5);
  h.unmount();
});

test('memory save A does not leave the memory controls in B disabled', async () => {
  const save = deferred();
  const h = mountComponent('frontend/src/components/chat/ContactPanel.tsx', { conversation: room('A') }, {
    '../../lib/supabase': { supabase },
    '../../lib/api': { profilesApi: { listStaff: async () => [] }, chatNotesApi: { list: async () => [] } },
    '../../lib/chat-delivery-recovery': { listChatDeliveryRecovery: async () => [] },
    '../../lib/bot-memory-api': { botMemoryApi: { getConversationMemory: async id => ({ summary: `${id}-memory`, products: [], staff_note: '', staff_locked: false }), updateConversationMemory: () => save.promise } },
  });
  const open = () => elements(h.tree, node => node.type === 'button' && text(node).includes('ความจำของบอทในห้องนี้'))[0].props.onClick();
  const saveButton = () => elements(h.tree, node => !!node.props.onClick && text(node).trim() === 'บันทึก')[0];
  open(); await settle(); h.render(); saveButton().props.onClick(); h.render();
  assert.equal(saveButton().props.disabled, true);
  h.render({ conversation: room('B') }); h.render(); open(); await settle(); h.render();
  assert.equal(saveButton().props.disabled, false);
  save.resolve({ summary: 'old-A', staff_note: 'old-A', staff_locked: false }); await settle(); h.render();
  assert.equal(saveButton().props.disabled, false); assert.doesNotMatch(text(h.tree), /old-A/);
  h.unmount();
});

test('note reorder failure rolls the UI back and a revisited room renders its cached notes immediately', async () => {
  const reorder = deferred();
  const notes = [{ id: 'one', conversation_id: 'A' }, { id: 'two', conversation_id: 'A' }];
  const h = mountComponent('frontend/src/components/chat/ContactPanel.tsx', { conversation: room('A') }, {
    '../../lib/supabase': { supabase },
    '../../lib/api': { profilesApi: { listStaff: async () => [] }, chatNotesApi: { list: async id => id === 'A' ? notes : [], reorder: () => reorder.promise } },
    '../../lib/chat-delivery-recovery': { listChatDeliveryRecovery: async () => [] },
  });
  const cards = () => elements(h.tree, node => !!node.props.note);
  await settle(); h.render(); cards()[0].props.onDragStart({ dataTransfer: {} }); h.render();
  cards()[1].props.onDrop({ preventDefault() {} }); h.render();
  assert.deepEqual(cards().map(node => node.props.note.id), ['two', 'one']);
  reorder.reject(new Error('denied')); await settle(); h.render();
  assert.deepEqual(cards().map(node => node.props.note.id), ['one', 'two']);
  assert.deepEqual(h.alerts, ['denied']);
  h.render({ conversation: room('B') }); await settle(); h.render();
  h.render({ conversation: room('A') });
  assert.deepEqual(cards().map(node => node.props.note.id), ['one', 'two']);
  h.unmount();
});

test('late delivery recovery A never appears in the contact panel for B', async () => {
  const a = deferred();
  const h = mountComponent('frontend/src/components/chat/ContactPanel.tsx', { conversation: room('A') }, {
    '../../lib/supabase': { supabase },
    '../../lib/api': { profilesApi: { listStaff: async () => [] }, chatNotesApi: { list: async () => [] } },
    '../../lib/chat-delivery-recovery': { listChatDeliveryRecovery: id => id === 'A' ? a.promise : Promise.resolve([]) },
  });
  h.render({ conversation: room('B') }); await settle(); h.render();
  a.resolve([{ event_key: 'event-A', state: 'delivery_unknown', reply_text: 'A-only-reply', updated_at: '2026-10-08' }]); await settle(); h.render();
  assert.doesNotMatch(text(h.tree), /A-only-reply|ยังยืนยันการส่งไม่ได้/);
  h.unmount();
});
