import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { deferred, elements, mountComponent, settle, text } from './helpers/component-harness.mjs';

const delivery = (key, updated = '2026-10-08T01:00:00Z') => ({ event_key: key, state: 'delivery_unknown', reply_text: 'Prepared reply', updated_at: updated });
const conversation = id => ({ id, display_name: id, channel: 'line', customer_id: null, tags: [], auto_tags: [], metadata: {} });
function panel(recovery, { role = 'staff', active = true } = {}) {
  return mountComponent('frontend/src/components/chat/ContactPanel.tsx', { conversation: conversation('A') }, {
    '../../lib/api': { profilesApi: { listStaff: async () => [] }, chatNotesApi: { list: async () => [] } },
    '../../lib/supabase': { supabase: { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {} } },
    '../../lib/AuthProvider': { useAuth: () => ({ profile: { role, is_active: active } }) },
    '../../lib/chat-delivery-recovery': recovery,
  });
}
const button = h => elements(h.tree, node => !!node.props.onClick && text(node).trim() === 'ปิดรายการตรวจสอบ')[0];

test('recovery RPC sends the row timestamp and handled_by_staff without claiming customer delivery', async () => {
  const calls = []; let error = null;
  const supabase = { rpc: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return { error }; } };
  const exports = {};
  const source = readFileSync(new URL('../frontend/src/lib/chat-delivery-recovery.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({ supabase }) });
  await exports.resolveChatDeliveryRecovery('A', delivery('event-A'));
  assert.deepEqual(calls[0], { name: 'resolve_chat_delivery_recovery', args: { p_conversation_id: 'A', p_event_key: 'event-A', p_expected_updated_at: '2026-10-08T01:00:00Z', p_resolution: 'handled_by_staff' } });
  error = new Error('delivery_recovery_conflict');
  await assert.rejects(exports.resolveChatDeliveryRecovery('A', delivery('event-A')), /conflict/);
});

test('only active owner/admin/staff can see the human recovery close action', async () => {
  for (const [role, active, visible] of [['owner', true, true], ['admin', true, true], ['staff', true, true], ['viewer', true, false], ['agent', true, false], ['customer', true, false], ['owner', false, false]]) {
    const h = panel({ listChatDeliveryRecovery: async () => [delivery('event-A')] }, { role, active });
    await settle(); h.render(); assert.equal(!!button(h), visible, `${role}/${active}`); h.unmount();
  }
});

test('human recovery close disables duplicate clicks and refreshes the pending list after success', async () => {
  const done = deferred(); let listCalls = 0, resolveCalls = 0;
  const h = panel({ listChatDeliveryRecovery: async () => ++listCalls === 1 ? [delivery('event-A')] : [], resolveChatDeliveryRecovery: (id, row) => { resolveCalls++; assert.equal(id, 'A'); assert.equal(row.updated_at, '2026-10-08T01:00:00Z'); return done.promise; } });
  await settle(); h.render(); const close = button(h).props.onClick; close(); h.render(); assert.equal(button(h).props.disabled, true); close();
  assert.equal(resolveCalls, 1);
  done.resolve(); await settle(); h.render(); assert.equal(button(h), undefined); assert.equal(listCalls, 2); h.unmount();
});

test('CAS/role denials keep the row visible, show the error, and refresh to the current timestamp', async () => {
  for (const message of ['delivery_recovery_conflict', 'forbidden']) {
    let listCalls = 0;
    const h = panel({ listChatDeliveryRecovery: async () => [delivery('event-A', ++listCalls === 1 ? '2026-10-08T01:00:00Z' : '2026-10-08T02:00:00Z')], resolveChatDeliveryRecovery: async () => { throw new Error(message); } });
    await settle(); h.render(); button(h).props.onClick(); await settle(); h.render();
    assert.ok(button(h)); assert.equal(button(h).props.disabled, false);
    assert.match(text(h.tree), message === 'forbidden' ? /ไม่มีสิทธิ์/ : /รายการนี้เปลี่ยนแปลงแล้ว/);
    assert.equal(listCalls, 2); h.unmount();
  }
});

test('a late resolution or denial for A cannot remove or show an error in B', async () => {
  const done = deferred();
  const h = panel({ listChatDeliveryRecovery: async id => [delivery(`event-${id}`)], resolveChatDeliveryRecovery: () => done.promise });
  await settle(); h.render(); button(h).props.onClick(); h.render();
  h.render({ conversation: conversation('B') }); await settle(); h.render();
  assert.equal(button(h).props.disabled, false);
  done.reject(new Error('forbidden')); await settle(); h.render();
  assert.ok(button(h)); assert.equal(button(h).props.disabled, false); assert.doesNotMatch(text(h.tree), /ไม่มีสิทธิ์/); h.unmount();
});
