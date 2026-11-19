import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, Set, Number, require: name => {
    if (name in imports) return imports[name];
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

const repairs = JSON.parse(read('apps/storefront/lib/catalog-image-repairs.json'));
const variants = JSON.parse(read('apps/storefront/lib/catalog-image-manifest.json'));
const helper = load('apps/storefront/lib/catalogImageRepairs.ts', { './catalog-image-repairs.json': { default: repairs } });

test('all six missing URLs resolve to a verified existing same-group photo with prebuilt variants', () => {
  assert.equal(Object.keys(repairs).length, 6);
  for (const [original, repair] of Object.entries(repairs)) {
    assert.equal(helper.resolveCatalogImageUrl(original), repair.replacement);
    assert.ok(repair.replacement.includes(`/product-groups/${repair.groupId}-`));
    assert.ok(variants[repair.replacement]?.sources.length > 0);
    assert.ok(repair.verifiedProduct);
  }
});

test('repairs preserve source arrays, remove duplicate display URLs and leave signed/unknown inputs untouched', () => {
  const [original, repair] = Object.entries(repairs)[0];
  const saved = Object.freeze([original, repair.replacement, 'https://example.com/unknown.jpg']);
  assert.deepEqual([...helper.resolveCatalogImageUrls(saved)], [repair.replacement, saved[2]]);
  assert.equal(saved[0], original);
  for (const url of [`${original}?token=private`, `${original}#fragment`, 'https://example.com/unknown.jpg', '__proto__']) {
    assert.equal(helper.resolveCatalogImageUrl(url), url);
  }
  assert.equal(helper.resolveCatalogImageUrls(null), null);
  assert.ok(read('apps/storefront/lib/products.ts').includes('images: resolveCatalogImageUrls(product.images)'));
});

function categoryFixture() {
  const products = Array.from({ length: 67 }, (_, index) => ({ id: `${index}`, sku: `SKU${index}`, name_th: `สินค้า ${String(index).padStart(3, '0')}`, images: [], category_slug: 'abrasives', group_id: null, price: 10, in_stock: true }));
  const notFound = () => { throw new Error('NOT_FOUND'); };
  const page = load('apps/storefront/app/c/[slug]/page.tsx', {
    'next/link': { default: ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children) },
    'next/navigation': { notFound },
    '@/lib/products': {
      getCategories: async () => [{ slug: 'abrasives', name_th: 'ขัด ตัด เจียร' }],
      getProductsByCategory: async () => products,
      getGroups: async () => [], imagesOf: p => p.images,
      keywordsFromProducts: () => [], collectionArticle: () => ({}),
    },
    '@/lib/categoryCatalog': { getCategoryCatalog: async () => ({ products, categories: [{ slug: 'abrasives', name_th: 'ขัด ตัด เจียร' }], groups: [], org: { business_name: 'J NAC' } }) },
    '@/lib/seo': { compactSeoTitle: t => t, getOrg: async () => ({ business_name: 'J NAC' }), ld: () => ({ __html: '{}' }), itemListLd: () => ({}), breadcrumbLd: () => ({}), SHOP: 'https://www.jnac.online', categoryUrl: slug => `https://www.jnac.online/c/${slug}` },
    '@/lib/format': { effectivePrice: p => p.price },
    '@/components/CollectionArticle': { default: () => null },
    '@/components/SearchBox': { default: () => null },
    '@/components/ui': { ProductCard: ({ p }) => React.createElement('span', { 'data-sku': p.sku }, p.name_th), GroupCard: () => null, Breadcrumb: () => null },
  });
  return page;
}

test('category is request-rendered and page two retains correct cards, metadata and canonical', async () => {
  const page = categoryFixture();
  assert.equal(page.dynamic, 'auto');
  assert.equal(page.generateStaticParams, undefined);
  const args = { params: Promise.resolve({ slug: 'abrasives' }), searchParams: Promise.resolve({ page: '2' }) };
  const html = renderToStaticMarkup(await page.default(args));
  assert.equal((html.match(/data-sku=/g) ?? []).length, 30);
  assert.ok(html.includes('data-sku="SKU30"'));
  assert.ok(html.includes('data-sku="SKU59"'));
  assert.ok(!html.includes('data-sku="SKU0"'));
  assert.ok(html.includes('href="/c/abrasives?page=3"'));
  const meta = await page.generateMetadata(args);
  assert.equal(meta.alternates.canonical, '/c/abrasives?page=2');
  assert.ok(meta.title.includes('หน้า 2'));
});

test('invalid categories and out-of-range pages remain real not-found responses', async () => {
  const page = categoryFixture();
  await assert.rejects(page.default({ params: Promise.resolve({ slug: 'unknown' }), searchParams: Promise.resolve({}) }), /NOT_FOUND/);
  await assert.rejects(page.default({ params: Promise.resolve({ slug: 'abrasives' }), searchParams: Promise.resolve({ page: '999' }) }), /NOT_FOUND/);
});
