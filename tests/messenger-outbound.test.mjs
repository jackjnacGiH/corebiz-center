import test from 'node:test';
import assert from 'node:assert/strict';
import { facebookOutboundTarget,facebookTextParts } from '../supabase/functions/_shared/messenger-outbound.mjs';
import { OWNER_TEST } from '../supabase/functions/_shared/facebook-owner-test.mjs';
test('Facebook activation is explicit, page scoped and inside the standard response window',()=>{
  const now=Date.parse('2026-10-08T05:00:00Z');
  const room={id:'ordinary',channel:'messenger',external_id:'123',last_customer_message_at:new Date(now-1000).toISOString(),metadata:{page_id:OWNER_TEST.pageId,facebook_surface:'messenger'}};
  assert.equal(facebookOutboundTarget(room,OWNER_TEST.pageId,false,now),null);
  assert.equal(facebookOutboundTarget(room,'wrong',true,now),null);
  assert.equal(facebookOutboundTarget({...room,last_customer_message_at:new Date(now-25*3600000).toISOString()},OWNER_TEST.pageId,true,now),null);
  assert.equal(facebookOutboundTarget(room,OWNER_TEST.pageId,true,now).recipient,'123');
  const owner={...room,id:OWNER_TEST.messengerRoom,external_id:OWNER_TEST.messengerSender};
  assert.ok(facebookOutboundTarget(owner,OWNER_TEST.pageId,false,now));
});
test('outbound text preserves Unicode and stays in provider bounds',()=>{
  const input='🔧'.repeat(2000);const parts=facebookTextParts(input);assert.equal(parts.join(''),input);assert.equal(parts.length,2);
  assert.throws(()=>facebookTextParts(''),/message_out_of_range/);
  assert.throws(()=>facebookTextParts('x'.repeat(10000)),/message_out_of_range/);
});
