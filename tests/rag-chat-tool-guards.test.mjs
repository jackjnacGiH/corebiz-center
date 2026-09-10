import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  prioritizeProductToolCalls,
  productIdentitySearchText,
} from "../supabase/functions/_shared/product-selection.mjs";
import {
  mergeFacetOnlyProductQuery,
  pendingProductQuestion,
} from "../supabase/functions/_shared/product-turn-context.mjs";

const source = readFileSync(
  new URL("../supabase/functions/rag-chat/index.ts", import.meta.url),
  "utf8",
);

test("exact model rejects neighbouring codes first but still passes family and type gates", () => {
  const start = source.indexOf("function evaluateProductMatch");
  const end = source.indexOf("function formatSafeProductForLLM", start);
  const body = source.slice(start, end);

  const exactSku = body.indexOf("if (exactSku)");
  const modelMismatch = body.indexOf("if (requestedModelCodes.length > 0 && !exactModel)");
  const familyGate = body.indexOf("if (requestedFamily && requestedFamily !== candidateFamily)");
  const productTypeGate = body.indexOf("if (requestedProductType && requestedProductType !== candidateProductType)");
  const exactModelAcceptance = body.indexOf("if (exactModel) return");

  assert.ok(exactSku >= 0 && modelMismatch > exactSku);
  assert.ok(familyGate > modelMismatch);
  assert.ok(productTypeGate > familyGate);
  assert.ok(exactModelAcceptance > productTypeGate);
  assert.match(body.slice(exactSku, modelMismatch), /hasExactModelCodeMatch/);
  assert.doesNotMatch(body.slice(exactSku, familyGate), /basis: "exact_model"/);
});

test("the first model response is buffered until function calls are known", () => {
  const start = source.indexOf("const r = await streamGeminiWithFallback");
  const end = source.indexOf("llm_ms +=", start);
  const callback = source.slice(start, end);

  assert.match(callback, /iterText \+= chunk/);
  assert.match(callback, /firstTokenMs === null/);
  assert.doesNotMatch(callback, /appendAnswer\s*\(\s*chunk\s*\)/);
  assert.doesNotMatch(source, /bufferForProductSafety|appendedDuringGeneration/);
});

test("facet-only follow-up carries the adjacent clarified product identity", () => {
  const history = [
    { role: "user", content: "สนใจกระดาษทราย DEERFOS SA331" },
    { role: "assistant", content: "สินค้านี้มีหลายตัวเลือกค่ะ ใช้ขนาดเท่าไร และต้องการเบอร์ความละเอียดอะไรคะ" },
  ];

  assert.equal(
    mergeFacetOnlyProductQuery("5 นิ้ว เบอร์ 120", history),
    "กระดาษทราย DEERFOS SA331 5 นิ้ว เบอร์ 120",
  );
  const colloquialFollowUp = mergeFacetOnlyProductQuery("เอา 5 นิ้ว เบอร์ 120 ครับ", history);
  assert.equal(colloquialFollowUp, "กระดาษทราย DEERFOS SA331 5 นิ้ว เบอร์ 120");
  assert.equal(productIdentitySearchText(colloquialFollowUp), "กระดาษทราย DEERFOS SA331");
  for (const followUp of [
    "5-inch",
    "5 in.",
    "grit: 120",
    "grit=120",
    "ขนาด: 5 นิ้ว",
    "ขนาด=5 นิ้ว",
    "เบอร์: 120",
    "เบอร์=120",
    "5-inch grit: 120",
    "5 in. grit=120",
    "ขนาด: 5 นิ้ว เบอร์: 120",
    "ขนาด=5 นิ้ว เบอร์=120",
  ]) {
    assert.equal(
      mergeFacetOnlyProductQuery(followUp, history),
      `กระดาษทราย DEERFOS SA331 ${followUp}`,
    );
  }
});

test("multi-turn product identity carry-forward fails closed across topic changes", () => {
  const clarificationHistory = [
    { role: "user", content: "สนใจกระดาษทราย DEERFOS SA331" },
    { role: "assistant", content: "สินค้านี้มีหลายตัวเลือกค่ะ ใช้ขนาดเท่าไร และต้องการเบอร์ความละเอียดอะไรคะ" },
  ];
  assert.equal(
    mergeFacetOnlyProductQuery("เทป 5 นิ้ว เบอร์ 120", clarificationHistory),
    "เทป 5 นิ้ว เบอร์ 120",
  );
  assert.equal(
    mergeFacetOnlyProductQuery("SA332 5 นิ้ว เบอร์ 120", clarificationHistory),
    "SA332 5 นิ้ว เบอร์ 120",
  );
  assert.equal(
    mergeFacetOnlyProductQuery("5 นิ้ว เบอร์ 120", [
      { role: "user", content: "สนใจกระดาษทราย DEERFOS SA331" },
      { role: "assistant", content: "เดี๋ยวให้พนักงานติดต่อกลับนะคะ" },
    ]),
    "5 นิ้ว เบอร์ 120",
  );
  assert.equal(
    mergeFacetOnlyProductQuery("5 นิ้ว เบอร์ 120", [
      { role: "user", content: "เปรียบเทียบ SA331 กับ SA332" },
      { role: "assistant", content: "สินค้านี้มีหลายตัวเลือกค่ะ ใช้ขนาดเท่าไร และต้องการเบอร์ความละเอียดอะไรคะ" },
    ]),
    "5 นิ้ว เบอร์ 120",
  );
});

test("fuzzy candidate selection always becomes a deterministic customer question", () => {
  const question = pendingProductQuestion({
    clarification_candidates: [
      { sku: "2020000979", name_th: "กระดาษทรายกลมสักหลาด SA331 5 นิ้ว #120" },
      { sku: "2020000980", name_th: "กระดาษทรายกลมสักหลาด SA332 5 นิ้ว #120" },
    ],
  }, "th");

  assert.match(question, /รบกวนเลือกสินค้า/);
  assert.match(question, /1\. .*2020000979/);
  assert.match(question, /2\. .*2020000980/);
  assert.doesNotMatch(question, /พนักงาน|ติดต่อกลับ|ส่งต่อ/);
});

test("tool-loop buffers one final text event and rewrites contextual product lookup args", () => {
  const start = source.indexOf("const contextualProductQuery");
  const end = source.indexOf("const generationMs", start);
  const loop = source.slice(start, end);

  assert.match(loop, /call\.name === "find_products" && hasContextualProductQuery/);
  assert.match(loop, /dispatchTool\(admin, call\.name, effectiveArgs/);
  assert.match(loop, /args: effectiveArgs/);
  assert.match(loop, /lookupDisposition === "needs_selection" && !forcedSelectionQuestion/);
  assert.match(loop, /pendingProductQuestion\(selection, lang\)/);
  assert.match(loop, /clarificationRows[\s\S]*selectedSkus/);
  assert.equal((loop.match(/send\(\{ type: "text"/g) ?? []).length, 1);
  assert.match(loop, /if \(fullAnswer\) send\(\{ type: "text", chunk: fullAnswer \}\)/);
});

test("explicit callback remains a deterministic guard before the model tool loop", () => {
  const callbackStart = source.indexOf("if (query && images.length === 0 && isCallbackRequest(query))");
  const callbackEnd = source.indexOf("const setupStartedAt", callbackStart);
  const callbackGuard = source.slice(callbackStart, callbackEnd);
  const toolLoop = source.indexOf("const contextualProductQuery");

  assert.ok(callbackStart >= 0 && callbackStart < toolLoop);
  assert.match(callbackGuard, /await captureLead\(/);
  assert.match(callbackGuard, /model: "guardrail:callback_lead"/);
  assert.match(callbackGuard, /return;/);
});

test("product lookups run before mutations regardless of model call order", () => {
  const calls = [
    { name: "capture_lead", args: {} },
    { name: "request_quote", args: {} },
    { name: "find_products", args: { query: "SA331" } },
    { name: "get_product_detail", args: { sku: "2020000979" } },
  ];

  assert.deepEqual(
    prioritizeProductToolCalls(calls).map(({ call }) => call.name),
    ["find_products", "get_product_detail", "capture_lead", "request_quote"],
  );
});

test("selection blocking stays sticky and suppressed tools are never recorded", () => {
  const start = source.indexOf("let productSelectionPending = false");
  const end = source.indexOf("fullAnswer = sanitizePaymentReceiptAnswer", start);
  const loop = source.slice(start, end);

  assert.match(loop, /if \(lookupDisposition === "needs_selection"\) productSelectionPending = true/);
  assert.deepEqual(
    loop.match(/productSelectionPending\s*=\s*(?:true|false)/g),
    ["productSelectionPending = false", "productSelectionPending = true"],
  );
  assert.match(loop, /productSelectionPending \? "needs_selection" : "none"/);
  assert.match(loop, /if \(executed\) \{[\s\S]*allToolCalls\.push/);
  assert.match(loop, /result_meta: resultMeta/);
  assert.match(loop, /missing_fields: Array\.isArray\(selection\?\.missing_fields\)/);
});
