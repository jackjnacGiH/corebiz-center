import test from 'node:test';
import assert from 'node:assert/strict';
import { runDurableChatDelivery } from '../supabase/functions/_shared/chat-delivery.mjs';
function harness() {
  const row = { request_id:'stable-request',claim_token:'claim-1',state:'processing',action:'claimed',reply_text:null };
  return { row, admin:{ async rpc(name,args) {
    if (name === 'claim_chat_delivery_event') return { data:{ ...row, action: ['delivered','ignored'].includes(row.state)?'completed':row.state==='delivery_unknown'?'review':'claimed' },error:null };
    Object.assign(row,{ state:name==='complete_chat_delivery_event'?'delivered':args.p_state,reply_text:args.p_reply_text??row.reply_text,reply_metadata:args.p_reply_metadata??row.reply_metadata });
    return {data:{...row},error:null};
  } } };
}
test('rejected delivery reuses prepared answer and never re-runs quote-producing work',async()=>{
  const h=harness();let generated=0,sent=0;
  const options={channel:'line',eventKey:'customer-1',process:async ctx=>{generated++; await ctx.send('Existing QT',{quote_code:'QT-1'},async()=>false,async()=>{});},replay:async(ctx,row)=>ctx.send(row.reply_text,row.reply_metadata,async()=>{sent++;return true;},async()=>{})};
  await assert.rejects(runDurableChatDelivery(h.admin,options),/external_send_rejected/);
  await runDurableChatDelivery(h.admin,options);
  await runDurableChatDelivery(h.admin,options);
  assert.equal(generated,1);assert.equal(sent,1);assert.equal(h.row.state,'delivered');
});
test('ambiguous provider outcome requires review instead of a second send',async()=>{
  const h=harness();let sent=0;
  const options={channel:'line',eventKey:'customer-2',process:async ctx=>ctx.send('Answer',{},async()=>{sent++;throw new Error('connection lost after write');},async()=>{}),replay:async()=>{sent++;}};
  await assert.rejects(runDurableChatDelivery(h.admin,options),/connection lost/);
  assert.equal(await runDurableChatDelivery(h.admin,options),'delivery_unknown');assert.equal(sent,1);
});
test('temporary processing failure can retry with the same request identity',async()=>{
  const h=harness();let attempts=0;
  const options={channel:'line',eventKey:'customer-3',process:async ctx=>{assert.equal(ctx.requestId,'stable-request');if(++attempts===1)throw new Error('temporary db outage');},replay:async()=>{}};
  await assert.rejects(runDurableChatDelivery(h.admin,options));assert.equal(h.row.state,'failed');
  await runDurableChatDelivery(h.admin,options);assert.equal(attempts,2);assert.equal(h.row.state,'ignored');
});
