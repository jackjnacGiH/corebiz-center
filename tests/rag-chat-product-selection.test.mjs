import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductSelection,
  extractModelCodes,
  hasExactModelCodeMatch,
  matchesExplicitProductVariant,
  normalizeProductSearchQuery,
  productIdentitySearchText,
} from "../supabase/functions/_shared/product-selection.mjs";

const product = (name_th, name_en = "", brand = "DEERFOS") => ({
  name_th,
  name_en,
  brand,
  tags: [],
  feature_tags: [],
});

test("removes Thai buying intent even when it is attached to the product name", () => {
  assert.equal(
    normalizeProductSearchQuery("สนใจกระดาษทราย DEERFOS SA331"),
    "กระดาษทราย DEERFOS SA331",
  );
  assert.equal(
    normalizeProductSearchQuery("อยากได้กระดาษทรายกลม SA331 5 นิ้ว #120"),
    "กระดาษทรายกลม SA331 5 นิ้ว #120",
  );
  assert.equal(normalizeProductSearchQuery("ต้องการSA331 5 นิ้ว"), "SA331 5 นิ้ว");
  assert.equal(normalizeProductSearchQuery("ขอราคาSA331 #120"), "SA331 #120");
  assert.equal(normalizeProductSearchQuery("สอบถามราคาSA331"), "SA331");
  assert.equal(normalizeProductSearchQuery("สนใจซื้อSA331ไหมครับ"), "SA331");
  assert.equal(normalizeProductSearchQuery("ขอspec SA331 หน่อยค่ะ"), "SA331");
});

test("recognises exact catalog model codes, including a spaced model", () => {
  assert.deepEqual(extractModelCodes("DEERFOS SA331"), ["SA331"]);
  assert.deepEqual(extractModelCodes("Sign Neon Gloss FA 331"), ["FA331"]);
  assert.equal(
    hasExactModelCodeMatch("สนใจ DEERFOS SA331", "DEERFOS Velcro Sanding Disc SA331 5 inch #120"),
    true,
  );
  assert.equal(
    hasExactModelCodeMatch("Sign Neon Gloss FA 331", "Sign Neon Gloss FA331 1.22 x 50 m"),
    true,
  );
  assert.equal(
    hasExactModelCodeMatch("DEERFOS SA331", "DEERFOS SA332 5 inch #120"),
    false,
  );
});

test("database identity search excludes dimensions and grit that use different catalog notation", () => {
  assert.equal(
    productIdentitySearchText("DEERFOS SA331 5 นิ้ว #120"),
    "DEERFOS SA331",
  );
  assert.equal(
    productIdentitySearchText("SA331 5 inch เบอร์ 120"),
    "SA331",
  );
});

test("asks only for size and grit when an exact model has many catalog variants", () => {
  const matches = [
    product('กระดาษทรายกลมสักหลาด SA331 5" #80'),
    product('กระดาษทรายกลมสักหลาด SA331 5" #120'),
    product('กระดาษทรายกลมสักหลาด SA331 6" #80'),
    product('กระดาษทรายกลมสักหลาด SA331 6" #120'),
  ];
  const selection = buildProductSelection("กระดาษทราย DEERFOS SA331", matches);

  assert.equal(selection?.selection_required, true);
  assert.deepEqual(selection?.missing_fields, ["size", "grit"]);
  assert.deepEqual(selection?.available_values.size, ["5นิ้ว", "6นิ้ว"]);
  assert.deepEqual(selection?.available_values.grit, ["#80", "#120"]);
  assert.match(selection?.clarification_question_th ?? "", /ขนาด/);
  assert.match(selection?.clarification_question_th ?? "", /เบอร์ความละเอียด/);
});

test("does not ask again after the refined search resolves one SKU", () => {
  const exact = [product('กระดาษทรายกลมสักหลาด SA331 5" #120')];
  assert.equal(buildProductSelection("SA331 5 นิ้ว #120", exact), null);
});

test("an exact grit does not silently match a longer grit with the same prefix", () => {
  const grit120 = product('กระดาษทรายกลมสักหลาด SA331 5" #120');
  const grit1200 = product('กระดาษทรายกลมสักหลาด SA331 5" #1200');
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว #120", grit120), true);
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว #120", grit1200), false);
  assert.equal(matchesExplicitProductVariant("SA331 6 นิ้ว #120", grit120), false);
});

test("Thai catalog name is canonical when bilingual variant labels conflict", () => {
  const conflicting = product(
    'กระดาษทรายกลมสักหลาด SA331 5" #150',
    'DEERFOS Velcro Sanding Disc SA331 5" #120',
  );
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว #120", conflicting), false);
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว #150", conflicting), true);
});

test("asks for only the remaining facet when size is already known", () => {
  const matches = [
    product('กระดาษทรายกลมสักหลาด SA331 5" #80'),
    product('กระดาษทรายกลมสักหลาด SA331 5" #120'),
  ];
  const selection = buildProductSelection("SA331 5 นิ้ว", matches);
  assert.deepEqual(selection?.missing_fields, ["grit"]);
});

test("detects hole pattern and backing only when those catalog facets vary", () => {
  const matches = [
    product('กระดาษทรายกลมสักหลาด 6" #120 6 รู'),
    product('กระดาษทรายกลมหลังกาว 6" #120 ไม่มีรู'),
  ];
  const selection = buildProductSelection("กระดาษทรายกลม 6 นิ้ว #120", matches);
  assert.deepEqual(selection?.missing_fields, ["holes", "backing"]);
});
