import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = name => readFileSync(new URL(`../apps/storefront/${name}`, import.meta.url), 'utf8');
function load(name, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(source(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, Set, Number, Request, AbortSignal, DOMException, ...globals, require: key => {
    if (key in imports) return imports[key];
    throw new Error(`Unexpected import ${key}`);
  } });
  return exports;
}

function productReader(rows) {
  const calls = [];
  const db = { from() { return {
    select() { return this; },
    eq(field, value) { calls.push(['eq', field, value]); this.exact = value; return this; },
    maybeSingle: async function() { return { data: rows.find(p => p.sku === this.exact) ?? null }; },
    like(field, value) { calls.push(['like', field, value]); return this; },
    order() { return this; }, range: async () => ({ data: rows }),
  }; } };
  const reader = load('lib/products.ts', { './supabase': { supabase: db }, './format': {}, './catalogImageRepairs': { resolveCatalogImageUrls: images => images } });
  return { ...reader, calls };
}

test('both live whitespace-prefixed SKUs resolve; exact SKU remains preferred and substring collisions fail closed', async () => {
  for (const sku of ['2020001014', '2020001015']) {
    const stored = { sku: ` ${sku}`, name_th: 'SA331', images: [], spec: null };
    const reader = productReader([{ ...stored, sku: `${sku}0` }, stored]);
    assert.equal((await reader.getProductBySku(sku)).sku, stored.sku);
    assert.equal(reader.calls[1][2], `%${sku}%`);
    assert.equal(await reader.getProductBySku('MISSING'), null);
  }
  const reader = productReader([{ sku:'A_10%', images:[], spec:null }]);
  assert.equal((await reader.getProductBySku('A_10%')).sku, 'A_10%');
  assert.equal(reader.calls.length, 1);
  await reader.getProductBySku('X_10%');
  assert.equal(reader.calls.at(-1)[2], '%X\\_10\\%%');
});

test('category snapshot shares public reads across all slugs for 300 seconds; errors are not cached as empty stock', async () => {
  let options, key, reads=0, fail=false;
  const products=[{sku:'1',category_slug:'abrasives'}];
  const read=async value=>{reads++;if(fail)throw new Error('offline');return value;};
  let cached;
  const module=load('lib/categoryCatalog.ts', {
    'next/cache': { unstable_cache(fn, keys, config) { key=keys;options=config;return async()=>{if(cached)return cached;const value=await fn();cached=value;return value;}; } },
    './products': {getAllProducts:()=>read(products),getCategories:()=>read([]),getGroups:()=>read([]),getPublicProductOrder:()=>read([])},
    './seo': {getOrg:()=>read({business_name:'J NAC'})},
  });
  fail=true;await assert.rejects(module.getCategoryCatalog(),/offline/);
  fail=false;const one=await module.getCategoryCatalog(), before=reads;
  assert.equal((await module.getCategoryCatalog()).products,one.products);
  assert.equal(reads,before);assert.equal(options.revalidate,300);assert.ok(key[0].includes('category-catalog'));
});

test('public client uses the SDK request deadline without retry amplification or authenticated-client changes', () => {
  let received;
  load('lib/supabase.ts', { '@supabase/supabase-js': { createClient(_url,_key,options) { received=options;return {}; } } }, { process:{env:{}} });
  assert.equal(received.db.timeout,10000);
  assert.equal(received.db.retry,false);
  assert.equal(received.auth.persistSession,false);
  assert.ok(!source('lib/supabase-browser.ts').includes('timeout: 10000'));
});
