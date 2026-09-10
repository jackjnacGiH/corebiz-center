import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductSelection,
  extractModelCodes,
  hasExactModelCodeMatch,
  matchesExplicitProductVariant,
  normalizeProductSearchQuery,
  productIdentitySearchText,
  shouldSuppressToolForProductSearch,
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
  assert.equal(normalizeProductSearchQuery("มี SA331 ไหม"), "SA331");
  assert.equal(normalizeProductSearchQuery("มีSA331ไหมครับ"), "SA331");
  assert.equal(normalizeProductSearchQuery("เอา 5 นิ้ว เบอร์ 120 ครับ"), "5 นิ้ว เบอร์ 120");
  assert.equal(normalizeProductSearchQuery("เอา5 นิ้ว เบอร์120ครับ"), "5 นิ้ว เบอร์120");
  assert.equal(normalizeProductSearchQuery("เอาท์ดอร์"), "เอาท์ดอร์");
  assert.equal(normalizeProductSearchQuery("มีดคัตเตอร์"), "มีดคัตเตอร์");
});

test("recognises exact catalog model codes, including a spaced model", () => {
  assert.deepEqual(extractModelCodes("DEERFOS SA331"), ["SA331"]);
  assert.deepEqual(extractModelCodes("Sign Neon Gloss FA 331"), ["FA331"]);
  assert.deepEqual(extractModelCodes("DEERFOS SA331 size 125 mm grit 120"), ["SA331"]);
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
  assert.equal(
    productIdentitySearchText("SA331 ขนาด 5 นิ้ว grit P120"),
    "SA331",
  );
  assert.equal(
    productIdentitySearchText("หินเจียร WA ขนาด 20x20x6mm เบอร์ P120"),
    "หินเจียร WA",
  );
  assert.equal(productIdentitySearchText("SA331 ไซซ์ 5 นิ้ว เบอร์ 120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 size 5 inch grit 120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 P120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 5 inch 120 grit"), "SA331");
  assert.equal(productIdentitySearchText("SA331 125 mm size 120 grit"), "SA331");
  assert.equal(productIdentitySearchText("SA331 5-inch #120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 5 in. #120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 size: 5 inch grit: 120"), "SA331");
  assert.equal(productIdentitySearchText("SA331 ขนาด : 5 นิ้ว เบอร์ : 120"), "SA331");
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

test("P-prefixed grit is equivalent to catalog hash notation", () => {
  const grit120 = product('กระดาษทรายกลมสักหลาด SA331 5" #120');
  const grit180 = product('กระดาษทรายกลมสักหลาด SA331 5" P180');
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว P120", grit120), true);
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว P120", grit180), false);
  assert.equal(matchesExplicitProductVariant("SA331 5 นิ้ว #180", grit180), true);

  const selection = buildProductSelection("SA331 5 นิ้ว", [grit120, grit180]);
  assert.deepEqual(selection?.available_values.grit, ["#120", "#180"]);
  assert.equal(buildProductSelection("SA331 5 นิ้ว P120", [grit120, grit180]), null);
});

test("English number-first grit selects the exact grade without asking again", () => {
  const grit120 = product('กระดาษทรายกลมสักหลาด SA331 5" #120');
  const grit1200 = product('กระดาษทรายกลมสักหลาด SA331 5" #1200');
  const grit180 = product('กระดาษทรายกลมสักหลาด SA331 5" #180');

  assert.equal(hasExactModelCodeMatch("SA331 5 inch grit 120", grit120.name_th), true);
  assert.equal(matchesExplicitProductVariant("SA331 5 inch 120 grit", grit120), true);
  assert.equal(matchesExplicitProductVariant("SA331 5 inch 120 grit", grit1200), false);
  assert.equal(matchesExplicitProductVariant("SA331 5 inch 120 grit", grit180), false);
  assert.equal(buildProductSelection("SA331 5 inch 120 grit", [grit120, grit1200, grit180]), null);
});

test("English size labels work before or after a metric size", () => {
  const size125 = product("กระดาษทรายกลมสักหลาด SA331 125mm #120");
  const size150 = product("กระดาษทรายกลมสักหลาด SA331 150mm #120");

  for (const query of ["SA331 size 125 mm #120", "SA331 125 mm size #120"]) {
    assert.equal(hasExactModelCodeMatch(query, size125.name_th), true);
    assert.equal(matchesExplicitProductVariant(query, size125), true);
    assert.equal(matchesExplicitProductVariant(query, size150), false);
    assert.equal(buildProductSelection(query, [size125, size150]), null);
  }
});

test("common English inch notation matches the same catalog size", () => {
  const size5 = product('กระดาษทรายกลมสักหลาด SA331 5" #120');
  const size6 = product('กระดาษทรายกลมสักหลาด SA331 6" #120');

  for (const query of ["SA331 5-inch #120", "SA331 5 inch #120", "SA331 5 in. #120"]) {
    assert.equal(matchesExplicitProductVariant(query, size5), true);
    assert.equal(matchesExplicitProductVariant(query, size6), false);
    assert.equal(buildProductSelection(query, [size5, size6]), null);
  }
});

test("facet labels accept colon punctuation without losing exact matching", () => {
  const exact = product('กระดาษทรายกลมสักหลาด SA331 5" #120');
  const otherSize = product('กระดาษทรายกลมสักหลาด SA331 6" #120');
  const otherGrit = product('กระดาษทรายกลมสักหลาด SA331 5" #180');

  for (const query of [
    "SA331 size: 5 inch grit: 120",
    "SA331 size : 5 inch grit : 120",
    "SA331 ขนาด: 5 นิ้ว เบอร์: 120",
    "SA331 ขนาด : 5 นิ้ว เบอร์ : 120",
  ]) {
    assert.equal(hasExactModelCodeMatch(query, exact.name_th), true);
    assert.equal(matchesExplicitProductVariant(query, exact), true);
    assert.equal(matchesExplicitProductVariant(query, otherSize), false);
    assert.equal(matchesExplicitProductVariant(query, otherGrit), false);
    assert.equal(buildProductSelection(query, [exact, otherSize, otherGrit]), null);
  }
});

test("keeps a complete multi-dimensional size tuple when distinguishing variants", () => {
  const size20 = product("หินเจียร WA 20x20x6mm P120");
  const size30 = product("หินเจียร WA 30 x 20 x 6 มม. P120");

  assert.equal(matchesExplicitProductVariant("WA ขนาด 20×20×6 มม. เบอร์ P120", size20), true);
  assert.equal(matchesExplicitProductVariant("WA ขนาด 20×20×6 มม. เบอร์ P120", size30), false);
  assert.equal(matchesExplicitProductVariant("WA size 30x20x6mm grit #120", size30), true);

  const selection = buildProductSelection("หินเจียร WA P120", [size20, size30]);
  assert.deepEqual(selection?.missing_fields, ["size"]);
  assert.deepEqual(selection?.available_values.size, ["20x20x6มม.", "30x20x6มม."]);
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

test("suppresses lead and quote actions only while product selection is pending", () => {
  for (const toolName of ["capture_lead", "request_quote", "link_quote_customer"]) {
    assert.equal(shouldSuppressToolForProductSearch(toolName, "needs_selection"), true);
    assert.equal(shouldSuppressToolForProductSearch(toolName, "resolved"), false);
  }
});
