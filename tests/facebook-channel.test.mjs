import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanPublicCommentAnswer,
  hasPublicEvidence,
  messengerQuickReplies,
  pageEvents,
  shouldAnswerCommentPublicly,
} from '../supabase/functions/_shared/facebook-channel.mjs';

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
    { name: 'get_exact_price', result_summary: '{"ok":true,"exact_match":true,"sku":"2020000992"}' },
  ] }, 'ราคา 8.50 บาท'), true);
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
