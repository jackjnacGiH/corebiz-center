import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL(`../apps/storefront/${p}`,import.meta.url),'utf8');
const normalizeSku=s=>s.normalize('NFKC').trim();
function fixture({phase='phase-production-build',fail=false,products,groups}={}){
  const id='a9332562-fe24-4f69-965a-b6c9514af844',calls={products:0,groups:0,detail:0};
  products??=Array.from({length:730},(_,i)=>({id:String(i),sku:`SKU${i}`,group_id:id}));groups??=[{id,name:'public group'}];
  const exports={};
  runInNewContext(ts.transpileModule(read('lib/buildCatalog.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Map,Set,console:{info(){}},process:{env:{NEXT_PHASE:phase}},require:key=>{
      if(key==='next/constants')return{PHASE_PRODUCTION_BUILD:'phase-production-build'};
      if(key==='./products')return{normalizeSku,getPrerenderProducts:async()=>{calls.products++;if(fail)throw new Error('catalog_unavailable');return products;},getGroups:async()=>{calls.groups++;return groups;},getProductBySku:async sku=>{calls.detail++;return{sku,id:'DB legacy precedence'};}};
      throw new Error(key);
    },
  });return{...exports,calls,id};
}
test('730 product renders plus metadata and groups share one bulk read per build worker',async()=>{
  const f=fixture();const [p,g]=await Promise.all([f.getPrerenderProductParams(),f.getPrerenderGroupParams()]);
  assert.equal(p.length,730);assert.equal(g.length,1);
  await Promise.all(p.flatMap(({sku})=>[f.getBuildProduct(sku),f.getBuildProduct(sku)]));
  assert.equal((await f.getBuildGroupProducts(f.id)).length,730);
  assert.deepEqual(f.calls,{products:1,groups:1,detail:0});
});
test('build snapshot retains exact-SKU precedence, legacy whitespace, stable DB group order and deduplicated params',async()=>{
  const id='a9332562-fe24-4f69-965a-b6c9514af844';
  const products=[{id:'c',sku:' EXACT',group_id:id},{id:'a',sku:'EXACT',group_id:id},{id:'b',sku:' 2020001014',group_id:id},{id:'x',sku:'',group_id:null}];
  const f=fixture({products,groups:[{id,name:'group'}]});
  assert.equal((await f.getBuildProduct('EXACT')).id,'a');
  assert.equal((await f.getBuildProduct('2020001014')).id,'b');
  assert.equal(await f.getBuildProduct('202000101'),null);
  assert.deepEqual(Array.from(await f.getPrerenderProductParams(),x=>x.sku),['EXACT','2020001014']);
  const list=await f.getBuildGroupProducts(id);assert.deepEqual(Array.from(list,x=>x.id),['c','a','b']);
  list.reverse();assert.deepEqual(Array.from(await f.getBuildGroupProducts(id),x=>x.id),['c','a','b']);
  assert.equal(await f.getBuildGroup('missing'),null);assert.equal((await f.getBuildGroupProducts('missing')).length,0);
  assert.equal(f.calls.detail,0);
});
test('ambiguous legacy normalized SKU delegates to the existing database precedence',async()=>{
  const f=fixture({products:[{id:'a',sku:' AMBIG'},{id:'b',sku:'AMBIG '}],groups:[]});
  assert.equal((await f.getBuildProduct('AMBIG')).id,'DB legacy precedence');assert.equal(f.calls.detail,1);
});
test('runtime ISR and development never initialize or reuse build snapshot',async()=>{
  for(const phase of [undefined,'phase-production-server','phase-development-server']){
    const f=fixture({phase:phase??''});assert.equal(f.isCatalogBuild(),false);
    assert.equal((await f.getPrerenderProductParams()).length,0);assert.equal((await f.getPrerenderGroupParams()).length,0);
    await assert.rejects(f.getBuildProduct('SKU1'),/build_catalog_unavailable_at_runtime/);
    assert.deepEqual(f.calls,{products:0,groups:0,detail:0});
  }
});
test('failed bulk snapshot fails the build, not one origin retry per SKU',async()=>{
  const f=fixture({fail:true});await assert.rejects(f.getPrerenderProductParams(),/catalog_unavailable/);
  await assert.rejects(f.getBuildProduct('SKU1'),/catalog_unavailable/);
  assert.deepEqual(f.calls,{products:1,groups:1,detail:0});
});
test('build product reader paginates, sanitizes and preserves database name/id collation',()=>{
  const body=read('lib/products.ts').split('export async function getPrerenderProducts()')[1].split('export async function getProductBySku')[0];
  assert.ok(body.includes('readAll<SProduct>'));assert.ok(body.includes('.order("name_th").order("id")'));assert.ok(body.includes('.map(sanitizePublicProduct)'));
});
