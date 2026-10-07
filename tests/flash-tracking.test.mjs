import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flashDeliveredSnapshot,
  parseFlashDeliveredSnapshot,
} from '../supabase/functions/_shared/flash-tracking.ts';

test('Flash public tracking maps only the exact delivered shipment', () => {
  const payload = {
    code: 1,
    data: {
      list: [
        { search_no: 'OTHER12345', state: 5 },
        {
          search_no: 'TH210697UBBJ9B',
          state: 5,
          routes: [{ route_action: 'DELIVERY_CONFIRM', state: 5, routed_at: '2026-10-07 13:30:26' }],
        },
      ],
    },
  };
  assert.deepEqual(
    parseFlashDeliveredSnapshot(payload, 'TH210697UBBJ9B'),
    { status: 'delivered', updatedAt: '2026-10-07T06:30:26.000Z' },
  );
  assert.equal(
    parseFlashDeliveredSnapshot({ code: 1, data: { list: [{ search_no: 'TH210697UBBJ9B', state: 3 }] } }, 'TH210697UBBJ9B'),
    null,
  );
  assert.equal(
    parseFlashDeliveredSnapshot({ code: 1, data: { list: [{ search_no: 'TH210697UBBJ9B', state: 5, routes: [] }] } }, 'TH210697UBBJ9B'),
    null,
  );
});

test('Flash public tracking uses the first-party POST contract and fails closed', async () => {
  let request;
  const result = await flashDeliveredSnapshot('TH210697UBBJ9B', async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      code: 1,
      data: {
        list: [{
          search_no: 'TH210697UBBJ9B',
          state: 5,
          routes: [{ route_action: 'DELIVERY_CONFIRM', state: 5, routed_at: '2026-10-07 13:30:26' }],
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(request.url, 'https://www.flashexpress.co.th/webApi/tools/tracking');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { search: 'TH210697UBBJ9B' });
  assert.deepEqual(result, { status: 'delivered', updatedAt: '2026-10-07T06:30:26.000Z' });

  const unavailable = await flashDeliveredSnapshot('TH210697UBBJ9B', async () => {
    throw new Error('network unavailable');
  });
  assert.equal(unavailable, null);
});
