import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { requireStaff, embeddingInputError, knowledgeInputError } from '../supabase/functions/_shared/staff-auth.mjs';
import { uploadPrivateChatAttachment } from '../supabase/functions/_shared/chat-attachment-storage.mjs';
import { attachmentPaths, rewriteAttachmentMessage, migrateManifest, rollbackManifest } from '../scripts/migrate-chat-private-attachments.mjs';

const compile = path => ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'), {
  compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
}).outputText;

function staffDb(role='staff', active=true) {
  const calls=[];
  return { calls, auth:{ getUser:async token => { calls.push('getUser'); return { data:token==='anon'?{}:{user:{id:'user-1'}}, error:null }; } },
    from: table => { calls.push(table); const builder={ select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:table==='profiles'?{id:'user-1',role,is_active:active}:null,error:null}) };return builder; } };
}

test('authorization rejects anon, customers, viewer, inactive staff before privileged lookup',async()=>{
  for(const [token,role,active,expected] of [['anon','staff',true,401],['user','customer',true,403],['user','viewer',true,403],['user','staff',false,403]]) {
    const db=staffDb(role,active);
    const result=await requireStaff(db,new Request('https://audit.test',{headers:{Authorization:`Bearer ${token}`}}),['owner','admin','staff']);
    assert.equal(result.status,expected);
    assert.ok(db.calls.every(call=>['getUser','profiles'].includes(call)));
  }
  const db=staffDb('owner');
  assert.equal((await requireStaff(db,new Request('https://audit.test',{headers:{Authorization:'Bearer user'}}))).actor.id,'user-1');
});

test('service-role bypass is opt-in and exact, and auth lookup failure fails closed',async()=>{
  const req=new Request('https://audit.test',{headers:{Authorization:'Bearer internal-key'}});
  assert.equal((await requireStaff(staffDb('customer'),req)).status,403);
  const db=staffDb();
  assert.equal((await requireStaff(db,req,['owner'],'internal-key')).actor.role,'service_role');
  assert.equal(db.calls.length,0);
  const failed=staffDb();failed.from=()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({error:{message:'offline'}})});
  assert.equal((await requireStaff(failed,req)).status,503);
});

test('embedding bounds prevent model override, oversized text and oversized batch',()=>{
  assert.equal(embeddingInputError(['valid']),null);
  assert.equal(embeddingInputError(['valid'],'different-model'),'embedding_model_not_allowed');
  assert.equal(embeddingInputError(['x'.repeat(12001)]),'text_out_of_range');
  assert.equal(embeddingInputError(Array(101).fill('ok')),'texts_batch_out_of_range');
  assert.equal(embeddingInputError(Array(20).fill('x'.repeat(12000))),'embedding_batch_too_large');
  const knowledge={title:'FAQ',content:'valid',source_path:'faq.md'};
  assert.equal(knowledgeInputError(knowledge,true),null);
  assert.equal(knowledgeInputError({...knowledge,tags:[42]},true),'invalid_tags');
  assert.equal(knowledgeInputError({...knowledge,visibility:'admin'},true),'invalid_visibility');
  assert.equal(knowledgeInputError({...knowledge,title:12},true),'invalid_title');
});

test('actual deployed-derived write/push handlers reject forbidden identities before model, room or write',async()=>{
  for(const slug of ['add-knowledge','replace-knowledge','openai-embed','line-push']) {
    for(const role of ['customer','viewer']) {
      let handler;let fetches=0;const db=staffDb(role);
      runInNewContext(compile(`../supabase/functions/${slug}/index.ts`),{
        exports:{},Request,Response,Headers,console,crypto,
        Deno:{env:{get:name=>({SUPABASE_URL:'https://audit.test',SUPABASE_SERVICE_ROLE_KEY:'internal-key',SUPABASE_ANON_KEY:'public-key',OPENAI_API_KEY:'test-only'}[name])},serve:fn=>{handler=fn;}},
        fetch:async()=>{fetches++;throw new Error('No external calls allowed');},
        require:name=>name.includes('supabase-js')?{createClient:()=>db}:name.endsWith('staff-auth.mjs')?{requireStaff,embeddingInputError,knowledgeInputError}:{},
      });
      const response=await handler(new Request('https://audit.test',{method:'POST',headers:{Authorization:'Bearer user'},body:'{}'}));
      assert.equal(response.status,403,`${slug} ${role}`);
      assert.equal(fetches,0);
      assert.deepEqual(db.calls,['getUser','profiles']);
    }
  }
});

test('JSON-LD safely round-trips Thai text while removing literal script terminators',()=>{
  const exports={};runInNewContext(compile('../apps/storefront/lib/seo.ts'),{exports,require:()=>({})});
  const obj={name:'ไทย </script><script>inert</script>\u2028&'};
  const html=exports.ld(obj).__html;
  assert.ok(!html.includes('<'));
  assert.deepEqual(JSON.parse(html),obj);
});

test('private attachments never use public URLs and signing failures surface',async()=>{
  const calls=[];
  const db={storage:{from:bucket=>({upload:async(path,body)=>{calls.push([bucket,path,body]);return{};},createSignedUrl:async(path,ttl)=>({data:{signedUrl:`signed/${path}/${ttl}`}})})}};
  const result=await uploadPrivateChatAttachment(db,{path:'room/image.png',body:'bytes',contentType:'image/png'});
  assert.equal(result.bucket,'chat-private-attachments');assert.match(result.url,/604800$/);
  db.storage.from=()=>({upload:async()=>({}),createSignedUrl:async()=>({error:new Error('denied')})});
  await assert.rejects(uploadPrivateChatAttachment(db,{path:'room/image.png',body:'bytes'}),/denied/);
});

test('portal cache is identity-scoped and pending A never returns after B login',async()=>{
  let user='A';let listener;let releaseA;let reads=0;
  const db={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}}),onAuthStateChange:fn=>{listener=fn;}},
    rpc:async name=> { if(name==='link_my_customer_by_email')return{};reads++;const id=user;if(id==='A')await new Promise(resolve=>{releaseA=resolve;});return{data:[{customer_id:id}]}; }};
  const exports={};runInNewContext(compile('../apps/storefront/lib/supabase-browser.ts'),{exports,process:{env:{}},require:()=>({createClient:()=>db})});
  const a=exports.getPortalProfile();await new Promise(resolve=>setImmediate(resolve));
  user='B';listener('SIGNED_IN',{user:{id:'B'}});
  assert.equal((await exports.getPortalProfile()).customer_id,'B');
  releaseA();assert.equal(await a,null);
  assert.equal((await exports.getPortalProfile()).customer_id,'B');assert.equal(reads,2);
  user=null;listener('SIGNED_OUT',null);assert.equal(await exports.getPortalProfile(),null);
});

test('storefront unavailable response throws and full reads use stable pages beyond 1000 rows',async()=>{
  const rows=Array.from({length:2017},(_,id)=>({id,sku:String(id),spec:{size:"5 inch",image_studio:{prompt:"internal"}}}));const ranges=[];let unavailable=false;
  const db={from:()=>{const builder={select:()=>builder,order:()=>builder,range:async(a,b)=>{ranges.push([a,b]);return unavailable?{error:{message:'503'}}:{data:rows.slice(a,b+1)};}};return builder;}};
  const exports={};runInNewContext(compile('../apps/storefront/lib/products.ts'),{exports,require:()=>({supabase:db})});
  const products=await exports.getAllProducts();
  assert.equal(products.length,2017);assert.deepEqual(ranges,[[0,999],[1000,1999],[2000,2999]]);
  assert.equal(products[0].spec.size,"5 inch");assert.equal(products[0].spec.image_studio,undefined);
  unavailable=true;await assert.rejects(exports.getAllProducts(),/catalog_unavailable: 503/);
});

test('public specs retain customer scalar values but hide internal image metadata and financial fields',()=>{
  const exports={};runInNewContext(compile('../apps/storefront/lib/products.ts'),{exports,require:()=>({})});
  const product={sku:'2020006681',spec:{'เบอร์':180,'ขนาด':'5"',zero:0,checked:false,image_studio:{prompt:'internal'},internal_note:'private',cost:3,margin_percent:20,buying_price:4,nested:{x:1},empty:'  '}};
  const rows=exports.specRows(product);
  assert.equal(rows.some(([key])=>key==='เบอร์'),true);assert.equal(rows.find(([key])=>key==='zero')[1],'0');
  assert.equal(rows.find(([key])=>key==='checked')[1],'false');
  assert.equal(rows.some(([key])=>['image_studio','internal_note','cost','margin_percent','buying_price','nested','empty'].includes(key)),false);
  assert.ok(!exports.featuresOf(product).some(value=>value.includes('[object Object]')||value.includes('internal')));
});

test('actual storefront handler rejects below MOQ before any document write and commits valid requests once',async()=>{
  for(const [qty,status,writes] of [[1,422,0],[99,422,0],[100,200,1],[-1,400,0],[1.5,400,0]]) {
    let handler;const requests=[];
    const products=[{id:'product',sku:'SKU100',name_th:'สินค้า',unit:'ชิ้น',min_order_qty:100,price:8.5}];
    const db={from:()=>{const builder={select:()=>builder,in:()=>builder,eq:()=>builder,then:resolve=>resolve({data:products})};return builder;},rpc:async(name,args)=>{requests.push({name,args});return{data:{id:'quote',code:'QT-AUDIT'}};}};
    runInNewContext(compile('../supabase/functions/storefront-quote/index.ts'),{
      exports:{},Request,Response,console,Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},require:()=>({createClient:()=>db}),
    });
    const response=await handler(new Request('https://audit.test',{method:'POST',body:JSON.stringify({items:[{sku:'SKU100',qty}],contact:{name:'audit',phone:'test'}})}));
    assert.equal(response.status,status);assert.equal(requests.length,writes);
    if(writes){assert.equal(requests[0].name,'create_storefront_quote_atomic');assert.equal(requests[0].args.p_items[0].total,850);}
  }
});

test('legacy migration rewrites metadata and can roll back without deleting originals',async()=>{
  const url='https://audit.test/storage/v1/object/public/chat-attachments/room/a%20b.pdf';
  const original={id:'message',content:`![image](${url})`,metadata:{file_url:url,file_name:'a b.pdf'}};
  const paths=attachmentPaths(original);assert.equal(paths.length,1);assert.equal(paths[0].path,'room/a b.pdf');
  const rewrite=rewriteAttachmentMessage(original,[{...paths[0],signedUrl:'https://audit.test/signed'}]);
  assert.equal(rewrite.metadata.file_bucket,'chat-private-attachments');assert.equal(rewrite.metadata.file_url,undefined);
  const writes=[];let state={...original};let bucketUpdates=0;
  const db={storage:{from:()=>({download:async()=>({data:new Blob(['same bytes'],{type:'application/pdf'})}),upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://audit.test/signed'}})}),updateBucket:async()=>{bucketUpdates++;return{};}},
    from:()=>{const builder={update:patch=>{writes.push(patch);state={...state,...patch};return builder;},eq:()=>builder,select:async()=>({data:[{id:'message'}]})};return builder;}};
  const manifest={messages:[{original,attachments:paths,updated:null}],retired:false};
  await migrateManifest(db,manifest,async()=>{});assert.equal(state.metadata.file_bucket,'chat-private-attachments');
  await rollbackManifest(db,manifest,async()=>{});assert.equal(state.content,original.content);assert.equal(bucketUpdates,0);assert.equal(writes.length,2);
});
