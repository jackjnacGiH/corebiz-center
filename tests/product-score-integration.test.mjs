import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { recoverEmptyProductAnswer } from "../supabase/functions/_shared/empty-product-recovery.mjs";
import { routeLatestTurn } from "../supabase/functions/_shared/latest-turn-context.mjs";
import {
  confirmedGuidedQuoteRequest, guidedCatalogQuery, guidedExactProductAnswer,
  guidedProductDecision, guidedRequestedQuantity, pendingQuoteQuantityRequest,
  quoteCreationBlockReason, sameProductReference,
} from "../supabase/functions/_shared/guided-product-selection.mjs";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const sourceUrl = new URL("../supabase/functions/rag-chat/index.ts", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("fixtures/sa331-catalog.json", import.meta.url), "utf8"));
const adhesiveCatalog = [
  ...[60, 80, 100, 120, 150, 180, 220].map((grit, index) => ({
    sku: String(2020003334 + index), status: "active", brand: "Klingspor",
    name_th: `กระดาษทรายกลมหลังกาว PS36 5" #${grit}`,
    // The live English title conflicts with the Thai catalog classification.
    name_en: `Klingspor PS36 Velcro Sanding Disc 5" #${grit}`,
  })),
  ...[80, 100, 120, 150, 180, 220, 240, 280, 320, 400, 500].map((grit, index) => ({
    sku: String(2020003033 + index), status: "active", brand: "Mrika",
    name_th: `กระดาษทรายกลมหลังกาว MIRKA GOLD 5" #${grit}`,
    name_en: `MIRKA GOLD PSA Link Roll Disc 5" #${grit}`,
  })),
  { sku: "2020002810", status: "active", brand: "Klingspor",
    name_th: 'กระดาษทรายกลมสักหลาด PS36 5" #120',
    name_en: 'Klingspor PS36 Velcro Sanding Disc 5" #120' },
];
const flapDiscCatalog = ["หลังอ่อน", "หลังแข็ง"].flatMap((backing, backingIndex) =>
  ["CS310X", "Eco", "XA911", "XA945"].flatMap((model, modelIndex) =>
    [40, 60, 80, 100, 120, 150, 180, 220, 240, ...(model === "CS310X" ? [280] : []), 320, 400]
      .map((grit, gritIndex) => ({
        sku: String(2020090000 + backingIndex * 1000 + modelIndex * 100 + gritIndex),
        status: "active", brand: "jnac",
        name_th: model === "CS310X"
          ? `จานทราย${backing} ${model} ${backing === "หลังอ่อน" ? "48P" : "72P"} 4" #${grit}`
          : `จานทราย${backing} ${model} 4" ${backing === "หลังอ่อน" ? (model === "XA911" ? "48P" : "46P") : "72P"} #${grit}`,
      }))));
const nonwovenRoll = {
  sku: "2020002621", status: "active", unit: "ม้วน", min_order_qty: 1,
  name_th: "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 6นิ้วx10M. #400",
  name_en: "",
  description_th: "#400 สี: แดง ขนาด 6 นิ้ว x 10 เมตร",
  inventory: [{ quantity: 18 }],
};
const nonwovenRollQuestion = 'ม้วนใยสังเคราะห์ สก๊อตไบรท์ สีแดง #400 Size 6"x10 M. ราคาเท่าไหร่';
const nonwovenRollChoices = [
  ...[320, 360].map((grit, index) => ({
    sku: String(2020001667 + index), status: "active", brand: "MIRLON",
    name_th: `ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 140mm.x10M. #${grit}`,
  })),
  ...[80, 180, 240, 320, 400, 600].map((grit, index) => ({
    sku: ["2020002624", "2020002616", "2020002618", "2020002620", "2020002621", "2020002623"][index],
    status: "active", brand: "jnac",
    name_th: `ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 6นิ้วx10M. #${grit}`,
  })),
  { sku: "wheel-distractor", status: "active", name_th: 'ล้อขัดใยสังเคราะห์ สก๊อตไบร์ท 4" #400' },
  { sku: "sanding-distractor", status: "active", name_th: 'ผ้าทรายม้วน 6นิ้วx10M. #400' },
];
const pacoBelt = {
  sku: "2020000905", status: "active", brand: "PACO", unit: "ชิ้น", min_order_qty: 10,
  name_th: "ผ้าทรายสายพาน PACO รุ่น Y966 10x330mm. #60",
  name_en: "PACO Y966 Abrasive Belt 10x330mm. #60",
  inventory: [{ quantity: 100 }],
};
const grindingDiscCatalog = [
  { sku: "2020011111", status: "active", name_th: 'ใบเจียร 4" #80' },
  { sku: "2020011112", status: "active", name_th: 'ใบเจียร 4" #120' },
  { sku: "2020011113", status: "active", name_th: 'ใบเจียร 5" #80' },
];
const productFields = ["sku", "name_th", "name_en", "brand"];

async function loadEdge(source = readFileSync(sourceUrl, "utf8"), scoring = true) {
  const bundle = await build({ stdin: {
    contents: source + "\nexport { findProducts, productFamilyFor, productTypeFor, resolveResponseLanguage, requestQuote };",
    resolveDir: fileURLToPath(new URL("../supabase/functions/rag-chat/", import.meta.url)), loader: "ts",
  }, bundle: true, write: false, format: "cjs", platform: "node", plugins: [{ name: "mock-remote-imports", setup(build) {
    build.onResolve({ filter: /^(https:|jsr:)/ }, args => ({ path: args.path, namespace: "remote" }));
    build.onLoad({ filter: /.*/, namespace: "remote" }, () => ({ contents: "export const createClient = () => { throw new Error('No network in integration test'); };" }));
  } }] });
  const module = { exports: {} };
  new Function("module", "exports", "Deno", bundle.outputFiles[0].text)(module, module.exports, {
    env: { get: (key) => key === "PRODUCT_SCORE_SUGGESTIONS_ENABLED" ? String(scoring) : undefined }, serve: () => {},
  });
  return module.exports;
}
const edge = await loadEdge();
function fakeAdmin(rows = catalog) {
  return {
    from(table) {
      let result = table === "products" ? rows : [];
      let count = 0;
      const chain = {
        select() { return chain; },
        eq(key, value) { result = result.filter(row => row[key] === value); return chain; },
        or(expression) {
          const conditions = expression.split(",").map(part => {
            const [key, , ...patterns] = part.split(".");
            const regex = new RegExp(patterns.join(".").split("%").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"), "i");
            return row => regex.test(String(row[key] ?? ""));
          });
          result = result.filter(row => conditions.some(condition => condition(row))); return chain;
        },
        in(key, values) { result = result.filter(row => values.includes(row[key])); return chain; },
        order() { return chain; },
        limit(max) { count = result.length; result = result.slice(0, max); return chain; },
        then(resolve, reject) { return Promise.resolve({ data: result, error: null, count: count || result.length }).then(resolve, reject); },
      };
      return chain;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
}

test("full findProducts resolves photograph query to one scored candidate among 189 live catalog rows", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #1500');
  assert.equal(result.selection_required, true);
  assert.deepEqual(result.clarification_candidates.map(p => p.sku), ["2020000992"]);
  assert.equal(result.clarification_candidates[0].match_score, 85);
});
test("button selection resolves exact SKU, without remaining confirmation", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทรายกลมสักหลาด SA331 5" #1500');
  assert.equal(result.selection_required, undefined);
  assert.equal(result.count, 1);
  assert.equal(result.products[0].sku, "2020000992");
  assert.equal(result.products[0].price_lookup_required, true);
});
test("nonwoven roll price question finds its catalog SKU despite spelling and size notation", async () => {
  const result = await edge.findProducts(fakeAdmin([nonwovenRoll]), nonwovenRollQuestion);
  const matches = [...(result.products ?? []), ...(result.clarification_candidates ?? [])];
  assert.deepEqual(matches.map((item) => item.sku), [nonwovenRoll.sku]);
  assert.doesNotMatch(result.query ?? "", /XA945/);
});
test("short Thai Scotch-Brite roll wording offers real catalog sizes before an exact grit", async () => {
  const question = "มีใยขัดสก๊อตไบร์ท ม้วนไหมครับ";
  const lookup = query => edge.findProducts(fakeAdmin(nonwovenRollChoices), query);
  assert.equal(guidedCatalogQuery(question), "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท");
  assert.equal((await lookup(question)).count, 8);
  const first = await guidedProductDecision(question, [], "th", lookup);
  assert.equal(first.result.count, 8);
  assert.equal(first.result.selection_required, true);
  assert.match(first.answer, /1\. ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 6นิ้วx10M\./);
  assert.match(first.answer, /2\. ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 140mm\.x10M\./);
  assert.doesNotMatch(first.answer, /ล้อขัด|ผ้าทรายม้วน|ราคา\s*[\d,.]+\s*บาท/);

  const history = [{ role: "user", content: question }, { role: "assistant", content: first.answer }];
  const chosenSize = await guidedProductDecision("2", history, "th", lookup);
  assert.equal(chosenSize.result.count, 2);
  assert.match(chosenSize.answer, /1\. ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 140mm\.x10M\. #320/);
  assert.match(chosenSize.answer, /2\. ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท 140mm\.x10M\. #360/);
  assert.doesNotMatch(chosenSize.answer, /6นิ้ว/);

  const grit = await guidedProductDecision("เบอร์ 400", history, "th", lookup);
  assert.equal(grit.lookupQuery, "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท #400");
  assert.equal(grit.result.products[0].sku, "2020002621");
  assert.equal(grit.answer, null);
});
test("roll alias needs the roll form and does not turn other abrasives into rolls", () => {
  assert.equal(guidedCatalogQuery("ใยขัดสก๊อตไบรท์แบบม้วน"), "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท");
  assert.equal(guidedCatalogQuery("มีม้วนใยขัดสก๊อตไบร์ทไหมครับ"), "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท");
  assert.equal(guidedCatalogQuery("มีสก๊อตไบร์ทแบบม้วนไหมครับ"), "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท");
  assert.equal(guidedCatalogQuery("มีใยขัดสก๊อตไบร์ทไหมครับ"), null);
  for (const otherProduct of [
    "มีล้อขัดใยสังเคราะห์ไหมครับ",
    "มีล้อขัดใยสังเคราะห์ สก๊อตไบร์ท แบบม้วนไหมครับ",
    "มีแผ่นใยขัดสก๊อตไบร์ทแบบม้วนไหมครับ",
    "มีผ้าทรายม้วนไหมครับ",
  ]) {
    assert.notEqual(guidedCatalogQuery(otherProduct), "ม้วนใยขัดสังเคราะห์ สก๊อตไบร์ท");
  }
});
test("new nonwoven roll question ignores old XA945 context and verifies red in product details", async () => {
  const history = [
    { role: "user", content: 'จานทรายหลังอ่อน XA945 4" 46P #400 จำนวน 100 ชิ้น' },
    { role: "assistant", content: 'พบจานทรายหลังอ่อน XA945 4" 46P #400 ค่ะ' },
  ];
  const guided = await guidedProductDecision(nonwovenRollQuestion, history, "th",
    (query) => edge.findProducts(fakeAdmin([nonwovenRoll]), query));
  assert.ok(guided, "this complete new product question must use catalog-first routing");
  assert.match(guided.lookupQuery, /ม้วนใย/);
  assert.doesNotMatch(guided.lookupQuery, /XA945/);
  assert.equal(guidedRequestedQuantity(nonwovenRollQuestion, history, guided.lookupQuery), null);
  assert.equal(guided.result.products?.[0]?.sku ?? guided.result.clarification_candidates?.[0]?.sku,
    nonwovenRoll.sku);
  assert.equal(guided.result.selection_required, undefined);
  const answer = guidedExactProductAnswer(guided.result.products[0]);
  assert.match(answer, /สีแดง/);
  assert.match(answer, /ต้องการกี่/);
  assert.doesNotMatch(answer, /XA945|ราคา\s*[\d,.]+\s*บาท/);
  assert.equal(guided.escalate, undefined);
});
test("nonwoven roll does not treat an unverified color or different length as exact", async () => {
  const color = await edge.findProducts(fakeAdmin([nonwovenRoll]),
    nonwovenRollQuestion.replace("สีแดง", "สีเขียว"));
  assert.equal(color.selection_required, true);
  assert.match(color.clarification_question_th, /ไม่ได้ระบุสีเขียว/);
  const length = await edge.findProducts(fakeAdmin([nonwovenRoll]),
    nonwovenRollQuestion.replace('6"x10 M.', '6"x5 M.'));
  assert.deepEqual(length.products, []);
});
test("confirmed nonwoven roll SKU asks for quantity before any numeric price", async () => {
  const result = await edge.findProducts(fakeAdmin([nonwovenRoll]), nonwovenRoll.sku);
  assert.equal(result.products?.[0]?.sku, nonwovenRoll.sku);
  const answer = guidedExactProductAnswer(result.products[0]);
  assert.match(answer, /ต้องการกี่ม้วน/);
  assert.doesNotMatch(answer, /ราคา\s*[\d,.]+\s*บาท|ให้เอยทำใบเสนอราคา/);
  const history = [{ role: "assistant", content: answer }];
  assert.equal(guidedCatalogQuery("2 ม้วน", history), nonwovenRoll.sku);
  assert.equal(guidedRequestedQuantity("2 ม้วน", history, nonwovenRoll.sku), 2);
});
test("payment and ordering follow-ups cannot create a second quote", async () => {
  const history = [{ role: "assistant", content: "เอยทำใบเสนอราคาเลขที่ QT-01000127 เรียบร้อยแล้วค่ะ" }];
  const cases = [
    ["สั่งเลยครับ ต้องชำระเงินก่อนหรือไม่", "payment_question"],
    ["ต้องโอนเงินก่อนไหมครับ", "payment_question"],
    ["สั่งสินค้ายังไงครับ", "ordering_information"],
    ["สั่งเลยครับ", "not_explicit_quote_request"],
    ["QT-01000127 ใช้สั่งซื้อได้ไหม", "existing_quote_followup"],
    ["ขอใบเสนอราคาเดิมอีกใบ", "existing_quote_followup"],
    ["ส่งใบเสนอราคาแล้วหรือยัง", "existing_quote_followup"],
    ["ทำเลยครับ", "not_explicit_quote_request"],
  ];
  const admin = {
    from() { throw new Error("A follow-up must not read billing details or write a quote"); },
    rpc() { throw new Error("A follow-up must not call the quote RPC"); },
  };
  for (const [query, reason] of cases) {
    assert.equal(quoteCreationBlockReason(query, false, history), reason);
    const result = await edge.requestQuote(admin, { items: [{ sku: "2020003657", qty: 100 }] },
      "line", "00000000-0000-4000-8000-000000000001", query, false, history);
    assert.equal(result.reason, reason);
    assert.equal(result.quote_created, false);
    assert.equal(result.skipped, true);
  }
});
test("direct quotation requests and consent to the immediately preceding offer remain allowed", () => {
  const offer = [{ role: "assistant", content: "พบ SKU 2020003657 จำนวน 100 ชิ้น ให้เอยทำใบเสนอราคาให้เลยไหมคะ" }];
  assert.equal(quoteCreationBlockReason("ทำเลยครับ", false, offer), null);
  assert.equal(quoteCreationBlockReason("ขอใบเสนอราคา SKU 2020003657 จำนวน 100 ชิ้น", false, []), null);
  assert.equal(quoteCreationBlockReason("ช่วยออกใบเสนอราคาให้หน่อยครับ", false, []), null);
  assert.equal(quoteCreationBlockReason("ขอเช็คใบเสนอราคา QT-01000127", false, []), "existing_quote_followup");
  assert.equal(quoteCreationBlockReason("ขอใบเสนอราคาใหม่แทน QT-01000127", false, []), null);
});

test("PVA quote consent and a repeated request reuse the exact offered SKU and quantity", async () => {
  const offer = { role: "assistant", content: "พบ ใบขัดกระจก PVA SPONGY DISC 4นิ้ว #600 (SKU 2020000917) ค่ะ จำนวน 100 ชิ้น ราคา 75 บาท/ชิ้น\nให้เอยทำใบเสนอราคาให้เลยไหมคะ" };
  const consent = { role: "user", content: "ทำค่ะ" };
  const item = { sku: "2020000917", qty: 100 };
  assert.deepEqual(confirmedGuidedQuoteRequest("ทำค่ะ", [offer]), item);
  assert.deepEqual(confirmedGuidedQuoteRequest("ทำครับ", [offer]), item);
  assert.equal(quoteCreationBlockReason("ทำค่ะ", false, [offer]), null);
  assert.deepEqual(confirmedGuidedQuoteRequest("ทำใบเสนอราคาให้หน่อย", [offer, consent]), item);
  assert.equal(quoteCreationBlockReason("ทำใบเสนอราคาให้หน่อย", false, [offer, consent]), null);

  const completed = { role: "assistant", content: "เอยทำใบเสนอราคาเลขที่ QT-01000129 เรียบร้อยแล้วค่ะ" };
  assert.deepEqual(confirmedGuidedQuoteRequest("ทำใบเสนอราคาให้หน่อย", [offer, consent, completed]),
    { ...item, existingQuoteCode: "QT-01000129" });
  assert.equal(quoteCreationBlockReason("ทำใบเสนอราคาให้หน่อย", false, [offer, consent, completed]), "existing_quote_followup");
  const noDatabase = {
    from() { throw new Error("a repeat must not read CRM or create a quote"); },
    rpc() { throw new Error("a repeat must not call the quote RPC"); },
  };
  const result = await edge.requestQuote(noDatabase, { items: [item] }, "line",
    "00000000-0000-4000-8000-000000000001", "ทำใบเสนอราคาให้หน่อย", false,
    [offer, consent, completed], true);
  assert.equal(result.reason, "existing_quote_followup");
  assert.equal(result.quote_created, false);
  assert.equal(quoteCreationBlockReason("ขอใบเสนอราคาใหม่", false, [offer, consent, completed]), null);
  assert.equal(quoteCreationBlockReason("ขอใบเสนอราคา 200 ชิ้น", false, [offer, consent, completed]), null);
  assert.deepEqual(confirmedGuidedQuoteRequest("ทำใบเสนอราคาให้หน่อย", [
    offer, consent, completed, { role: "user", content: "ทำใบเสนอราคาให้หน่อย" },
    { role: "assistant", content: "เอยเคยทำใบเสนอราคาเลขที่ QT-01000129 สำหรับรายการนี้แล้วค่ะ จึงไม่ออกใบซ้ำให้นะคะ" },
  ]), { ...item, existingQuoteCode: "QT-01000129" });
});

test("quote continuation rejects another product, changed quantity and unrelated replies", () => {
  const offer = { role: "assistant", content: "พบ ใบขัดกระจก PVA SPONGY DISC 4นิ้ว #600 (SKU 2020000917) ค่ะ จำนวน 100 ชิ้น\nให้เอยทำใบเสนอราคาให้เลยไหมคะ" };
  const consent = { role: "user", content: "ทำค่ะ" };
  assert.equal(confirmedGuidedQuoteRequest("ค่ะ", [offer]), null);
  assert.equal(confirmedGuidedQuoteRequest("ครับ", [offer]), null);
  assert.equal(quoteCreationBlockReason("ค่ะ", false, [offer]), "not_explicit_quote_request");
  assert.equal(confirmedGuidedQuoteRequest("ทำใบเสนอราคา SKU 2020000918", [offer, consent]), null);
  assert.equal(confirmedGuidedQuoteRequest("ทำใบเสนอราคา 200 ชิ้น", [offer, consent]), null);
  assert.equal(confirmedGuidedQuoteRequest("ทำใบเสนอราคาใหม่", [offer, consent]), null);
  assert.equal(confirmedGuidedQuoteRequest("ต้องจ่ายเงินก่อนไหม", [offer, consent]), null);
  assert.equal(confirmedGuidedQuoteRequest("ทำใบเสนอราคาให้หน่อย", [offer,
    { role: "user", content: "มีใบเจียร 5 นิ้วไหมครับ" }]), null);
});

test("a belt quantity completes the pending customer quote request without asking for the product again", async () => {
  const history = [
    { role: "user", content: "กระดาษทรายสายพาน 10x330 mm. สีฟ้า No.60 ขอราคา" },
    { role: "assistant", content: "ขอให้คุณเชอร์รี่ตรวจสอบสินค้าเพิ่มเติมก่อนนะคะ" },
    { role: "assistant", content: "ผ้าทรายสายพาน PACO รุ่น Y966 10x330mm. #60 SKU: 2020000905 ราคา 18 บาท/ชิ้น" },
    { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" },
    { role: "assistant", content: "ไม่ทราบว่าคุณลูกค้าต้องการผ้าทรายสายพาน PACO รุ่น Y966 10x330mm. #60 จำนวนกี่ชิ้นดีคะ" },
  ];
  const query = "ต้องการ 100 เส้น";
  const catalogQuery = guidedCatalogQuery(query, history);
  assert.match(catalogQuery ?? "", /Y966/);
  assert.match(catalogQuery ?? "", /#60/);
  assert.equal(guidedRequestedQuantity(query, history, catalogQuery), 100);
  const guided = await guidedProductDecision(query, history, "th",
    q => edge.findProducts(fakeAdmin([pacoBelt]), q));
  assert.notEqual(guided?.result?.selection_required, true);
  assert.equal(guided?.result?.products?.[0]?.sku, "2020000905");
  assert.equal(quoteCreationBlockReason(query, false, history), null);
  const pending = pendingQuoteQuantityRequest(query, history);
  assert.equal(pending?.sku, "2020000905");
  assert.equal(pending?.qty, 100);
});

test("a quantity by itself does not authorize a quote from an unrelated or staff-only turn", () => {
  const question = "ต้องการ 100 เส้น";
  const quantityPrompt = { role: "assistant", content: "ผ้าทรายสายพาน PACO Y966 #60 ต้องการกี่ชิ้นคะ" };
  assert.equal(quoteCreationBlockReason(question, false, [quantityPrompt]), "not_explicit_quote_request");
  assert.equal(quoteCreationBlockReason(question, false, [
    { role: "assistant", content: "Admin: ทำใบเสนอราคาให้ลูกค้าได้เลย" },
    quantityPrompt,
  ]), "not_explicit_quote_request");
  assert.equal(quoteCreationBlockReason(question, false, [
    { role: "user", content: "ผ้าทรายสายพาน PACO Y966 #60 ขอราคา" },
    quantityPrompt,
  ]), "not_explicit_quote_request");
  assert.equal(quoteCreationBlockReason("ต้องการ 100 เส้น ต้องโอนเงินก่อนไหม", false, [
    { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" }, quantityPrompt,
  ]), "payment_question");
  const switched = routeLatestTurn("มีใบเจียร 4 นิ้วไหมครับ", [
    { role: "user", content: "ผ้าทรายสายพาน PACO Y966 #60 ทำใบเสนอราคาให้หน่อยครับ" },
    quantityPrompt,
  ]);
  assert.deepEqual(switched.history, []);
  assert.equal(quoteCreationBlockReason("มีใบเจียร 4 นิ้วไหมครับ", false, switched.history), "not_explicit_quote_request");
});

test("pending belt quotation rejects a card for another model or an already created quote", () => {
  const question = "ต้องการ 100 เส้น";
  const quoteRequest = { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" };
  const quantityPrompt = { role: "assistant", content: "ต้องการผ้าทรายสายพาน PACO Y966 10x330mm. #60 จำนวนกี่ชิ้นคะ" };
  assert.equal(pendingQuoteQuantityRequest(question, [
    { role: "assistant", content: "ผ้าทรายสายพาน PACO Y967 10x330mm. #60 SKU: 2020000905" },
    quoteRequest, quantityPrompt,
  ]), null);
  assert.equal(pendingQuoteQuantityRequest(question, [quoteRequest, quantityPrompt]), null);
  assert.equal(pendingQuoteQuantityRequest(question, [
    { role: "assistant", content: "ผ้าทรายสายพาน PACO Y966 10x330mm. #60 SKU: 2020000905" },
    quoteRequest,
    { role: "assistant", content: "สร้างใบเสนอราคาเลขที่ QT-01000127 แล้วค่ะ" },
    quantityPrompt,
  ]), null);
});

test("quote continuation compares the customer's product with the bot and staff evidence", () => {
  const belt = "ผ้าทรายสายพาน PACO Y966 10x330mm. #60";
  const question = { role: "assistant", content: `ต้องการ${belt} จำนวนกี่ชิ้นคะ` };
  const quote = { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" };
  assert.equal(sameProductReference(belt, "ใบเจียร PACO Y966 10x330mm. #60"), false);
  assert.equal(sameProductReference("ผ้าทรายสายพาน PACO Y966 10x330mm. No.80", belt), false);
  assert.equal(sameProductReference(`${belt} สีฟ้า`, `${belt} สีแดง`), false);
  for (const history of [
    [
      { role: "user", content: `${belt} สีฟ้า ขอราคา` },
      { role: "assistant", content: `ใบเจียร PACO Y966 10x330mm. #60 SKU: 2020000905` },
      quote, question,
    ],
    [
      { role: "user", content: "ผ้าทรายสายพาน PACO Y966 10x330mm. No.80 ขอราคา" },
      { role: "assistant", content: `${belt} SKU: 2020000905` },
      quote, question,
    ],
    [
      { role: "user", content: `${belt} สีฟ้า ขอราคา` },
      { role: "assistant", content: `${belt} สีแดง SKU: 2020000905` },
      quote, question,
    ],
  ]) {
    assert.equal(pendingQuoteQuantityRequest("ต้องการ 100 เส้น", history), null);
  }
});

test("quantity continuation cannot submit a different SKU or quantity before CRM/database access", async () => {
  const history = [
    { role: "user", content: "กระดาษทรายสายพาน 10x330 mm. สีฟ้า No.60 ขอราคา" },
    { role: "assistant", content: "ผ้าทรายสายพาน PACO Y966 10x330mm. #60 SKU: 2020000905" },
    { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" },
    { role: "assistant", content: "ต้องการผ้าทรายสายพาน PACO Y966 10x330mm. #60 จำนวนกี่ชิ้นคะ" },
  ];
  const noDatabase = {
    from() { throw new Error("mismatched continuation must not read CRM data"); },
    rpc() { throw new Error("mismatched continuation must not write a quote"); },
  };
  for (const item of [
    { sku: "2020000906", qty: 100 },
    { sku: "2020000905", qty: 10 },
  ]) {
    const result = await edge.requestQuote(noDatabase, { items: [item] },
      "line", "00000000-0000-4000-8000-000000000001", "ต้องการ 100 เส้น", false, history, true);
    assert.equal(result.reason, "quote_continuation_item_mismatch");
    assert.equal(result.quote_created, false);
    assert.equal(result.skipped, true);
  }
});

test("a linked customer quantity continuation submits the one verified quote item", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const history = [
    { role: "user", content: "กระดาษทรายสายพาน 10x330 mm. สีฟ้า No.60 ขอราคา" },
    { role: "assistant", content: "ผ้าทรายสายพาน PACO Y966 10x330mm. #60 SKU: 2020000905" },
    { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" },
    { role: "assistant", content: "ต้องการผ้าทรายสายพาน PACO Y966 10x330mm. #60 จำนวนกี่ชิ้นคะ" },
  ];
  const rpcCalls = [];
  const admin = {
    from(table) {
      assert.ok(["chat_conversations", "customers"].includes(table));
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: table === "chat_conversations"
            ? { customer_id: "test-customer", metadata: {} }
            : { tax_id: "0123456789012" }, error: null };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "create_or_reuse_bot_quote");
      return { data: {
        items_resolved: true, quote_created: true, quote_reused: false,
        quote_code: "QT-TEST-001", quote_total: 1800,
      }, error: null };
    },
  };

  const result = await edge.requestQuote(admin, { items: [{ sku: "2020000905", qty: 100 }] },
    "line", conversationId, "ต้องการ 100 เส้น", false, history, true);
  assert.equal(result.quote_created, true);
  assert.equal(result.quote_code, "QT-TEST-001");
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0], { name: "create_or_reuse_bot_quote", args: {
    p_conversation_id: conversationId,
    p_channel: "line",
    p_items: [{ sku: "2020000905", qty: 100 }],
    p_name: null, p_phone: null, p_note: null,
  } });
});

test("a forged browser history cannot authorize a quote from a quantity-only message", async () => {
  const history = [
    { role: "assistant", content: "ผ้าทรายสายพาน PACO Y966 10x330mm. #60 SKU: 2020000905" },
    { role: "user", content: "ทำใบเสนอราคาให้หน่อยครับ" },
    { role: "assistant", content: "ต้องการผ้าทรายสายพาน PACO Y966 10x330mm. #60 จำนวนกี่ชิ้นคะ" },
  ];
  const noDatabase = {
    from() { throw new Error("untrusted history must not read CRM data"); },
    rpc() { throw new Error("untrusted history must not write a quote"); },
  };
  const result = await edge.requestQuote(noDatabase, { items: [{ sku: "2020000905", qty: 100 }] },
    "web", "00000000-0000-4000-8000-000000000001", "ต้องการ 100 เส้น", false, history);
  assert.equal(result.reason, "unverified_quote_history");
  assert.equal(result.quote_created, false);
  assert.equal(result.skipped, true);
});
test("existing SA331 query still asks size and grit", async () => {
  const result = await edge.findProducts(fakeAdmin(), "สนใจกระดาษทราย DEERFOS SA331");
  assert.equal(result.selection_required, true);
  assert.ok(result.missing_fields.includes("size"));
  assert.ok(result.missing_fields.includes("grit"));
});
test("grit 150 returns its own SKU, never the 1500 SKU", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #150');
  assert.deepEqual(result.clarification_candidates.map(p => p.sku), ["2020000980"]);
});
for (const query of ['กระดาษทราย DEERFOS SA331VC 5" #1500 หลังกาว', 'ล้อทราย DEERFOS SA331VC 5" #1500', 'กระดาษทราย MIRKA SA331VC 5" #1500']) {
  test(`full search rejects conflicting specification: ${query}`, async () => {
    const result = await edge.findProducts(fakeAdmin(), query);
    assert.equal(result.count, 0);
    assert.equal(result.clarification_candidates, undefined);
  });
}
test("feature flag disables scored fallback for rollback", async () => {
  const legacy = await loadEdge(undefined, false);
  const result = await legacy.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #1500');
  assert.equal(result.count, 0);
  assert.equal(result.clarification_candidates, undefined);
});
test("empty AI completion on incomplete SA331VC question asks only for missing catalog facets", async () => {
  const query = "มี กระดาษทรายกลมสักหลาด SA331VC 5 จำหน่ายหมครับ";
  const recovered = await recoverEmptyProductAnswer(query, [], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.match(recovered.answer, /SA331VC/);
  assert.match(recovered.answer, /เบอร์ความละเอียด/);
  assert.equal(recovered.answer.includes("2020000992"), false);
  assert.equal(recovered.answer.includes("8.5"), false);
});
test("short follow-up after an unanswered product turn reuses only the adjacent customer query", async () => {
  const history = [{ role: "user", content: "มี กระดาษทรายกลมสักหลาด SA331VC 5 จำหน่ายหมครับ" }];
  const recovered = await recoverEmptyProductAnswer("มีไหนครับ", history, "th", q => edge.findProducts(fakeAdmin(), q));
  assert.match(recovered.answer, /เบอร์ความละเอียด/);
  assert.match(recovered.lookupQuery, /SA331/);
  const unrelated = await recoverEmptyProductAnswer("มีไหนครับ", [{ role: "assistant", content: history[0].content }], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.equal(unrelated.answer, null);
});
test("empty AI completion on complete 80-point query offers the one confirmed-choice candidate", async () => {
  const recovered = await recoverEmptyProductAnswer('กระดาษทราย DEERFOS SA331VC 5" #1500', [], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.equal(recovered.result.clarification_candidates[0].sku, "2020000992");
  assert.match(recovered.answer, /1\. กระดาษทรายกลมสักหลาด SA331 5" #1500/);
});
test("numeric-only grit follow-up keeps Thai and completes the previous SA331VC request", async () => {
  const history = [
    { role: "user", content: "มี กระดาษทรายกลมสักหลาด SA331VC 5 จำหน่ายหมครับ" },
    { role: "assistant", content: "สินค้านี้มีหลายตัวเลือกค่ะ ใช้ขนาดเท่าไร และต้องการเบอร์ความละเอียดอะไรคะ" },
  ];
  assert.equal(edge.resolveResponseLanguage('5" #1500', history, "line"), "th");
  const recovered = await recoverEmptyProductAnswer('5" #1500', history, "th", q => edge.findProducts(fakeAdmin(), q));
  assert.deepEqual(recovered.result.clarification_candidates.map(p => p.sku), ["2020000992"]);
  assert.match(recovered.answer, /1\. กระดาษทรายกลมสักหลาด SA331 5" #1500/);
  assert.doesNotMatch(recovered.answer, /Sorry|Please send/);
});
test("SA331 5-inch grit question lists real available grits and correct backing", async () => {
  const query = 'รุ่น SA331 5" มีเบอร์อะไรบ้าง';
  const recovered = await recoverEmptyProductAnswer(query, [], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.match(recovered.answer, /หลังสักหลาด/);
  assert.match(recovered.answer, /#40/);
  assert.match(recovered.answer, /#1500/);
  assert.match(recovered.answer, /#2000/);
  assert.doesNotMatch(recovered.answer, /ใช้ขนาดเท่าไร/);
  assert.doesNotMatch(recovered.answer, /ยังยืนยันรุ่น SA331/);
});
test("SA331 5-inch grit choices paginate and resolve both new and old numbered replies", async () => {
  const query = 'กระดาษทรายกลมสักหลาด SA331 5"';
  const lookup = value => edge.findProducts(fakeAdmin(), value);
  const first = await guidedProductDecision(query, [], "th", lookup);
  assert.equal(first.result.count, 19);
  assert.equal(first.result.match_scan_complete, true);
  assert.deepEqual(first.result.missing_fields, ["grit"]);
  assert.match(first.answer, /หน้า 1\/2/);
  assert.match(first.answer, /11\. แสดงเพิ่มเติม/);
  assert.doesNotMatch(first.answer, /#1500|พิมพ์หมายเลขหน้ารายการ/);
  const firstOptions = first.answer.split(/\r?\n/u).filter(line => /^\d{1,2}\. /u.test(line));
  assert.equal(firstOptions.length, 11);
  assert.deepEqual(firstOptions.slice(0, 10).map(line => Number(/#(\d+)$/u.exec(line)?.[1])),
    [40, 60, 80, 100, 120, 150, 180, 220, 240, 280]);

  const firstHistory = [{ role: "user", content: query }, { role: "assistant", content: first.answer }];
  const moreRoute = routeLatestTurn("แสดงเพิ่มเติม", firstHistory);
  assert.equal(moreRoute.kind, "follow_up");
  const second = await guidedProductDecision("แสดงเพิ่มเติม", moreRoute.history, "th", lookup);
  assert.match(second.answer, /หน้า 2\/2/);
  assert.doesNotMatch(second.answer, /แสดงเพิ่มเติม|^\d+\..*#40$/mu);
  const secondOptions = second.answer.split(/\r?\n/u).filter(line => /^\d{1,2}\. /u.test(line));
  assert.equal(secondOptions.length, 9);
  assert.deepEqual(secondOptions.map(line => Number(/#(\d+)$/u.exec(line)?.[1])),
    [320, 400, 500, 600, 800, 1000, 1200, 1500, 2000]);
  assert.match(secondOptions[7], /^8\..*#1500$/u);

  const typedMore = routeLatestTurn("11", firstHistory);
  assert.equal((await guidedProductDecision("11", typedMore.history, "th", lookup)).answer, second.answer);
  const secondHistory = [...firstHistory, { role: "user", content: "แสดงเพิ่มเติม" },
    { role: "assistant", content: second.answer }];
  const chosenRoute = routeLatestTurn("8", secondHistory);
  const chosen = await guidedProductDecision("8", chosenRoute.history, "th", lookup);
  assert.equal(chosen.result.selection_required, undefined);
  assert.equal(chosen.result.products[0].sku, "2020000992");

  const oldOffer = (await lookup(query)).clarification_question_th;
  const oldRoute = routeLatestTurn("18", [{ role: "user", content: query }, { role: "assistant", content: oldOffer }]);
  assert.equal(oldRoute.kind, "follow_up");
  const oldChoice = await guidedProductDecision("18", oldRoute.history, "th", lookup);
  assert.equal(oldChoice.result.products[0].sku, "2020000992");
});
test("an unavailable SA331 grit still paginates the catalog alternatives", async () => {
  const query = 'กระดาษทรายกลมสักหลาด SA331 5" #999';
  const lookup = value => edge.findProducts(fakeAdmin(), value);
  const first = await guidedProductDecision(query, [], "th", lookup);
  assert.match(first.answer, /ยังไม่พบเบอร์ #999/);
  assert.match(first.answer, /หน้า 1\/2/);
  assert.match(first.answer, /11\. แสดงเพิ่มเติม/);
  assert.doesNotMatch(first.answer, /^\d+\..*#1500$/mu);

  const history = [{ role: "user", content: query }, { role: "assistant", content: first.answer }];
  const more = await guidedProductDecision("แสดงเพิ่มเติม",
    routeLatestTurn("แสดงเพิ่มเติม", history).history, "th", lookup);
  assert.match(more.answer, /หน้า 2\/2/);
  assert.match(more.answer, /^8\..*#1500$/mu);
});
test("adhesive disc question offers the two real model families before asking grit", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(adhesiveCatalog), q);
  const guided = await guidedProductDecision("มีกระดาษทรายหลังกาาว จำหน่ายไหมครับ", [], "th", lookup);
  assert.equal(guided.result.selection_required, true);
  assert.deepEqual(guided.result.missing_fields, ["model"]);
  assert.match(guided.answer, /1\. กระดาษทรายกลมหลังกาว MIRKA GOLD 5"/);
  assert.match(guided.answer, /2\. กระดาษทรายกลมหลังกาว PS36 5"/);
  assert.doesNotMatch(guided.answer, /สักหลาด/);

  const chosen = await guidedProductDecision("2", [
    { role: "user", content: "มีกระดาษทรายหลังกาาว จำหน่ายไหมครับ" },
    { role: "assistant", content: guided.answer },
  ], "th", lookup);
  assert.equal(chosen.result.selection_required, true);
  assert.deepEqual(chosen.result.missing_fields, ["grit"]);
  assert.match(chosen.answer, /1\. กระดาษทรายกลมหลังกาว PS36 5" #60/);
  assert.match(chosen.answer, /7\. กระดาษทรายกลมหลังกาว PS36 5" #220/);

  const typed = await guidedProductDecision("PS36", [
    { role: "user", content: "มีกระดาษทรายหลังกาาว จำหน่ายไหมครับ" },
    { role: "assistant", content: guided.answer },
  ], "th", lookup);
  assert.equal(typed.lookupQuery, "กระดาษทรายกลมหลังกาว PS36 5นิ้ว");
  assert.deepEqual(typed.result.missing_fields, ["grit"]);

  const typedMirka = await guidedProductDecision("MIRKA GOLD", [
    { role: "user", content: "มีกระดาษทรายหลังกาาว จำหน่ายไหมครับ" },
    { role: "assistant", content: guided.answer },
  ], "th", lookup);
  assert.equal(typedMirka.lookupQuery, "กระดาษทรายกลมหลังกาว MIRKA GOLD 5นิ้ว");
  assert.deepEqual(typedMirka.result.missing_fields, ["grit"]);
  const exact = await guidedProductDecision('กระดาษทรายกลมหลังกาว PS36 5" #120', [], "th", lookup);
  assert.equal(exact.answer, null);
  assert.equal(exact.result.products[0].sku, "2020003337");
});
test("a newly requested generic product searches the catalog and offers real choices", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(grindingDiscCatalog), q);
  const first = await guidedProductDecision("มีใบเจียร 4 นิ้วไหมครับ", [], "th", lookup);
  assert.equal(first.result.selection_required, true);
  assert.match(first.answer, /1\. ใบเจียร 4" #80/);
  assert.match(first.answer, /2\. ใบเจียร 4" #120/);
  assert.doesNotMatch(first.answer, /5"|XA945/);

  const history = [
    { role: "user", content: "มีใบเจียร 4 นิ้วไหมครับ" },
    { role: "assistant", content: first.answer },
  ];
  const selected = await guidedProductDecision("เบอร์ 120", history, "th", lookup);
  assert.equal(selected.result.products[0].sku, "2020011112");
  assert.equal(selected.answer, null);
});
test("flap-disc question offers catalog backings before model and grit", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(flapDiscCatalog), q);
  const first = await guidedProductDecision("มีจานทรายซ้อนจำหน่ายไหมครับ", [], "th", lookup);
  assert.equal(first.lookupQuery, "จานทราย");
  assert.deepEqual(first.result.missing_fields, ["backing"]);
  assert.match(first.answer, /1\. จานทรายหลังอ่อน 4 นิ้ว/);
  assert.match(first.answer, /2\. จานทรายหลังแข็ง 4 นิ้ว/);
  assert.doesNotMatch(first.answer, /รบกวนระบุรุ่น ขนาด และเบอร์/);

  const backHistory = [
    { role: "user", content: "มีจานทรายซ้อนจำหน่ายไหมครับ" },
    { role: "assistant", content: first.answer },
  ];
  const soft = await guidedProductDecision("1", backHistory, "th", lookup);
  assert.deepEqual(soft.result.missing_fields, ["model"]);
  assert.match(soft.answer, /จานทรายหลังอ่อน CS310X/);
  assert.match(soft.answer, /จานทรายหลังอ่อน Eco/);
  assert.doesNotMatch(soft.answer, /จานทรายหลังแข็ง/);

  const modelHistory = [...backHistory,
    { role: "user", content: "1" }, { role: "assistant", content: soft.answer },
  ];
  const model = await guidedProductDecision("1", modelHistory, "th", lookup);
  assert.deepEqual(model.result.missing_fields, ["grit"]);
  assert.match(model.answer, /#40/);
  assert.match(model.answer, /11\. แสดงเพิ่มเติม/);
  const moreHistory = [...modelHistory, { role: "user", content: "1" },
    { role: "assistant", content: model.answer }];
  const more = await guidedProductDecision("แสดงเพิ่มเติม",
    routeLatestTurn("แสดงเพิ่มเติม", moreHistory).history, "th", lookup);
  assert.match(more.answer, /#400/);
  assert.doesNotMatch(model.answer, /หลังแข็ง/);

  const exact = await guidedProductDecision('จานทรายหลังอ่อน CS310X 48P 4" #80', [], "th", lookup);
  assert.equal(exact.answer, null);
  assert.equal(exact.result.products.length, 1);
  assert.match(exact.result.products[0].name_th, /หลังอ่อน CS310X.*#80/);

  const eco = await guidedProductDecision('จานทรายหลังอ่อน Eco 4" 46P', modelHistory, "th", lookup);
  assert.deepEqual(eco.result.missing_fields, ["grit"]);
  assert.match(eco.answer, /จานทรายหลังอ่อน Eco.*#80/);
  const hard = await guidedProductDecision('จานทรายหลังแข็ง Eco 4" 72P #80', [], "th", lookup);
  assert.equal(hard.result.products.length, 1);
  assert.match(hard.result.products[0].name_th, /หลังแข็ง Eco.*#80/);
});
test("flap-disc typo and short replies retain the requested grit and size", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(flapDiscCatalog), q);
  const history = [
    { role: "user", content: "มีจานทรายซ้อนจำหน่ายไหมครับ" },
    { role: "assistant", content: "มีจานทรายให้เลือกค่ะ" },
    { role: "user", content: "ต้องการเบอร์ 80" },
    { role: "assistant", content: "เลือกแบบได้เลยค่ะ" },
    { role: "user", content: "จาานรายมีรุ่นไหนบ้างครับ" },
    { role: "assistant", content: "เลือกแบบได้เลยค่ะ" },
  ];
  const size = await guidedProductDecision('ขนาด 4"', history, "th", lookup);
  assert.match(size.lookupQuery, /จานทราย.*4นิ้ว.*#80/);
  assert.deepEqual(size.result.missing_fields, ["backing"]);
  const chosen = await guidedProductDecision("จานทรายหลังอ่อน 4 นิ้ว", [
    ...history, { role: "user", content: 'ขนาด 4"' }, { role: "assistant", content: size.answer },
  ], "th", lookup);
  assert.match(chosen.lookupQuery, /หลังอ่อน.*#80/);
  assert.deepEqual(chosen.result.missing_fields, ["model"]);
  assert.match(chosen.answer, /CS310X.*#80/);
  assert.doesNotMatch(chosen.answer, /หลังแข็ง/);
});
test("numbered flap-disc choices and quantity replies keep the customer's Thai language", () => {
  const history = [
    { role: "user", content: "ต้องการจานทรายซ้อนเบอร์ 80 ครับ" },
    { role: "assistant", content: "1. จานทรายหลังอ่อน 4 นิ้ว\n2. จานทรายหลังแข็ง 4 นิ้ว" },
    { role: "user", content: "1" },
    { role: "assistant", content: '1. จานทรายหลังอ่อน CS310X 48P 4" #80' },
  ];
  assert.equal(edge.resolveResponseLanguage("1", history, "line"), "th");
  assert.equal(edge.resolveResponseLanguage("Eco", history, "line"), "th");
  assert.equal(edge.resolveResponseLanguage("10", history, "line"), "th");
  assert.equal(edge.resolveResponseLanguage("1", [
    { role: "user", content: "Do you have flap discs?" },
    { role: "assistant", content: "1. Soft backing\n2. Hard backing" },
  ], "line"), "en");
});
test("quantity after a confirmed flap-disc SKU stays on that SKU", async () => {
  const product = flapDiscCatalog.find((item) => /หลังอ่อน CS310X.*#80$/u.test(item.name_th));
  const lookup = q => edge.findProducts(fakeAdmin(flapDiscCatalog), q);
  const answer = `พบ ${product.name_th} (SKU ${product.sku}) ค่ะ ต้องการกี่ชิ้นคะ (ขั้นต่ำ 10 ชิ้น)`;
  const history = [
    { role: "user", content: "1" },
    { role: "assistant", content: answer },
  ];
  for (const reply of ["10", "10 ชิ้น"]) {
    const selected = await guidedProductDecision(reply, history, "th", lookup);
    assert.equal(selected.lookupQuery, product.sku);
    assert.equal(selected.result.products.length, 1);
    assert.equal(selected.result.products[0].sku, product.sku);
    assert.equal(guidedRequestedQuantity(reply, history, selected.lookupQuery), 10);
  }
  const belowMinimum = [
    { role: "user", content: "3" },
    { role: "assistant", content: `พบ ${product.name_th} (SKU ${product.sku}) ค่ะ ขั้นต่ำ 10 ชิ้น ต้องการปรับจำนวนเป็นเท่าไรคะ` },
  ];
  assert.equal(guidedCatalogQuery("10", belowMinimum), product.sku);
  assert.equal(guidedRequestedQuantity("10", belowMinimum, product.sku), 10);
});
test("switching product type stops carrying flap-disc size and grit", () => {
  const history = [
    { role: "user", content: "มีจานทรายซ้อนจำหน่ายไหมครับ" },
    { role: "assistant", content: "เลือกจานทรายได้เลยค่ะ" },
    { role: "user", content: "ต้องการเบอร์ 80" },
    { role: "assistant", content: "เลือกแบบได้เลยค่ะ" },
  ];
  assert.equal(guidedCatalogQuery("ขอเปลี่ยนเป็นใบเจียร 4 นิ้ว", history), "ใบเจียร 4 นิ้ว");
  assert.equal(guidedCatalogQuery("ขอเป็นใบเจียร 4 นิ้ว", history), "ใบเจียร 4 นิ้ว");
  assert.equal(guidedCatalogQuery("ขนาด 5 นิ้ว", [
    ...history,
    { role: "user", content: "ขอเปลี่ยนเป็นใบเจียร 4 นิ้ว" },
    { role: "assistant", content: "กำลังดูใบเจียรค่ะ" },
  ]), "ใบเจียร 5นิ้ว");
  assert.equal(guidedCatalogQuery("ขนาด 5 นิ้ว", [
    ...history,
    { role: "user", content: "ขอเปลี่ยนเป็นสว่านลม" },
    { role: "assistant", content: "กำลังดูสว่านลมค่ะ" },
  ]), "สว่านลม 5นิ้ว");
});
test("changing only the grit keeps the latest flap-disc model and size", () => {
  const history = [
    { role: "user", content: 'จานทรายหลังอ่อน XA945 4" #80' },
    { role: "assistant", content: "พบจานทรายหลังอ่อน XA945 ค่ะ" },
  ];
  for (const query of ["ขอเปลี่ยนเป็นเบอร์ 120", "เปลี่ยนเป็น #120", "เปลี่ยนเบอร์เป็น #120"]) {
    const guided = guidedCatalogQuery(query, history);
    assert.match(guided ?? "", /XA945/);
    assert.match(guided ?? "", /4(?:"|นิ้ว)/);
    assert.match(guided ?? "", /#120/);
    assert.doesNotMatch(guided ?? "", /#80/);
  }
});
test("unavailable flap-disc grit offers real backing choices before staff handoff", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(flapDiscCatalog), q);
  const result = await guidedProductDecision("จานทราย #800", [], "th", lookup);
  assert.match(result.answer, /ยังไม่พบเบอร์ #800/);
  assert.match(result.answer, /1\. จานทรายหลังอ่อน/);
  assert.match(result.answer, /2\. จานทรายหลังแข็ง/);
  assert.equal(result.escalate, undefined);
});
test("unavailable #800 offers verified adhesive models instead of escalating immediately", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(adhesiveCatalog), q);
  const result = await guidedProductDecision('ต้องการหลังกาว 5" #800 ครับ', [
    { role: "user", content: "มีกระดาษทรายหลังกาวไหมครับ" },
    { role: "assistant", content: "มีสินค้าหลังกาวให้เลือกค่ะ" },
  ], "th", lookup);
  assert.match(result.answer, /ยังไม่พบเบอร์ #800/);
  assert.match(result.answer, /MIRKA GOLD/);
  assert.match(result.answer, /PS36/);
  assert.doesNotMatch(result.answer, /เชอร์รี่|ไม่มีสินค้า/);
  const insisted = await guidedProductDecision('ต้องเป็นหลังกาว 5" #800 เท่านั้น', [], "th", lookup);
  assert.equal(insisted.escalate, true);
  assert.equal(insisted.answer, null);
});
test("Mika follow-up stays in adhesive catalog and offers actual MIRKA GOLD grits", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(adhesiveCatalog), q);
  const result = await guidedProductDecision("แล้วรุ่น Mika มีไหมครับ", [
    { role: "user", content: 'ต้องการหลังกาว 5" #800 ครับ' },
    { role: "assistant", content: "มีรุ่นที่ต้องการให้เลือกค่ะ" },
  ], "th", lookup);
  assert.equal(result.result.selection_required, true);
  assert.match(result.answer, /MIRKA GOLD 5" #80/);
  assert.match(result.answer, /11\. แสดงเพิ่มเติม/);
  const history = [
    { role: "user", content: 'ต้องการหลังกาว 5" #800 ครับ' },
    { role: "assistant", content: "มีรุ่นที่ต้องการให้เลือกค่ะ" },
    { role: "user", content: "แล้วรุ่น Mika มีไหมครับ" },
    { role: "assistant", content: result.answer },
  ];
  const more = await guidedProductDecision("แสดงเพิ่มเติม",
    routeLatestTurn("แสดงเพิ่มเติม", history).history, "th", lookup);
  assert.match(more.answer, /MIRKA GOLD 5" #500/);
  assert.doesNotMatch(result.answer, /สักหลาด/);
});
test("quantity reply keeps the confirmed SKU and quotes only a matching resolver result", async () => {
  const history = [
    { role: "user", content: 'กระดาษทรายกลมหลังกาว PS36 5" #120' },
    { role: "assistant", content: "พบสินค้า SKU 2020003337 ค่ะ ต้องการกี่ชิ้นคะ" },
  ];
  assert.equal(guidedCatalogQuery("100 ชิ้น", history), 'กระดาษทรายกลมหลังกาว PS36 5นิ้ว #120');
  assert.equal(guidedRequestedQuantity("100 ชิ้น", history), 100);
  const guided = await guidedProductDecision("100 ชิ้น", history, "th",
    q => edge.findProducts(fakeAdmin(adhesiveCatalog), q));
  assert.equal(guided.result.products[0].sku, "2020003337");
  const product = { ...guided.result.products[0], stock: 800, unit: "ชิ้น", min_order_qty: 100 };
  const answer = guidedExactProductAnswer(product, 100, {
    ok: true, exact_match: true, sku: "2020003337", unit_price: 8.5,
  });
  assert.match(answer, /SKU 2020003337/);
  assert.match(answer, /ราคา 8\.5 บาท\/ชิ้น/);
  assert.match(answer, /สต็อกที่ตรวจได้ 800 ชิ้น/);
  assert.match(answer, /ให้เอยทำใบเสนอราคาให้เลยไหมคะ/);
  assert.equal(guidedExactProductAnswer(product, 100, { ok: true, exact_match: true, sku: "wrong", unit_price: 8.5 }), null);
  assert.doesNotMatch(guidedExactProductAnswer(product), /8\.5/);
  assert.deepEqual(confirmedGuidedQuoteRequest("ได้เลยครับ", [
    { role: "assistant", content: answer },
  ]), { sku: "2020003337", qty: 100 });
  assert.equal(confirmedGuidedQuoteRequest("ได้เลยครับ", [
    { role: "assistant", content: "อยากให้ทำใบเสนอราคาไหมคะ" },
  ]), null);
});
test("model choice keeps an already supplied grit and quantity", async () => {
  const lookup = q => edge.findProducts(fakeAdmin(adhesiveCatalog), q);
  const first = await guidedProductDecision('ขอกระดาษทรายหลังกาว 5" #120 100 ชิ้น', [], "th", lookup);
  assert.match(first.answer, /1\. กระดาษทรายกลมหลังกาว MIRKA GOLD 5" #120/);
  assert.match(first.answer, /2\. กระดาษทรายกลมหลังกาว PS36 5" #120/);
  const history = [
    { role: "user", content: 'ขอกระดาษทรายหลังกาว 5" #120 100 ชิ้น' },
    { role: "assistant", content: first.answer },
  ];
  const chosen = await guidedProductDecision("2", history, "th", lookup);
  assert.equal(chosen.result.products[0].sku, "2020003337");
  assert.equal(guidedRequestedQuantity("2", history, chosen.lookupQuery), 100);
  const twoStepHistory = [
    history[0], history[1],
    { role: "user", content: 'กระดาษทรายกลมหลังกาว PS36 5"' },
    { role: "assistant", content: 'พบ PS36 ค่ะ เลือกเบอร์ที่ต้องการ' },
  ];
  assert.equal(guidedRequestedQuantity('กระดาษทรายกลมหลังกาว PS36 5" #120', twoStepHistory), 100);
  assert.equal(guidedRequestedQuantity('กระดาษทรายกลมหลังกาว MIRKA GOLD 5" #120', [
    { role: "user", content: 'กระดาษทรายกลมหลังกาว PS36 5" #120 100 ชิ้น' },
    { role: "assistant", content: "เลือกรุ่นได้ค่ะ" },
  ]), null);
});
