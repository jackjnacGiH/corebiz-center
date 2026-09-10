import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { emptyDraft, isShippingDraftFieldIssue } from '../supabase/functions/_shared/shipping-domain.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../frontend/src/lib/shipping-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

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
