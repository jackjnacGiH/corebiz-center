import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { requireStaff } from '../supabase/functions/_shared/staff-auth.mjs';
import { runDurableChatDelivery } from '../supabase/functions/_shared/chat-delivery.mjs';
import { facebookOutboundTarget, facebookTextParts } from '../supabase/functions/_shared/messenger-outbound.mjs';
import { uploadPrivateChatAttachment } from '../supabase/functions/_shared/chat-attachment-storage.mjs';

const id='00000000-0000-4000-8000-000000000001';
const pageId='103826764792590';
function compiled(slug,extra='') {
  return ts.transpileModule(readFileSync(new URL(`../supabase/functions/${slug}/index.ts`,import.meta.url),'utf8')+extra,
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}

test('Messenger handler rejects disallowed role, owner, platform, Page and expired response window before any send/claim',async()=>{
  for(const scenario of ['viewer','inactive','other-sender','other-channel','other-page','expired','test-gate']) {
    let handler;let external=0;let claims=0;
    const room={id:'other-room',channel:scenario==='other-channel'?'line':'messenger',external_id:'111222333',
      last_customer_message_at:new Date(Date.now()-(scenario==='expired'?25*3600000:1000)).toISOString(),metadata:{page_id:scenario==='other-page'?'wrong-page':pageId,facebook_surface:'messenger'}};
    const db={auth:{getUser:async()=>({data:{user:{id}}})},rpc:async()=>{claims++;throw new Error('No claim expected');},
      from:table=>{const builder={select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:table==='profiles'?{id,role:scenario==='viewer'?'viewer':'staff',is_active:scenario!=='inactive'}:
        table==='chat_messages'?{id,conversation_id:'other-room',sender_id:scenario==='other-sender'?'other-staff':id,sender_type:'agent',content:'audit only'}:room})};return builder;}};
    runInNewContext(compiled('messenger-push'),{
      exports:{},Request,Response,console,AbortSignal,fetch:async()=>{external++;throw new Error('No external calls');},
      Deno:{env:{get:name=>({SUPABASE_URL:'https://audit.test',SUPABASE_SERVICE_ROLE_KEY:'internal-only',META_PAGE_ID:pageId,META_PAGE_ACCESS_TOKEN:'fake-test',FACEBOOK_PUBLIC_CHANNEL_ENABLED:scenario==='test-gate'?'false':'true'}[name])},serve:fn=>{handler=fn;}},
      require:name=>name.includes('supabase-js')?{createClient:()=>db}:name.endsWith('staff-auth.mjs')?{requireStaff}:name.endsWith('chat-delivery.mjs')?{runDurableChatDelivery}:{facebookOutboundTarget,facebookTextParts},
    });
    const response=await handler(new Request('https://audit.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({message_id:id})}));
    assert.equal(response.status,['viewer','inactive','other-sender'].includes(scenario)?403:409,scenario);
    assert.equal(external,0);assert.equal(claims,0);
  }
});

test('Facebook comment with prior failed ledger row remains claimable instead of throwing duplicate key',async()=>{
  const exports={};
  runInNewContext(compiled('facebook-webhook','\nexport { claimComment };'),{
    exports,console,Request,Response,Deno:{env:{get:()=>pageId},serve:()=>{}},require:()=>({}),
  });
  const db={from:table=>{
    let inserting=false;
    const builder={select:()=>builder,eq:()=>builder,insert:()=>{inserting=true;return builder;},single:async()=>({data:{id},error:null}),
      maybeSingle:async()=>({data:table==='chat_conversations'?{id}:table==='facebook_comment_events'?{status:'failed'}:{id},error:null}),
      then:resolve=>resolve(inserting?{error:{code:'23505'}}:{data:null,error:null})};return builder;
  }};
  const result=await exports.claimComment(db,{kind:'comment',commentId:'111_222',postId:'111_333',text:'สินค้า',authorId:'444'});
  assert.equal(result.incomingId,id);assert.equal(result.conversationId,id);
});

function maintenance(rows,updateError=null) {
  let handler;let downloads=0;let updates=0;
  const db={rpc:async()=>({data:'test-key'}),storage:{from:()=>({upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://audit.test/signed'}})})},
    from:table=>{let updating=false;const builder={select:()=>builder,eq:()=>builder,limit:()=>builder,update:()=>{updating=true;updates++;return builder;},
      maybeSingle:async()=>({data:{channel_access_token:'fake-test'}}),
      then:resolve=>resolve(updating?{error:updateError}:{data:table==='chat_messages'?rows:[]})};return builder;}};
  runInNewContext(compiled('reprocess-line-files'),{
    exports:{},Request,Response,Uint8Array,console,Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},
    fetch:async()=>{downloads++;return new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/pdf'}});},
    require:name=>name.includes('supabase-js')?{createClient:()=>db}:name.endsWith('chat-attachment-storage.mjs')?{uploadPrivateChatAttachment}:{},
  });
  return {handler,counts:()=>({downloads,updates})};
}

test('maintenance never downloads an already recovered private file again',async()=>{
  const h=maintenance([{id,external_msg_id:'line-msg',metadata:{file_bucket:'chat-private-attachments',file_path:'room/doc.pdf'}}]);
  const response=await h.handler(new Request('https://audit.test',{method:'POST',headers:{'x-key':'test-key'}}));
  assert.equal((await response.json()).total,0);assert.deepEqual(h.counts(),{downloads:0,updates:0});
});

test('maintenance reports database write failure instead of successful recovery',async()=>{
  const h=maintenance([{id,conversation_id:id,external_msg_id:'line-msg',metadata:{file_name:'doc.pdf'}}],{message:'write_denied'});
  const response=await h.handler(new Request('https://audit.test',{method:'POST',headers:{'x-key':'test-key'}}));
  const body=await response.json();assert.equal(body.recovered,0);assert.equal(body.results[0].ok,false);assert.equal(body.results[0].reason,'write_denied');
});
