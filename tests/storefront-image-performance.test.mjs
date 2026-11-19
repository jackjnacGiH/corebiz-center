import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('apps/storefront/lib/catalog-image-manifest.json', root), 'utf8'));
const source = path => readFileSync(new URL(path, root), 'utf8');
function load(path, imports) {
  const exports = {};
  const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: name => {
    if (name in imports) return imports[name];
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected import ${name}`);
  } });
  return exports;
}
const Image = load('apps/storefront/components/CatalogImage.tsx', {}).default;
const [original, variant] = Object.entries(manifest)[0] ?? [];

test('prebuilt image variants all exist, decode as WebP and never upscale originals', async () => {
  assert.ok(Object.keys(manifest).length > 0, 'run the image preparation script before release');
  for (const [url, entry] of Object.entries(manifest)) {
    assert.match(url, /^https:\/\/owoedccmuqnzdtxvywgt\.supabase\.co\/storage\/v1\/object\/public\/(products|product-groups)\//);
    assert.ok(!url.includes('?'));
    assert.ok(entry.sources.length > 0);
    let previousWidth = 0;
    for (const image of entry.sources) {
      assert.match(image.src, /^\/catalog-images\/[a-f0-9]{24}-\d+\.webp$/);
      const file = new URL(`apps/storefront/public${image.src}`, root);
      assert.ok(existsSync(file), image.src);
      const bytes = readFileSync(file);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, image.width);
      assert.equal(bytes.length, image.bytes);
      assert.ok(image.width <= entry.width);
      assert.ok(image.width > previousWidth);
      previousWidth = image.width;
    }
  }
});

test('static responsive image has correct alt, dimensions, srcset and first-row priority', () => {
  const html = renderToStaticMarkup(React.createElement(Image, { src: original, variant, alt: 'รูปสินค้าจริง', priority: true }));
  assert.ok(html.includes('alt="รูปสินค้าจริง"'));
  assert.ok(html.includes('loading="eager"'));
  assert.ok(html.includes('fetchPriority="high"'));
  assert.ok(html.includes('srcSet='));
  assert.ok(html.includes(variant.sources[0].src));
  assert.ok(!html.includes('/_next/image'));
  assert.ok(html.includes(`width="${variant.width}"`));
});

test('unknown, newly uploaded and signed images keep the original URL and use lazy loading', () => {
  for (const src of ['https://example.com/photo.jpg', 'https://owoedccmuqnzdtxvywgt.supabase.co/storage/v1/object/public/products/new.jpg', `${original}?token=private`]) {
    const html = renderToStaticMarkup(React.createElement(Image, { src, alt: 'ต้นฉบับ' }));
    assert.ok(html.includes(`src="${src}"`));
    assert.ok(!html.includes('srcSet='));
    assert.ok(html.includes('loading="lazy"'));
  }
});

test('failed variants fall back to the untouched original; failed originals show an accessible message', () => {
  const state = [];
  let cursor = 0;
  const StatefulImage = load('apps/storefront/components/CatalogImage.tsx', {
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    } },
  }).default;
  const render = () => { cursor = 0; return StatefulImage({ src: original, variant, alt: 'สินค้าจริง' }); };
  const image = render();
  assert.match(image.props.src, /^\/catalog-images\//);
  image.props.onError();
  const fallback = render();
  assert.equal(fallback.props.src, original);
  assert.equal(fallback.props.srcSet, undefined);
  fallback.props.onError();
  const message = render();
  assert.equal(message.props.role, 'img');
  assert.equal(message.props['aria-label'], 'สินค้าจริง');
  assert.equal(message.props.children, 'ไม่สามารถโหลดรูปได้');
});

test('all product view modes share static variants and lists initially render at most 30 items', () => {
  const Views = load('apps/storefront/components/ProductViews.tsx', {
    'next/link': { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
    '@/components/CatalogImage': { default: Image },
    '@/components/cart/CartProvider': { useCart: () => ({ add() {} }) },
    '@/lib/format': { effectivePrice: p => p.price, formatTHB: n => `฿${n}` },
  }).default;
  const products = Array.from({ length: 45 }, (_, index) => ({ id: `${index}`, sku: `SKU-${index}`, name_th: `สินค้า ${index}`, images: [original], card_image: variant, price: 20, unit: 'ชิ้น', in_stock: true, stock_qty: 1 }));
  const html = renderToStaticMarkup(React.createElement(Views, { products }));
  assert.equal((html.match(/<img /g) ?? []).length, 30);
  assert.equal((html.match(/loading="eager"/g) ?? []).length, 5);
  assert.equal((html.match(/loading="lazy"/g) ?? []).length, 25);
  assert.ok(html.includes('โหลดสินค้าเพิ่ม'));
  assert.ok(!html.includes('href="/p/SKU-30"'));
  const code = source('apps/storefront/components/ProductViews.tsx');
  assert.equal((code.match(/<CatalogImage /g) ?? []).length, 4);
  assert.ok(!code.includes('<img '));
});

test('server manifest selection is exact and product detail keeps original image links', () => {
  const helper = load('apps/storefront/lib/catalogImages.ts', { './catalog-image-manifest.json': { default: manifest } });
  assert.deepEqual(helper.catalogImageVariant(original), variant);
  assert.equal(helper.catalogImageVariant(`${original}?token=private`), undefined);
  assert.equal(helper.catalogImageVariant('https://example.com/photo.jpg'), undefined);
  assert.equal(helper.catalogImageVariant(null), undefined);
  const detail = source('apps/storefront/app/p/[sku]/page.tsx');
  assert.ok(detail.includes('href={imgs[0]}'));
  assert.ok(detail.includes('เปิดรูปต้นฉบับ'));
  assert.ok(detail.includes('variant={catalogImageVariant(imgs[0])}'));
  const config = source('apps/storefront/next.config.ts');
  assert.ok(config.includes('source: "/catalog-images/:path*"'));
  assert.ok(config.includes('max-age=31536000, immutable'));
});

test('catalog load-more keeps the initial HTML to 30 cards without making the catalog dynamic', () => {
  const Grid = load('apps/storefront/components/CatalogGrid.tsx', {}).default;
  const children = Array.from({ length: 79 }, (_, index) => React.createElement('span', { key: index, 'data-card': index }, `Card ${index}`));
  const html = renderToStaticMarkup(React.createElement(Grid, null, children));
  assert.equal((html.match(/data-card=/g) ?? []).length, 30);
  assert.ok(html.includes('โหลดรายการเพิ่ม'));
  const catalog = source('apps/storefront/app/products/page.tsx');
  assert.ok(!catalog.includes('searchParams'));
  assert.ok(catalog.includes('export const revalidate = 300'));
});
