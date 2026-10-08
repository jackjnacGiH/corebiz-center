import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductSearchQuery } from '../supabase/functions/_shared/product-selection.mjs';

test('customer facet assignments survive quantity cleanup', () => {
  for (const query of ['grit=120', 'เบอร์=120', '5 in. grit=120', 'ขนาด=5 นิ้ว เบอร์=120', 'size=5', 'holes=8']) {
    assert.equal(normalizeProductSearchQuery(query), query);
  }
  assert.equal(normalizeProductSearchQuery('ขอใบเสนอราคาค่ะ ม้วนใยขัด 7447 #320 = 4 ม้วน'), 'ม้วนใยขัด 7447 #320');
  assert.equal(normalizeProductSearchQuery('SA331 5" #1500 จำนวน 200 ชิ้น'), 'SA331 5" #1500');
});
