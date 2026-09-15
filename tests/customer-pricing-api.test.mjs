import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../frontend/src/lib/customer-pricing-api.ts', import.meta.url), 'utf8');
const cache = readFileSync(new URL('../frontend/src/lib/cache.ts', import.meta.url), 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('customer net-price rule contracts contain no quantity field', () => {
  const rule = between(api, 'export interface CustomerNetPriceRule {', 'export interface CustomerPricingProduct {');
  const input = between(api, 'export interface CustomerNetPriceRuleInput {', 'function asNumber');

  assert.doesNotMatch(rule, /\bquantity\s*:/);
  assert.doesNotMatch(input, /\bquantity\s*:/);
  assert.match(rule, /unit:\s*string/);
  assert.match(input, /unit:\s*string/);
});

test('staff listing uses only the sanitised customer-scoped RPC', () => {
  const list = between(api, 'async listRules(customerId: string)', 'async searchProducts(');

  assert.match(list, /list_customer_product_net_prices/);
  assert.match(list, /p_customer_id:\s*customerId/);
  assert.match(list, /min_order_qty/);
  assert.doesNotMatch(list, /\.from\(['"]customer_product_net_prices['"]\)/);
  assert.doesNotMatch(list, /created_by|updated_by|external|payload/i);
});

test('product lookup stays server-side, bounded, and avoids inventory or cost data', () => {
  const search = between(api, 'async searchProducts(term: string, limit = 20)', 'async resolvePrices(');
  const selected = search.match(/\.select\('([^']+)'\)/)?.[1] ?? '';

  assert.equal(
    selected,
    'id,sku,name_th,name_en,unit,min_order_qty,price,discount_type,discount_value,updated_at',
  );
  assert.match(search, /query\.length < 2/);
  assert.match(search, /Math\.min\(30,/);
  assert.match(search, /\.limit\(safeLimit\)/);
  assert.doesNotMatch(selected, /cost|margin|inventory|warehouse|(?:^|,)quantity(?:,|$)/i);
  assert.doesNotMatch(search, /productsApi\.list\(/);
});

test('price preview calls the authoritative set-based resolver', () => {
  const resolve = between(api, 'async resolvePrices(', 'async createRule(');

  assert.match(resolve, /resolve_customer_quote_prices/);
  assert.match(resolve, /p_customer_id:\s*customerId/);
  assert.match(resolve, /p_items:\s*items/);
  assert.match(resolve, /items\.length === 0/);
});

test('owner/admin writes are scoped and expiry is an auditable soft disable', () => {
  const writes = api.slice(api.indexOf('async createRule('));
  const expire = between(writes, 'async expireRule(', '\n  },\n};');

  assert.match(writes, /\.from\(['"]customer_product_net_prices['"]\)/);
  assert.match(writes, /\.eq\(['"]id['"],\s*ruleId\)/);
  assert.match(writes, /\.eq\(['"]customer_id['"],\s*customerId\)/);
  assert.match(expire, /active:\s*false/);
  assert.doesNotMatch(expire, /valid_until|\.delete\(/);
});

test('pricing cache is scoped to one selected customer', () => {
  assert.match(cache, /customerPricing:\s*\(customerId:\s*string\)\s*=>\s*`customer-pricing:\$\{customerId\}`/);
});
