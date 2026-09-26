import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { scoreProductCandidate, buildScoredProductSelection, productModelSearchRoot } from "../supabase/functions/_shared/product-match-score.mjs";
import { productSearchDisposition, shouldSuppressToolForProductSearch, matchesExplicitProductVariant, buildProductSelection } from "../supabase/functions/_shared/product-selection.mjs";
import { pendingProductQuestion } from "../supabase/functions/_shared/product-turn-context.mjs";
import { guardNumericSellingPriceAnswer } from "../supabase/functions/_shared/price-answer-guard.mjs";
import { guidedExactProductAnswer } from "../supabase/functions/_shared/guided-product-selection.mjs";

const product = { sku: "2020000992", name_th: 'กระดาษทรายกลมสักหลาด SA331 5" #1500', name_en: 'DEERFOS Velcro Sanding Disc 5" #1500', brand: "DEERFOS" };
const generic = { candidateProductType: "sanding_disc" };
const exactType = { requestedProductType: "sanding_disc", candidateProductType: "sanding_disc" };
const query = 'กระดาษทราย DEERFOS SA331VC 5" #1500';
const score = (q = query, p = product, identity = generic) => scoreProductCandidate(q, p, identity);
const result = () => buildScoredProductSelection(query, [{ product, match: score() }]);

test("SA331VC: qualifying points require customer confirmation", () => {
  assert.equal(score().score, 85);
  assert.equal(score().eligible, true);
  assert.equal(score().model_relation, "suffix_unconfirmed");
  assert.equal(score(query, product, exactType).score, 90);
  assert.equal(productModelSearchRoot(query), "SA331");
  assert.equal(productSearchDisposition(result()), "needs_selection");
  assert.deepEqual(result().products, []);
  assert.equal(result().clarification_candidates[0].sku, product.sku);
  assert.match(pendingProductQuestion(result()), /SA331VC.*ต่างกัน/);
});
test("exact model and full evidence scores 100; absent brand does not get points", () => {
  assert.equal(score(query.replace("SA331VC", "SA331"), product, exactType).score, 100);
  assert.equal(score(query.replace("DEERFOS", "")).score, 75);
  assert.equal(score(query.replace("DEERFOS", "")).eligible, false);
  assert.equal(score('กระดาษทรายกลมสักหลาด SA331VC 5" #1500', product, exactType).score, 80);
});
for (const [label, q, p, identity, conflict] of [
  ["wrong size", query.replace('5"', '6"'), product, generic, "size"],
  ["wrong grit", query.replace("#1500", "#120"), product, generic, "grit"],
  ["wrong backing", query + " หลังกาว", product, generic, "backing"],
  ["wrong holes", query + " 6 รู", { ...product, name_th: product.name_th + " ไม่มีรู" }, generic, "holes"],
  ["wrong brand", query.replace("DEERFOS", "MIRKA"), product, generic, "brand"],
  ["neighbour model", query.replace("SA331VC", "SA332"), product, generic, "model"],
  ["prefix-only model", query.replace("SA331VC", "SA3310"), product, generic, "model"],
  ["different suffixes", query, { ...product, name_th: product.name_th.replace("SA331", "SA331PSA") }, generic, "model"],
  ["wrong type", query, product, { ...generic, requestedProductType: "flap_disc" }, "type"],
  ["wrong family", query, product, { ...generic, requestedFamily: "belt", candidateFamily: "disc" }, "family"],
  ["wrong SKU", query + " 2020000993", product, generic, "sku"],
  ["unknown candidate size", query, { ...product, name_th: product.name_th.replace('5"', '') }, generic, "size_unverified"],
]) test(label + " is rejected regardless of weighted total", () => {
  const match = score(q, p, identity);
  assert.ok(match.conflicts.includes(conflict));
  assert.equal(match.eligible, false);
  assert.equal(buildScoredProductSelection(q, [{ product: p, match }]), null);
});
test("missing facet contributes zero; size/grit clarification for old exact path survives", () => {
  assert.equal(score('กระดาษทราย DEERFOS SA331VC').eligible, false);
  assert.equal(matchesExplicitProductVariant('SA331 5 นิ้ว #1500', product), true);
  assert.equal(matchesExplicitProductVariant('SA331 5 นิ้ว #150', product), false);
  const selection = buildProductSelection("SA331", [product, { ...product, name_th: product.name_th.replace('5" #1500', '6" #120') }]);
  assert.deepEqual(selection.missing_fields, ["size", "grit"]);
});
test("deduplicate, order by score, cap at three, and reject below threshold", () => {
  const candidates = [79, 80, 85, 100, 90].map((points, i) => ({ product: { ...product, sku: String(i) }, match: { ...score(), score: points, eligible: points >= 80 } }));
  const selected = buildScoredProductSelection(query, [...candidates, candidates[3]]);
  assert.deepEqual(selected.clarification_candidates.map(c => c.match_score), [100, 90, 85]);
  assert.equal(selected.clarification_candidates.length, 3);
});
test("pending selection blocks lead, price, billing and quotation tools", () => {
  for (const name of ["capture_lead", "get_exact_price", "request_quote", "link_quote_customer"]) {
    assert.equal(shouldSuppressToolForProductSearch(name, productSearchDisposition(result())), true);
  }
});
test("deterministic offer survives numeric price guard without inventing a price", () => {
  const answer = pendingProductQuestion(result());
  const guarded = guardNumericSellingPriceAnswer({ query, answer, lang: "th", exactPriceResults: [] });
  assert.equal(guarded.answer, answer);
  assert.equal(guarded.guarded, false);
});
test("LINE shows a button even for one candidate; it sends the exact product name", () => {
  const source = readFileSync(new URL("../supabase/functions/line-webhook/index.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("function extractQuickReplies("), source.indexOf("function textToLineMessages("));
  const extract = new Function(stripTypeScriptTypes(block) + "\nreturn extractQuickReplies;")();
  const buttons = extract(pendingProductQuestion(result()));
  assert.equal(buttons.items.length, 1);
  assert.equal(buttons.items[0].action.text, product.name_th);
  assert.match(buttons.items[0].action.label, /SA331 #1500/);
  const guided = extract('เลือกเบอร์ค่ะ\n1. กระดาษทรายกลมหลังกาว PS36 5" #60\n2. กระดาษทรายกลมหลังกาว PS36 5" #80');
  assert.deepEqual(guided.items.map(item => item.action.label), ["1. PS36 #60", "2. PS36 #80"]);
  assert.equal(guided.items[1].action.text, 'กระดาษทรายกลมหลังกาว PS36 5" #80');
  const backings = extract('เลือกแบบค่ะ\n1. จานทรายหลังอ่อน 4 นิ้ว\n2. จานทรายหลังแข็ง 4 นิ้ว');
  assert.deepEqual(backings.items.map(item => item.action.label), ["1. หลังอ่อน", "2. หลังแข็ง"]);
  assert.equal(backings.items[0].action.text, "จานทรายหลังอ่อน 4 นิ้ว");
  const quote = extract(guidedExactProductAnswer({ ...product, unit: "ชิ้น", stock: 0 }, 200,
    { ok: true, exact_match: true, sku: product.sku, unit_price: 7 }));
  assert.deepEqual(quote.items.map(item => item.action.text), ["ต้องการใบเสนอราคา", "ไม่ต้องการ"]);
  assert.deepEqual(quote.items.map(item => item.action.label), ["1. ต้องการใบเสนอราคา", "2. ไม่ต้องการ"]);
  const models = extract('เลือกรุ่นค่ะ\n1. จานทรายหลังอ่อน Eco 4" 46P\n2. จานทรายหลังอ่อน CS310X 48P 4"');
  assert.deepEqual(models.items.map(item => item.action.label), ["1. Eco", "2. CS310X"]);
  const longName = "กระดาษทราย".repeat(12);
  assert.equal(extract(`1. ${longName}`).items[0].action.text, longName);
  const allGrits = [40, 60, 80, 100, 120, 150, 180, 220, 240, 280, 320, 400, 500, 600, 800, 1000, 1200, 1500, 2000];
  const fullList = allGrits.map((grit, index) => `${index + 1}. กระดาษทรายกลมสักหลาด SA331 5" #${grit}`).join("\n");
  const fullListButtons = extract(fullList);
  assert.equal(fullListButtons.items.length, 13);
  assert.equal(fullListButtons.items[12].action.text, 'กระดาษทรายกลมสักหลาด SA331 5" #500');
  const firstPage = `${allGrits.slice(0, 10).map((grit, index) => `${index + 1}. กระดาษทรายกลมสักหลาด SA331 5" #${grit}`).join("\n")}\n11. แสดงเพิ่มเติม`;
  const firstPageButtons = extract(firstPage);
  assert.equal(firstPageButtons.items.length, 11);
  assert.equal(firstPageButtons.items[10].action.text, "แสดงเพิ่มเติม");
  const secondPage = allGrits.slice(10).map((grit, index) => `${index + 1}. กระดาษทรายกลมสักหลาด SA331 5" #${grit}`).join("\n");
  const secondPageButtons = extract(secondPage);
  assert.equal(secondPageButtons.items.length, 9);
  assert.equal(secondPageButtons.items[7].action.text, 'กระดาษทรายกลมสักหลาด SA331 5" #1500');
  assert.equal(extract("ไม่มีตัวเลือก"), undefined);
});
