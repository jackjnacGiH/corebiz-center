import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitProductSkus } from "../supabase/functions/_shared/product-selection.mjs";
import { guidedCatalogQuery } from "../supabase/functions/_shared/guided-product-selection.mjs";

test("explicit SKU in the reported customer sentence outranks descriptive words", () => {
  const query = "สนใจ SKU 2020002618 ม้วนใยขัด #240 ครับ";
  assert.deepEqual(extractExplicitProductSkus(query), ["2020002618"]);
  assert.equal(guidedCatalogQuery(query, []), "2020002618");
  assert.equal(guidedCatalogQuery("สนใจ SKU 2020002618 กระดาษทราย #1500 สีแดงครับ", []), "2020002618");
});

test("bare full catalog numbers work alone or alongside Thai product descriptions", () => {
  for (const query of ["2020002618", "สนใจ 2020002618 ม้วนใยขัด #240 ครับ", "สนใจ2020002618ครับ"]) {
    assert.deepEqual(extractExplicitProductSkus(query), ["2020002618"]);
    assert.equal(guidedCatalogQuery(query, []), "2020002618");
  }
});

test("labelled SKU syntax preserves valid code characters and bounds complete tokens", () => {
  for (const [query, expected] of [["sku: AB-12", "AB-12"], ["SKU：AB_12.3/4", "AB_12.3/4"], ["SKU2020002618", "2020002618"], [`SKU ${"A".repeat(64)}`, "A".repeat(64)]]) {
    assert.deepEqual(extractExplicitProductSkus(query), [expected]);
    assert.equal(guidedCatalogQuery(query, []), /^20\d{8}$/u.test(expected) ? expected : `SKU ${expected}`);
  }
  assert.deepEqual(extractExplicitProductSkus("SKU ABC"), []);
  assert.deepEqual(extractExplicitProductSkus(`SKU ${"A".repeat(65)}`), []);
});

test("sentence punctuation is not part of a SKU and internal punctuation remains identity", () => {
  for (const query of ["SKU 2020002618.", "2020002618.", "SKU 2020002618. More details", "(SKU 2020002618.)"]) {
    assert.deepEqual(extractExplicitProductSkus(query), ["2020002618"], query);
    assert.equal(guidedCatalogQuery(query, []), "2020002618", query);
  }
  assert.deepEqual(extractExplicitProductSkus("SKU AB.12/3."), ["AB.12/3"]);
  assert.equal(guidedCatalogQuery("SKU AB.12/3."), "SKU AB.12/3");
  assert.deepEqual(extractExplicitProductSkus("2020002618.99"), []);
});

test("multiple distinct codes are retained in source order and never reduced to one", () => {
  const query = "2020002618 และ SKU 2020002620 แล้ว SKU 2020002618";
  assert.deepEqual(extractExplicitProductSkus(query), ["2020002618", "2020002620"]);
  assert.equal(guidedCatalogQuery(query, []), null);
  assert.deepEqual(extractExplicitProductSkus("SKU AB-12, SKU CD_34"), ["AB-12", "CD_34"]);
});

test("URL or image references do not establish a product SKU", () => {
  const query = "ดูรูป https://images.example/2020002618.png และ https://www.jnac.online/p/2020002620";
  assert.deepEqual(extractExplicitProductSkus(query), []);
  assert.deepEqual(extractExplicitProductSkus("www.jnac.online/p/2020002618"), []);
  assert.deepEqual(extractExplicitProductSkus("SKU https://example.com/2020002618 more details"), []);
  assert.deepEqual(extractExplicitProductSkus(`${query} สนใจ SKU 2020002618 ครับ`), ["2020002618"]);
});

test("document identifiers and numeric substrings cannot become product SKUs", () => {
  for (const query of ["QT-2020002618", "SO 2020002618", "DN:2020002618", "SKU QT-2020002618", "SKU SO2020002618", "SKU QT-2020002618 status", "20200026180", "12020002618", "202000261", "A2020002618", "2020002618B", "ABC/2020002618", "2020002618.99"]) {
    assert.deepEqual(extractExplicitProductSkus(query), [], query);
  }
});

test("contact, tax and email identifiers are not inferred as unlabelled products", () => {
  for (const query of ["โทร 2020002618", "โทร. 2020002618", "เบอร์โทรศัพท์: 2020002618", "phone: 2020002618", "tax id 2020002618000", "เลขผู้เสียภาษี 2020002618000", "sales+2020002618@example.com", "โทร 0812345678 เลขภาษี 0115561012346"]) {
    assert.deepEqual(extractExplicitProductSkus(query), [], query);
  }
  assert.deepEqual(extractExplicitProductSkus("โทร 0812345678 สนใจ SKU 2020002618 ครับ"), ["2020002618"]);
});
