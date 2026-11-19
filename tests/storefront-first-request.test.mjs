import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source=path=>readFileSync(new URL(`../apps/storefront/${path}`,import.meta.url),'utf8');
function load(path,imports,extra={}) {
  const exports={};
  const code=ts.transpileModule(source(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(code,{exports,...extra,require:key=>{if(key in imports)return imports[key];throw new Error(`Unexpected import ${key}`);}});
  return exports;
}
function requestCache(fn){const memo=new Map();return(...args)=>{const key=JSON.stringify(args);if(!memo.has(key))memo.set(key,fn(...args));return memo.get(key);};}
const normalizeSku=sku=>sku.normalize('NFKC').replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g,'');

test('first detail renders read only their SKU/group and deduplicate metadata/page requests',async()=>{
  const group='a9332562-fe24-4f69-965a-b6c9514af844',calls=[];
  const products=[{id:'c',sku:'EXACT',group_id:group},{id:'a',sku:' EXACT',group_id:group}];
  const lookup=load('lib/catalogPages.ts',{
    react:{cache:requestCache},
    './products':{normalizeSku,
      getProductBySku:async sku=>{calls.push(['product',sku]);return sku==='2020001014'?{id:'b',sku:' 2020001014'}:null;},
      getGroupById:async id=>{calls.push(['group',id]);return{id,name:'SA331'};},
      getProductsByGroup:async id=>{calls.push(['products',id]);return products;},
    },
  });
  const [one,two]=await Promise.all([lookup.getCatalogProductBySku(' 2020001014 '),lookup.getCatalogProductBySku('2020001014')]);
  assert.equal(one.id,'b');assert.equal(one,two);
  assert.equal(await lookup.getCatalogProductBySku('202000101'),null);
  assert.equal((await lookup.getCatalogGroupById(group.toUpperCase())).id,group);
  await lookup.getCatalogGroupById(group);
  assert.equal(await lookup.getCatalogProductsByGroup(group.toUpperCase()),products);
  await lookup.getCatalogProductsByGroup(group);
  assert.equal(await lookup.getCatalogGroupById('not-a-real-group'),null);
  assert.equal((await lookup.getCatalogProductsByGroup('not-a-real-group')).length,0);
  assert.deepEqual(calls,[['product','2020001014'],['product','202000101'],['group',group],['products',group]]);
  assert.deepEqual(products.map(p=>p.id),['c','a'],'retain DB collation/order, do not sort in JavaScript');
  assert.ok(!source('lib/catalogPages.ts').includes('unstable_cache'),'ISR already caches detail HTML; avoid extra persistent per-SKU cache IO');
  assert.ok(!source('lib/catalogPages.ts').includes('categoryCatalog'));
  assert.ok(!source('lib/products.ts').includes('getPublicProductOrder'));
});

test('bounded lookup propagates upstream failures and a later render retries the origin',async()=>{
  let fail=true,reads=0;
  const read=async()=>{reads++;if(fail)throw new Error('catalog_unavailable');return{sku:'REAL'};};
  const lookup=load('lib/catalogPages.ts',{
    react:{cache:fn=>fn},
    './products':{normalizeSku,getProductBySku:read,getGroupById:read,getProductsByGroup:read},
  });
  assert.equal(await lookup.getCatalogProductBySku('   '),null);
  await assert.rejects(lookup.getCatalogProductBySku('REAL'),/catalog_unavailable/);
  await assert.rejects(lookup.getCatalogProductsByGroup('a9332562-fe24-4f69-965a-b6c9514af844'),/catalog_unavailable/);
  fail=false;assert.equal((await lookup.getCatalogProductBySku('REAL')).sku,'REAL');
  const before=reads;await lookup.getCatalogProductBySku('REAL');assert.equal(reads,before+1,'new render reads fresh data; no second persistent cache expiry');
});

test('public company identity is cached 300s and failed reads do not poison the shared entry with fallback data',async()=>{
  let reads=0,fail=true,cached,options,selected;
  const db={from:()=>({select(value){selected=value;return this;},limit(){return this;},maybeSingle:async()=>{reads++;return fail?{error:{message:'offline'}}:{data:{business_name:'Verified J NAC',phone:'02-test'}};}})};
  const seo=load('lib/seo.ts',{
    './supabase':{supabase:db},'./format':{},'./products':{normalizeSku},react:{cache:fn=>fn},
    'next/cache':{unstable_cache(fn,keys,config){options=config;assert.deepEqual([...keys],['storefront-org-v1']);return async()=>{if(cached)return cached;const value=await fn();cached=value;return value;};}},
  });
  assert.equal((await seo.getOrg()).business_name,'บริษัท เจ แนค (ประเทศไทย) จำกัด');
  assert.equal(cached,undefined);
  fail=false;assert.equal((await seo.getOrg()).business_name,'Verified J NAC');
  const before=reads;assert.equal((await seo.getOrg()).phone,'02-test');assert.equal(reads,before);
  assert.equal(options.revalidate,300);assert.deepEqual([...options.tags],['storefront-org']);
  assert.equal(selected,'business_name,address,tax_id,phone,email,website,logo_url');
});

test('protected revalidation expires both shared data tags only after the existing secret check',async()=>{
  for(const [secret,supplied,expected] of [[undefined,'x',503],['fixture-secret','wrong',401],['fixture-secret','fixture-secret',200]]) {
    const calls=[];
    const route=load('app/api/revalidate/route.ts',{
      'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
      'next/cache':{revalidatePath:(...args)=>calls.push(['path',...args]),revalidateTag:(...args)=>calls.push(['tag',...args])},
    },{process:{env:{REVALIDATE_SECRET:secret}}});
    const response=await route.POST({nextUrl:new URL('https://fixture.test/api/revalidate'),headers:new Headers({'x-revalidate-secret':supplied})});
    assert.equal(response.status,expected);
    if(expected!==200)assert.equal(calls.length,0);
    else {assert.equal(calls[0][1],'/');assert.deepEqual(calls.slice(1).map(x=>x[1]),['storefront-public-catalog','storefront-org']);assert.ok(calls.slice(1).every(x=>x[2].expire===0));}
  }
});

test('product/group detail routes retain bounded ISR builds and use cached server lookup; images are unchanged',()=>{
  const product=source('app/p/[sku]/page.tsx'),group=source('app/g/[id]/page.tsx');
  for(const code of [product,group]){assert.ok(code.includes('@/lib/catalogPages'));assert.ok(code.includes('export const revalidate = 300'));assert.ok(code.includes('return [];'));}
  assert.ok(product.includes('variant={catalogImageVariant(imgs[0])}'));
  assert.ok(group.includes('card_image: catalogImageVariant(product.images?.[0])'));
});

test('independent company, product and group data starts in parallel, not a serial page waterfall',()=>{
  const product=source('app/p/[sku]/page.tsx'),group=source('app/g/[id]/page.tsx');
  assert.equal(product.split('Promise.all([getProductBySku(decodeURIComponent(sku)), getOrg()])').length-1,2);
  assert.ok(group.includes('Promise.all([getGroupById(groupId), getProductsByGroup(groupId)])'));
  assert.ok(group.includes('Promise.all([getGroupById(groupId), getProductsByGroup(groupId), getOrg()])'));
});
