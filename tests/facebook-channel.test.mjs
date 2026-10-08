import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanPublicCommentAnswer,
  hasPublicEvidence,
  messengerQuickReplies,
  pageEvents,
  shouldAnswerCommentPublicly,
} from '../supabase/functions/_shared/facebook-channel.mjs';

const exactPriceSummary = (unitPrice = 8.5, quantity = 100) => JSON.stringify({
  ok: true, exact_match: true, sku: '2020000992', product_name: 'SA331', unit: 'ชิ้น',
  quantity, unit_price: unitPrice, line_total: Math.round(unitPrice * quantity * 100) / 100,
  currency: 'THB',
});
const exactPriceCall = (resultSummary = exactPriceSummary()) => ({
  name: 'get_exact_price', args: { sku: '2020000992', qty: 100 }, result_summary: resultSummary,
});

test('accepts only target Page customer messages and newly added comments', () => {
  const payload = { object: 'page', entry: [
    { id: 'target', messaging: [
      { sender: { id: 'customer' }, message: { mid: 'm1', text: 'มี SA331 ไหม' } },
      { sender: { id: 'target' }, message: { mid: 'm2', text: 'our echo' } },
      { sender: { id: 'customer' }, message: { mid: 'm3', is_echo: true, text: 'echo' } },
      { sender: { id: 'customer' }, message: { mid: 'm4', text: '1. #1500', quick_reply: { payload: 'กระดาษทรายกลมสักหลาด SA331 5" #1500' } } },
      { sender: { id: 'customer' }, message: { mid: 'm5', attachments: [{ type: 'image', payload: { url: 'https://cdn.example.com/photo.jpg' } }] } },
    ], changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', from: { id: 'customer' }, message: 'ราคาเบอร์ 1500 เท่าไหร่' } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', from: { id: 'target' }, message: 'our reply' } },
      { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c3', from: { id: 'customer' }, message: 'edited' } },
    ] },
    { id: 'other', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c4', message: 'wrong Page' } }] },
  ] };
  assert.deepEqual(pageEvents(payload, 'target'), [
    { kind: 'message', senderId: 'customer', messageId: 'm1', text: 'มี SA331 ไหม' },
    { kind: 'message', senderId: 'customer', messageId: 'm4', text: 'กระดาษทรายกลมสักหลาด SA331 5" #1500' },
    { kind: 'message', senderId: 'customer', messageId: 'm5', text: '![image](https://cdn.example.com/photo.jpg)', contentType: 'image', attachmentUrl: 'https://cdn.example.com/photo.jpg' },
    { kind: 'comment', commentId: 'c1', postId: 'p1', text: 'ราคาเบอร์ 1500 เท่าไหร่' },
  ]);
});

test('public comments keep billing and customer-specific questions in Inbox', () => {
  assert.equal(shouldAnswerCommentPublicly('มีจานทราย PS36 #80 ราคาเท่าไหร่'), true);
  assert.equal(shouldAnswerCommentPublicly('ขอใบเสนอราคา QT-01000128'), false);
  assert.equal(shouldAnswerCommentPublicly('ขอเลขบัญชีโอนเงิน'), false);
  assert.equal(cleanPublicCommentAnswer('โหมดทดสอบตรวจพบคำขอ แต่ไม่ได้สร้างงานจริงค่ะ'), null);
  assert.equal(cleanPublicCommentAnswer('กระดาษทราย SA331 5" #1500 SKU 2020000992\n![image](https://example.com/a.jpg)'),
    'กระดาษทราย SA331 5" #1500 SKU 2020000992\nhttps://example.com/a.jpg');
  assert.equal(cleanPublicCommentAnswer('ราคา 8.50 บาท/ชิ้นค่ะ ให้เอยทำใบเสนอราคาให้เลยไหมคะ\n1. ต้องการใบเสนอราคา\n2. ไม่ต้องการ'),
    'ราคา 8.50 บาท/ชิ้นค่ะ');
  assert.equal(hasPublicEvidence({ tool_calls: [{ name: 'find_products', result_meta: { disposition: 'unresolved' } }] }), false);
  assert.equal(hasPublicEvidence({ tool_calls: [{ name: 'find_products', result_meta: { disposition: 'needs_selection' } }] }), true);
  assert.equal(hasPublicEvidence({ sources: [{ title: 'general guide' }] }, 'SKU 2020000992 ราคา 8.50 บาท'), false);
  assert.equal(hasPublicEvidence({ tool_calls: [{ name: 'find_products', result_meta: { disposition: 'resolved' } }] }, 'ราคา 8.50 บาท'), false);
  assert.equal(hasPublicEvidence({ tool_calls: [
    { name: 'find_products', result_meta: { disposition: 'resolved' } },
    exactPriceCall(),
  ] }, 'ราคา 8.50 บาท'), true);
});

test('public evidence cannot use an unrelated source to substantiate product or unit-price claims', () => {
  const unrelatedKnowledge = { sources: [{ title: 'shipping guide', content_preview: 'วิธีจัดส่งสินค้า' }] };
  assert.equal(hasPublicEvidence(unrelatedKnowledge, 'SA331 มีขนาด 5 นิ้ว'), false);
  assert.equal(hasPublicEvidence(unrelatedKnowledge, 'กระดาษทรายเบอร์ #80 พร้อมส่ง'), false);
  assert.equal(hasPublicEvidence(unrelatedKnowledge, 'The SA331 abrasive disc is 5 inches'), false);
  assert.equal(hasPublicEvidence(unrelatedKnowledge, 'ราคา 8.50 ต่อชิ้น'), false);
  assert.equal(hasPublicEvidence(unrelatedKnowledge, '8.50 per piece'), false);
  assert.equal(hasPublicEvidence(unrelatedKnowledge, 'เปิดทำการวันจันทร์ถึงศุกร์'), true);

  const catalog = { tool_calls: [{ name: 'find_products', result_meta: { disposition: 'resolved' } }] };
  assert.equal(hasPublicEvidence(catalog, 'ราคา 8.50 ต่อชิ้น'), false);
  assert.equal(hasPublicEvidence(catalog, 'ชิ้นละ 8.50'), false);
  assert.equal(hasPublicEvidence(catalog, '8.50/piece'), false);
  const pricedCatalog = { tool_calls: [
    ...catalog.tool_calls,
    exactPriceCall(),
  ] };
  assert.equal(hasPublicEvidence(pricedCatalog, 'ราคา 8.50 ต่อชิ้น'), true);
  assert.equal(hasPublicEvidence(pricedCatalog, '8.50 per piece'), true);
});

test('public price claims must match complete exact-price facts', () => {
  const catalog = { name: 'find_products', result_meta: { disposition: 'resolved' } };
  const verified = { tool_calls: [catalog, exactPriceCall()] };
  assert.equal(hasPublicEvidence(verified, 'ราคา 8.50 บาท/ชิ้น รวม 850.00 บาท'), true);
  assert.equal(hasPublicEvidence(verified, 'THB 8.50 per piece for 100 pieces (THB 850 total)'), true);
  assert.equal(hasPublicEvidence(verified, 'ราคา 9.50 บาท/ชิ้น'), false);
  assert.equal(hasPublicEvidence(verified, 'ราคา 8.50 ต่อชิ้น ยอดรวม 999 บาท'), false);
  assert.equal(hasPublicEvidence(verified, 'THB 900 total'), false);
  assert.equal(hasPublicEvidence(verified, '$8.50 per piece'), false);

  const incompleteSummary = exactPriceSummary().slice(0, -10);
  assert.equal(hasPublicEvidence({ tool_calls: [catalog, exactPriceCall(incompleteSummary)] }, 'ราคา 8.50 บาท'), false);
  assert.equal(hasPublicEvidence({ tool_calls: [catalog, exactPriceCall('{"ok":true,"exact_match":true}')] }, 'ราคา 8.50 บาท'), false);
  assert.equal(hasPublicEvidence({ tool_calls: [catalog, { ...exactPriceCall(), args: { sku: 'WRONG', qty: 100 } }] }, 'ราคา 8.50 บาท'), false);
});

test('Messenger choices carry exact product in payload despite short button titles', () => {
  const replies = messengerQuickReplies('เลือกเบอร์ค่ะ\n1. กระดาษทรายกลมสักหลาด SA331 5" #1500\n2. กระดาษทรายกลมสักหลาด SA331 5" #2000');
  assert.equal(replies.length, 2);
  assert.ok(replies[0].title.length <= 20);
  assert.match(replies[0].title, /#1500/u);
  assert.match(replies[1].title, /#2000/u);
  assert.notEqual(replies[0].title, replies[1].title);
  assert.equal(replies[0].payload, 'กระดาษทรายกลมสักหลาด SA331 5" #1500');
  assert.equal(replies[1].payload, 'กระดาษทรายกลมสักหลาด SA331 5" #2000');
});
