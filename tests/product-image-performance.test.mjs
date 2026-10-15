import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { optimizeProductImage } from '../frontend/src/lib/optimize-product-image.ts';

test('new product images retain good resolution/quality, never upscale and keep the original on encoder failure', async () => {
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let closes = 0, quality, width, height, resultSize = 50_000;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 4000, height: 2000, close() { closes++; } }) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    getContext: () => ({ drawImage(_bitmap, _x, _y, w, h) { width = w; height = h; } }),
    toBlob(resolve, type, q) { quality = q; resolve(new Blob([new Uint8Array(resultSize)], { type })); },
  }) } });
  try {
    const original = new File([new Uint8Array(300_000)], 'product.jpg', { type: 'image/jpeg' });
    const result = await optimizeProductImage(original);
    assert.equal(result.type, 'image/webp'); assert.equal(result.name, 'product.webp');
    assert.equal(width, 1920); assert.equal(height, 960); assert.equal(quality, 0.9); assert.equal(closes, 1);
    resultSize = 299_999; assert.strictEqual(await optimizeProductImage(original), original);
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { throw new Error('unsupported'); } });
    assert.strictEqual(await optimizeProductImage(original), original);
    for (const type of ['image/gif', 'image/webp']) {
      const animated = new File([new Uint8Array(300_000)], 'animated', { type });
      assert.strictEqual(await optimizeProductImage(animated), animated);
    }
    const small = new File([new Uint8Array(1000)], 'small.jpg', { type: 'image/jpeg' });
    assert.strictEqual(await optimizeProductImage(small), small);
  } finally {
    if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor); else delete globalThis.createImageBitmap;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else delete globalThis.document;
  }
});

const variants = JSON.parse(readFileSync(new URL('../frontend/src/lib/product-image-variants.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../frontend/src/lib/product-list-image.ts', import.meta.url), 'utf8');
const exports = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, URL, require: () => ({ default: variants }) });
test('only existing public product variants are used; unknown URLs, private/signed images and logos retain originals', () => {
  const origin = 'https://owoedccmuqnzdtxvywgt.supabase.co';
  const prefix = `${origin}/storage/v1/object/public/products/`;
  const [path, variant] = Object.entries(variants)[0];
  assert.equal(exports.productListImage(prefix + path), prefix + variant);
  for (const url of [prefix + 'new-product.jpg', prefix + 'org/logo.jpg', prefix + path + '?token=signed', 'https://example.com/image.jpg', 'bad url']) {
    assert.equal(exports.productListImage(url), url);
  }
});
