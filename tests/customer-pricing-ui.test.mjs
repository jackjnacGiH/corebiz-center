import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = readFileSync(new URL('../frontend/src/components/CustomerProfile.tsx', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('../frontend/src/components/customer-pricing/CustomerPricingSection.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../frontend/src/i18n.ts', import.meta.url), 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('customer pricing is a lazy section inside the selected profile', () => {
  assert.match(profile, /const CustomerPricingSection = lazy\(\(\) => import\('\.\/customer-pricing\/CustomerPricingSection'\)\)/);
  assert.match(profile, /pricingOpen\s*&&[\s\S]*?<Suspense[\s\S]*?<CustomerPricingSection customer=\{c\}/);
  assert.match(profile, /onClick=\{\(\) => setPricingOpen\(true\)\}/);

  const profileBundle = between(api, 'export const customerProfileApi = {', '// Loyalty points');
  assert.doesNotMatch(profileBundle, /customer_product_net_prices|resolve_customer_quote_prices|list_customer_product_net_prices/);
});

test('opening CRM or Shipping cannot start a full product preload for pricing', () => {
  assert.doesNotMatch(profile, /customerPricingApi|productsApi/);
  assert.doesNotMatch(pricing, /productsApi\.list\(|CK\.products|prefetchList/);
  assert.match(pricing, /customerPricingApi\.searchProducts\(productQuery\)/);
  assert.match(pricing, /window\.setTimeout\([\s\S]*?\},\s*250\)/);
  assert.match(pricing, /searchVersion\.current === version/);
});

test('pricing preview splits large rule sets and resolves at most three batches concurrently', () => {
  assert.match(pricing, /const PRICE_RESOLUTION_BATCH_SIZE = 100/);
  assert.match(pricing, /const PRICE_RESOLUTION_CONCURRENCY = 3/);
  const batching = between(pricing, 'async function resolvePriceBatches(', '\nasync function fetchPricing(');
  assert.match(batching, /start \+= PRICE_RESOLUTION_BATCH_SIZE/);
  assert.match(batching, /items\.slice\(start, start \+ PRICE_RESOLUTION_BATCH_SIZE\)/);
  assert.match(batching, /new Array<ResolvedCustomerPrice\[]>\(batches\.length\)/);
  assert.match(batching, /results\[batchIndex\] = await customerPricingApi\.resolvePrices\(customerId, batches\[batchIndex\]\)/);
  assert.match(batching, /Math\.min\(PRICE_RESOLUTION_CONCURRENCY, batches\.length\)/);
  assert.match(batching, /await Promise\.all\(Array\.from\(/);
  assert.doesNotMatch(batching, /Promise\.all\([\s\S]*batches\.map/);
  assert.match(batching, /return results\.flat\(\)/);

  const fetch = between(pricing, 'async function fetchPricing(', '\nfunction newEditor(');
  assert.match(fetch, /resolvePriceBatches\(customerId, distinctItems\)/);
  assert.doesNotMatch(fetch, /customerPricingApi\.resolvePrices\(customerId, distinctItems\)/);
});

test('permissions keep staff read-only while owner/admin controls are gated', () => {
  assert.match(pricing, /const canManage = isAdminOrOwner\(profile\?\.role\)/);
  assert.match(pricing, /!canManage\s*&&[\s\S]*?words\.readOnly/);
  assert.match(pricing, /\{canManage && \(/);
  assert.match(pricing, /editor && canManage/);
  assert.match(pricing, /customerPricingApi\.createRule/);
  assert.match(pricing, /customerPricingApi\.updateRule/);
  assert.match(pricing, /customerPricingApi\.expireRule/);
});

test('manual rules are per SKU and canonical unit, with no quantity control', () => {
  assert.match(pricing, /quantity:\s*Math\.max\(1, Math\.floor\(Number\(rule\.min_order_qty\) \|\| 1\)\)/);
  assert.match(pricing, /editor\.product\.unit/);
  assert.doesNotMatch(pricing, /customer-price-(?:quantity|unit)/);
  assert.doesNotMatch(pricing, /words\.quantity|setQuantity|quantity:\s*Number\(editor/);
});

test('expiry uses inline confirmation and never exposes a destructive delete', () => {
  assert.match(pricing, /expireConfirmId === rule\.id/);
  assert.match(pricing, /words\.expireQuestion/);
  assert.match(pricing, /showExpired \? rows : rows\.filter\(\(rule\) => rule\.active\)/);
  assert.match(pricing, /words\.statusExpiredActive/);
  assert.match(pricing, /canManage && rule\.active/);
  assert.doesNotMatch(pricing, /canManage && status !== ['"]expired['"]/);
  assert.doesNotMatch(pricing, /window\.confirm|customerPricingApi\.delete|\.delete\(/);
});

test('phase-one UI contains no FlowAccount status or private cache details', () => {
  assert.doesNotMatch(pricing, /FlowAccount|flowaccount|cache status|sync status/i);
  assert.match(pricing, /words\.priceNet/);
  assert.match(pricing, /words\.priceTier/);
  assert.match(pricing, /words\.priceBase/);
});

test('pricing cards and editor remain usable on a narrow mobile screen', () => {
  assert.match(pricing, /grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.match(pricing, /grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.match(pricing, /flex flex-col-reverse gap-2 sm:flex-row/);
  assert.match(pricing, /className="h-10/);
  assert.doesNotMatch(pricing, /<table|overflow-x-auto/);
});

test('new pricing controls have both Thai and English labels', () => {
  assert.equal((i18n.match(/reload:\s*'[^']+'/g) ?? []).length, 2);
  assert.equal((i18n.match(/loading:\s*'[^']+'/g) ?? []).length >= 2, true);
  assert.match(i18n, /priority:\s*'ราคาเน็ตจะแทนราคา Tier/);
  assert.match(i18n, /priority:\s*'A customer net price replaces the Tier price/);
});
