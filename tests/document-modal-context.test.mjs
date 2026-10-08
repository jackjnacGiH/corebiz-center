import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, elements, mountComponent, settle, text } from './helpers/component-harness.mjs';

const record = id => ({ id, version: 7, code: `QT-${id}`, status: 'draft', customer: null, created_at: '2026-10-01', subtotal: 90, discount: 5, vat: 5.95, total: 90.95 });
const item = { id: 'line', variant_id: 'variant', product_id: 'product', sku: 'SKU', product_name: 'Test', quantity: 1, unit_price: 100, discount: 10, total: 90 };
for (const kind of ['quote', 'order']) {
  test(`${kind} modal cannot apply an old A response or action to selected B`, async () => {
    const a = deferred(), b = deferred(), action = deferred();
    const reads = [], updates = [];
    const read = id => { reads.push(id); return id === 'A' ? a.promise : b.promise; };
    const props = id => ({ isOpen: true, [`${kind}Id`]: id, onClose() {} });
    const h = mountComponent(`frontend/src/components/${kind === 'quote' ? 'Quote' : 'Order'}DetailModal.tsx`, props('A'), {
      '../lib/api': {
        orgSettingsApi: { get: async () => null }, productsApi: { list: async () => [] }, tierApi: {},
        quoteRecordApi: { getWithItems: read, approveAsOrder: id => { updates.push(id); return action.promise; } },
        ordersApi: { getById: read, updateStatus: id => { updates.push(id); return action.promise; } },
      },
    });
    h.render(props('B'));
    b.resolve({ [kind]: { ...record('B'), status: kind === 'order' ? 'pending' : 'draft' }, items: [item] }); await settle(); h.render();
    assert.match(text(h.tree), /QT-B/);
    a.resolve({ [kind]: record('A'), items: [item] }); await settle(); h.render();
    assert.match(text(h.tree), /QT-B/); assert.doesNotMatch(text(h.tree), /QT-A/);
    const edit = elements(h.tree, node => !!node.props.onClick && /แก้ไข/.test(text(node)))[0];
    await edit.props.onClick(); await settle(); h.render();
    const editor = elements(h.tree, node => node.type === 'EditableQuoteItems')[0];
    assert.equal(editor.props.initial[0].discount, 10);
    assert.equal(editor.props.initial[0].id, 'line');
    assert.equal(editor.props.initial[0].variant_id, 'variant');
    assert.equal(editor.props.initialDiscount, 5);
    h.render({ ...props('B'), isOpen: false });
    assert.doesNotMatch(text(h.tree), /QT-B/);
    assert.deepEqual(reads, ['A', 'B']);
    assert.deepEqual(updates, []);
    h.unmount();
  });
}

test('quote action A finishing after switch B cannot replace B or clear its editing state', async () => {
  const action = deferred();
  const reads = [];
  const props = id => ({ isOpen: true, quoteId: id, onClose() {} });
  const h = mountComponent('frontend/src/components/QuoteDetailModal.tsx', props('A'), {
    '../lib/api': { orgSettingsApi: { get: async () => null }, productsApi: { list: async () => [] }, tierApi: {},
      quoteRecordApi: { getWithItems: async id => { reads.push(id); return { quote: record(id), items: [item] }; }, approveAsOrder: id => { assert.equal(id, 'A'); return action.promise; } },
    },
  });
  await settle(); h.render();
  const approve = elements(h.tree, node => !!node.props.onClick && /อนุมัติ.*คำสั่งซื้อ/.test(text(node)))[0];
  assert.ok(approve);
  const pending = approve.props.onClick();
  h.render(props('B')); await settle(); h.render();
  action.resolve({ id: 'order-A', code: 'SO-A' }); await pending; await settle(); h.render();
  assert.match(text(h.tree), /QT-B/); assert.doesNotMatch(text(h.tree), /SO-A/);
  assert.deepEqual(reads, ['A', 'B']);
  h.unmount();
});
