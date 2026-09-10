import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { emptyDraft } from '../supabase/functions/_shared/shipping-domain.ts';

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
        error: { context: { json: async () => ({ error: 'provider_rejected', shipment: restored }) } },
      }) } } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  await assert.rejects(
    exports.shippingApi.action('submit', { id: restored.id, version: 7 }),
    error => {
      assert.equal(error.message, 'provider_rejected');
      assert.deepEqual(error.shipment, restored);
      return true;
    },
  );
});
