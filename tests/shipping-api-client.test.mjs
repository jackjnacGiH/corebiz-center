import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { emptyDraft, isShippingDraftFieldIssue } from '../supabase/functions/_shared/shipping-domain.ts';
import * as listCache from '../frontend/src/lib/cache.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../frontend/src/lib/shipping-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('shipping client preserves a restored shipment carried by a rejected function response', async () => {
  const restored = {
    id: '00000000-0000-4000-8000-000000000001', reference_no: 'SHP-1',
    draft: emptyDraft(), status: 'draft', tracking_number: null, version: 9,
    created_at: '2026-09-10T00:00:00Z',
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { functions: { invoke: async () => ({
        data: null,
        error: { context: { json: async () => ({ error: 'provider_rejected', detail: 'invalid_phone', shipment: restored }) } },
      }) } } };
      if (name.endsWith('/shipping-errors')) return {
        isShippingProviderIssue: value => [
          'invalid_phone', 'box_dimension_exceeded', 'invalid_box_weight',
          'invalid_address', 'invalid_postcode', 'wallet_insufficient',
          'carrier_service_unavailable', 'provider_authentication_failed',
          'provider_rate_limited', 'provider_validation_failed',
        ].includes(value),
      };
      if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
      if (name === './cache') return {
        CK: { shippingInitial: 'shipping:initial' }, invalidateList() {}, invalidateListPrefix() {},
        swrList: (_key, fetcher) => fetcher(),
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  await assert.rejects(
    exports.shippingApi.action('submit', { id: restored.id, version: 7 }),
    error => {
      assert.equal(error.message, 'provider_rejected');
      assert.equal(error.detail, 'invalid_phone');
      assert.deepEqual(error.shipment, restored);
      return true;
    },
  );
});

test('shipping client drops unknown backend details instead of displaying arbitrary text', async () => {
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { functions: { invoke: async () => ({
        data: { error: 'provider_rejected', detail: 'secret=must-not-reach-ui' }, error: null,
      }) } } };
      if (name.endsWith('/shipping-errors')) return { isShippingProviderIssue: () => false };
      if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
      if (name === './cache') return {
        CK: { shippingInitial: 'shipping:initial' }, invalidateList() {}, invalidateListPrefix() {},
        swrList: (_key, fetcher) => fetcher(),
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  await assert.rejects(exports.shippingApi.bootstrap(), error => {
    assert.equal(error.message, 'provider_rejected');
    assert.equal(error.detail, null);
    return true;
  });
});

test('shipping client accepts only whitelisted field details from validation responses', async () => {
  const issue = {
    field: 'parcels.box_length', reason: 'number_above_max', index: 1, limit: 180,
  };
  const run = async field_issue => {
    const exports = {};
    runInNewContext(compiled, {
      exports, Error,
      require(name) {
        if (name === './supabase') return { supabase: { functions: { invoke: async () => ({
          data: { error: 'invalid_draft_field', field_issue }, error: null,
        }) } } };
        if (name.endsWith('/shipping-errors')) return { isShippingProviderIssue: () => false };
        if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
        if (name === './cache') return {
          CK: { shippingInitial: 'shipping:initial' }, invalidateList() {}, invalidateListPrefix() {},
          swrList: (_key, fetcher) => fetcher(),
        };
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    try {
      await exports.shippingApi.bootstrap();
      assert.fail('expected validation error');
    } catch (error) {
      return error;
    }
  };

  const accepted = await run(issue);
  assert.equal(accepted.message, 'invalid_draft_field');
  assert.equal(JSON.stringify(accepted.fieldIssue), JSON.stringify(issue));

  const rejected = await run({ field: 'secret.api_token', reason: 'invalid_text_type' });
  assert.equal(rejected.fieldIssue, null);
});

test('shipping initial caches only the default list and every mutation invalidates both sides of the attempt', async () => {
  const exports = {}, invokes = [], invalidations = [], swrCalls = [];
  let backgroundError;
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { functions: { invoke: async (_functionName, options) => {
        invokes.push(options.body);
        if (options.body.action === 'archive') return { data: { shipment: { id: 'SHP-1' } }, error: null };
        return { data: { bootstrap: {}, shipments: [], count: 0 }, error: null };
      } } } };
      if (name === './cache') return {
        CK: { shippingInitial: 'shipping:initial' },
        invalidateList: key => invalidations.push(key),
        invalidateListPrefix: key => invalidations.push(key),
        swrList: (key, fetcher, options) => {
          swrCalls.push({ key, options });
          return fetcher();
        },
      };
      if (name.endsWith('/shipping-errors')) return { isShippingProviderIssue: () => false };
      if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  const onFresh = () => {};
  await exports.shippingApi.initial(0, '   ', {
    cacheScope: 'user-1:owner',
    force: true,
    onFresh,
    onBackgroundError: error => { backgroundError = error; },
  });
  assert.equal(swrCalls.length, 1);
  assert.equal(swrCalls[0].key, 'shipping:initial:user-1:owner');
  assert.equal(swrCalls[0].options.force, true);
  assert.equal(swrCalls[0].options.staleMs, 10_000);
  assert.strictEqual(swrCalls[0].options.onFresh, onFresh);
  const outage = new Error('offline');
  swrCalls[0].options.onBackgroundError(outage);
  assert.strictEqual(backgroundError, outage);
  assert.deepEqual(invalidations, ['shipping:initial:user-1:owner']);

  await exports.shippingApi.initial(1, 'query');
  assert.equal(swrCalls.length, 1, 'search and pagination must not reuse the default cache');
  await exports.shippingApi.action('archive', { id: 'SHP-1', version: 2 });
  assert.deepEqual(invalidations, ['shipping:initial:user-1:owner', 'shipping:initial', 'shipping:initial']);
  assert.deepEqual(invokes.map(call => call.action), ['initial', 'initial', 'archive']);
});

test('a repeat Shipping visit inside the freshness window returns cache without a duplicate Edge call', async () => {
  listCache.clearListCache();
  const first = { bootstrap: { marker: 'first' }, shipments: [{ id: 'cached' }], count: 1 };
  let requests = 0, receivedFresh = null;
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { functions: { invoke: async () => {
        requests += 1;
        return { data: first, error: null };
      } } } };
      if (name === './cache') return listCache;
      if (name.endsWith('/shipping-errors')) return { isShippingProviderIssue: () => false };
      if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  const options = { cacheScope: 'user-1:owner' };
  assert.deepEqual(await exports.shippingApi.initial(0, '', options), first);
  const revisit = exports.shippingApi.initial(0, '', { ...options, onFresh: value => { receivedFresh = value; } });
  assert.deepEqual(await revisit, first);
  await settle();
  assert.equal(requests, 1);
  assert.equal(receivedFresh, null);
  listCache.clearListCache();
});

test('a failed forced Shipping refresh purges the previously cached shipment list', async () => {
  listCache.clearListCache();
  const cached = { bootstrap: { marker: 'cached' }, shipments: [{ id: 'private-row' }], count: 1 };
  let requests = 0;
  const exports = {};
  runInNewContext(compiled, {
    exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { functions: { invoke: async () => {
        requests += 1;
        return requests === 1
          ? { data: cached, error: null }
          : { data: null, error: { context: { json: async () => ({ error: 'forbidden' }) } } };
      } } } };
      if (name === './cache') return listCache;
      if (name.endsWith('/shipping-errors')) return { isShippingProviderIssue: () => false };
      if (name.endsWith('/shipping-domain')) return { isShippingDraftFieldIssue };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  const cacheScope = 'user-1:owner', cacheKey = `shipping:initial:${cacheScope}`;
  assert.deepEqual(await exports.shippingApi.initial(0, '', { cacheScope }), cached);
  assert.equal(listCache.hasCache(cacheKey), true);
  await assert.rejects(exports.shippingApi.initial(0, '', { cacheScope, force: true }), /forbidden/);
  assert.equal(listCache.hasCache(cacheKey), false);
  listCache.clearListCache();
});
