import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlashDatabaseSnapshot } from '../supabase/functions/_shared/flash-tracking.ts';

test('Flash database snapshot accepts only a delivered row with a valid event time', () => {
  assert.deepEqual(
    parseFlashDatabaseSnapshot([{ delivered: true, updated_at: '2026-10-07T06:30:26+00:00' }]),
    { status: 'delivered', updatedAt: '2026-10-07T06:30:26.000Z' },
  );
  assert.equal(
    parseFlashDatabaseSnapshot([{ delivered: false, updated_at: '2026-10-07T06:30:26+00:00' }]),
    null,
  );
  assert.equal(parseFlashDatabaseSnapshot([{ delivered: true, updated_at: 'invalid' }]), null);
  assert.equal(parseFlashDatabaseSnapshot([]), null);
});
