import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql=readFileSync(new URL('../supabase/migrations/20261008051612_audit_chat_delivery.sql',import.meta.url),'utf8');
const room='00000000-0000-4000-8000-000000000001';
const staffMessage='00000000-0000-4000-8000-000000000002';

async function database() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;
    create function auth.uid()returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function can_write()returns boolean language sql stable as $$ select current_setting('request.audit.can_write',true)='true' $$;
    create table chat_conversations(id uuid primary key,channel text);
    create table chat_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references chat_conversations,
      sender_type text,content text,content_type text,external_msg_id text,metadata jsonb not null default '{}',created_at timestamptz default now(),unique(conversation_id,external_msg_id));
    insert into chat_conversations values('${room}','line');`);
  await db.exec(sql);return db;
}
async function call(db,name,args) {
  const placeholders=args.map((_,index)=>`$${index+1}`).join(',');
  return (await db.query(`select ${name}(${placeholders}) value`,args)).rows[0].value;
}
const claim=(db,key,channel='line')=>call(db,'claim_chat_delivery_event',[channel,key]);
const update=(db,row,state,text=null,metadata=null)=>call(db,'update_chat_delivery_event',[row.channel,row.event_key,row.claim_token,state,room,text,metadata,null]);
const complete=(db,row)=>call(db,'complete_chat_delivery_event',[row.channel,row.event_key,row.claim_token]);

test('lease claim is exclusive and expired old token cannot overwrite the new claimant',async()=>{
  const db=await database();try {
    const a=await claim(db,'lease');assert.equal(a.action,'claimed');assert.equal(a.attempts,1);
    const busy=await claim(db,'lease');assert.equal(busy.action,'busy');assert.equal(busy.request_id,a.request_id);
    await db.exec("update chat_delivery_events set lease_until=now()-interval '1 second' where event_key='lease'");
    const b=await claim(db,'lease');assert.equal(b.action,'claimed');assert.notEqual(b.claim_token,a.claim_token);assert.equal(b.request_id,a.request_id);
    await assert.rejects(update(db,a,'sending','unsafe',{}),/delivery_claim_conflict/);
    assert.equal((await update(db,b,'reply_pending','prepared',{})).reply_text,'prepared');
  }finally{await db.close();}
});

test('pre-model failure can retry while unknown RAG work and unknown sends require review',async()=>{
  const db=await database();try {
    const safe=await claim(db,'safe');await update(db,safe,'failed');assert.equal((await claim(db,'safe')).action,'claimed');
    const work=await claim(db,'work');await update(db,work,'processing',null,{work_started:true});
    await db.exec("update chat_delivery_events set lease_until=now()-interval '1 second' where event_key='work'");
    const review=await claim(db,'work');assert.equal(review.action,'review');assert.equal(review.state,'processing_unknown');
    const send=await claim(db,'send');await update(db,send,'sending','quote already generated',{});
    await db.exec("update chat_delivery_events set lease_until=now()-interval '1 second' where event_key='send'");
    const ambiguous=await claim(db,'send');assert.equal(ambiguous.action,'review');assert.equal(ambiguous.state,'delivery_unknown');
    assert.equal(ambiguous.reply_text,'quote already generated');
  }finally{await db.close();}
});

test('accepted bot reply and history complete in one transaction, duplicate event produces one message',async()=>{
  const db=await database();try {
    const row=await claim(db,'bot-complete');await update(db,row,'sending','prepared answer',{quote_code:'QT-AUDIT'});
    const done=await complete(db,row);assert.equal(done.state,'delivered');
    assert.equal((await claim(db,'bot-complete')).action,'completed');
    assert.equal((await db.query("select count(*)::int n from chat_messages where sender_type='bot'")).rows[0].n,1);
    assert.equal((await db.query('select metadata from chat_messages')).rows[0].metadata.quote_code,'QT-AUDIT');
  }finally{await db.close();}
});

test('staff completion updates the original agent message; missing message leaves ledger sending',async()=>{
  const db=await database();try {
    await db.exec("update chat_conversations set channel='messenger'");
    await db.query("insert into chat_messages(id,conversation_id,sender_type,content,metadata)values($1,$2,'agent','staff text','{}')",[staffMessage,room]);
    const row=await claim(db,`staff.${staffMessage}`,'messenger');await update(db,row,'sending','staff text',{staff_message_id:staffMessage});
    await complete(db,row);
    const messages=(await db.query('select sender_type,metadata from chat_messages')).rows;
    assert.equal(messages.length,1);assert.equal(messages[0].metadata.outbound_delivery,'delivered');
    const missing=await claim(db,'staff.missing','messenger');await update(db,missing,'sending','not committed',{staff_message_id:'00000000-0000-4000-8000-000000000099'});
    await assert.rejects(complete(db,missing),/staff_message_missing/);
    assert.equal((await db.query("select state from chat_delivery_events where event_key='staff.missing'")).rows[0].state,'sending');
  }finally{await db.close();}
});

test('expired workers are visible for review; explicit staff resolution is role-checked and invalidates stale claimant',async()=>{
  const db=await database();try {
    const row=await claim(db,'expired-review');await update(db,row,'processing',null,{work_started:true});
    await db.exec("update chat_delivery_events set lease_until=now()-interval '1 second' where event_key='expired-review'");
    await db.exec("select set_config('request.audit.can_write','true',false);select set_config('request.jwt.claim.sub','"+staffMessage+"',false)");
    const visible=(await db.query('select * from list_chat_delivery_recovery($1)',[room])).rows[0];
    assert.equal(visible.state,'processing_unknown');
    await db.exec('set role anon');
    await assert.rejects(call(db,'resolve_chat_delivery_recovery',[room,row.event_key,visible.updated_at,'handled_by_staff']),/permission denied/);
    await db.exec('reset role;set role authenticated');
    await db.exec("select set_config('request.audit.can_write','false',false)");
    await assert.rejects(call(db,'resolve_chat_delivery_recovery',[room,row.event_key,visible.updated_at,'handled_by_staff']),/forbidden/);
    await db.exec("select set_config('request.audit.can_write','true',false)");
    await assert.rejects(call(db,'resolve_chat_delivery_recovery',[room,row.event_key,visible.updated_at,'delivered']),/invalid_recovery_resolution/);
    const resolved=await call(db,'resolve_chat_delivery_recovery',[room,row.event_key,visible.updated_at,'handled_by_staff']);assert.equal(resolved.state,'ignored');
    await db.exec('reset role');
    await assert.rejects(update(db,row,'sending','late duplicate',{}),/delivery_claim_conflict/);
    const stored=(await db.query('select reply_metadata from chat_delivery_events where event_key=$1',[row.event_key])).rows[0];
    assert.equal(stored.reply_metadata.reviewed_by,staffMessage);assert.equal(stored.reply_metadata.resolution,'handled_by_staff');
  }finally{await db.close();}
});

test('review resolution preserves prepared answer and rejects stale update versions',async()=>{
  const db=await database();try {
    const row=await claim(db,'cas-review');const prepared=await update(db,row,'reply_pending','prepared answer',{quote_code:'QT-KEEP'});
    await db.exec("select set_config('request.audit.can_write','true',false);select set_config('request.jwt.claim.sub','"+staffMessage+"',false)");
    await db.exec("update chat_delivery_events set updated_at=updated_at+interval '1 second' where event_key='cas-review'");
    await assert.rejects(call(db,'resolve_chat_delivery_recovery',[room,row.event_key,prepared.updated_at,'delivery_verified']),/delivery_recovery_conflict/);
    const current=(await db.query('select * from list_chat_delivery_recovery($1)',[room])).rows[0];
    await call(db,'resolve_chat_delivery_recovery',[room,row.event_key,current.updated_at,'delivery_verified']);
    const stored=(await db.query('select reply_text,reply_metadata from chat_delivery_events where event_key=$1',[row.event_key])).rows[0];
    assert.equal(stored.reply_text,'prepared answer');assert.equal(stored.reply_metadata.quote_code,'QT-KEEP');
    assert.equal((await claim(db,row.event_key)).action,'completed');
  }finally{await db.close();}
});

test('anon/viewer cannot claim or complete; recovery read requires active write permission',async()=>{
  const db=await database();try {
    const row=await claim(db,'role-test');await update(db,row,'failed');
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(claim(db,'forbidden'),/permission denied/);
      await assert.rejects(complete(db,row),/permission denied/);
      await assert.rejects(db.query('select * from chat_delivery_events'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec("set role authenticated;select set_config('request.audit.can_write','false',false)");
    await assert.rejects(db.query('select * from list_chat_delivery_recovery($1)',[room]),/forbidden/);
    await db.exec("select set_config('request.audit.can_write','true',false)");
    assert.equal((await db.query('select * from list_chat_delivery_recovery($1)',[room])).rows.length,1);
  }finally{await db.close();}
});

test('cutover never replays historical inbound work but accepts marked new FB requests and staff messages',async()=>{
  const db=await database();try {
    await db.exec("insert into chat_messages(conversation_id,sender_type,external_msg_id,metadata)values('"+room+"','customer','legacy-line','{}')");
    const legacy=await claim(db,'legacy-line');assert.equal(legacy.action,'review');assert.equal(legacy.last_error,'legacy_event_requires_review');
    await db.exec("update chat_conversations set channel='messenger';insert into chat_messages(conversation_id,sender_type,external_msg_id,metadata)values('"+room+"','customer','old-fb','{\"facebook_bot_status\":\"failed\"}'),('"+room+"','customer','new-fb','{\"delivery_ledger_version\":\"1\"}')");
    assert.equal((await claim(db,'inbox.old-fb','messenger')).action,'review');
    assert.equal((await claim(db,'inbox.new-fb','messenger')).action,'claimed');
    assert.equal((await claim(db,`staff.${staffMessage}`,'messenger')).action,'claimed');
  }finally{await db.close();}
});
