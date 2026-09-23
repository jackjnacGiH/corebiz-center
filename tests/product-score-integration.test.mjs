import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { recoverEmptyProductAnswer } from "../supabase/functions/_shared/empty-product-recovery.mjs";
import {
  confirmedGuidedQuoteRequest, guidedCatalogQuery, guidedExactProductAnswer,
  guidedProductDecision, guidedRequestedQuantity,
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
const productFields = ["sku", "name_th", "name_en", "brand"];

async function loadEdge(source = readFileSync(sourceUrl, "utf8"), scoring = true) {
  const bundle = await build({ stdin: {
    contents: source + "\nexport { findProducts, productFamilyFor, productTypeFor, resolveResponseLanguage };",
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
  const exact = await guidedProductDecision('กระดาษทรายกลมหลังกาว PS36 5" #120', [], "th", lookup);
  assert.equal(exact.answer, null);
  assert.equal(exact.result.products[0].sku, "2020003337");
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
  assert.match(model.answer, /#400/);
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
  assert.match(result.answer, /MIRKA GOLD 5" #500/);
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
