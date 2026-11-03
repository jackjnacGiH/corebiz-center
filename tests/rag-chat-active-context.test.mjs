import assert from "node:assert/strict";
import test from "node:test";
import { database, conversationId } from "./helpers/critical-company-fixtures.mjs";
import { ragRuntime } from "./helpers/rag-critical-runtime.mjs";
import { guidedExactProductAnswer, quoteCreationBlockReason } from "../supabase/functions/_shared/guided-product-selection.mjs";
import { activeItemContext, requestedQuantity } from "../supabase/functions/_shared/active-item-context.mjs";

const link = "https://www.jnac.online/p/2020004210";
const linkedProduct = { sku: "2020004210", name_th: "ล้อทรายทดสอบ 12x10x3 มม เบอร์ 120", name_en: "Synthetic mounted wheel", unit: "แพ็ค", min_order_qty: 1, stock: null, spec: {} };
const price = { response: { ok: true, exact_match: true, sku: linkedProduct.sku, quantity: 1, unit_price: 10, line_total: 10, currency: "THB" } };

test("quantity cannot start inside a SKU, code, signed number or fractional number", () => {
  for (const text of ["SKU 2020002618 ม้วนครับ", "2020002618 ม้วน", "SKU AB-120ชิ้น", "P120ชิ้น", "12.5ชิ้น", "1/2ชิ้น", "1,000ชิ้น", "-4ม้วน", "+4ชิ้น", "−4ชิ้น", "10x330ชิ้น"]) {
    assert.equal(requestedQuantity(text), null, text);
  }
  for (const text of ["ต้องการ4ม้วน", "จำนวน4ม้วนครับ", "SKU 2020002618 จำนวน4ม้วน", "4 ม้วนค่ะ"]) {
    assert.deepEqual(requestedQuantity(text), { quantity: 4, unit: "ม้วน", original_unit: "ม้วน" }, text);
  }
});

test("verified exact-SKU cards replace superseded descriptors before a quantity follow-up", async () => {
  const canonical = { ...linkedProduct, unit: "ชิ้น" };
  const answer = guidedExactProductAnswer(canonical, null, price.response, "th");
  for (const description of ["กระดาษทราย #400", "สายพาน PACO SA331 99x88x3 มม #400"]) {
    const db = database();
    const runtime = await ragRuntime(db, [], {
      getProductDetail: async () => canonical,
      getExactPrice: async (_admin, args) => ({ response: { ...price.response, quantity: args.qty, line_total: args.qty * 10 } }),
    });
    const { data } = await runtime.request({ query: "10 ชิ้น", history: [
      { role: "user", content: `สนใจ SKU ${canonical.sku} ${description}` },
      { role: "assistant", content: answer, verified_product: { source: "catalogue", sku: canonical.sku } },
    ], conversation_id: conversationId, channel: "line", stream: false });
    assert.equal(data.active_item.sku, canonical.sku);
    assert.match(data.answer, /เบอร์ 120/);
    assert.match(data.answer, /10 ชิ้น/);
    assert.doesNotMatch(data.answer, /เจ้าหน้าที่|สลับสินค้า|รายการใด/);
    assert.equal(db.calls.length, 0);
    assert.equal(runtime.trace.modelCalls, 0);
  }
});

test("exact-SKU verification keeps only its adjacent customer quantity and quote intent", () => {
  const sku = linkedProduct.sku;
  const first = `ขอใบเสนอราคา SKU ${sku} จำนวน 99 ชิ้น #400`;
  const latest = `ตัวนี้ SKU ${sku} กระดาษทราย #400`;
  const card = { role: "assistant", content: "พบสินค้าตาม SKU ต้องการกี่ชิ้นคะ", verified_product: { source: "catalogue", sku } };
  const state = activeItemContext("ครับ", [
    { role: "user", content: first },
    { role: "assistant", content: "รับข้อมูลสินค้าแล้วค่ะ" },
    { role: "user", content: latest },
    card,
  ]);
  assert.equal(state.facts.requested_sku.value, sku);
  assert.equal(state.facts.quantity, undefined);
  assert.equal(state.facts.unit, undefined);
  assert.equal(state.facts.grit, undefined);
  assert.equal(state.quote_pending, false);
  assert.equal(state.quote_evidence, null);
  assert.equal(state.identity, null);
  assert.equal(state.multiple, false);
  assert.deepEqual(state.conflicting, []);
  const explicitQuote = `ขอใบเสนอราคา SKU ${sku} จำนวน 4 ชิ้น #400`;
  const withQuantity = activeItemContext("ครับ", [{ role: "user", content: explicitQuote }, card]);
  assert.equal(withQuantity.facts.quantity.value, 4);
  assert.equal(withQuantity.facts.unit.value, "piece");
  assert.equal(withQuantity.quote_pending, true);
  assert.equal(withQuantity.quote_evidence, explicitQuote);
});

test("a later conflicting specification remains a review after an exact-SKU card", async () => {
  const db = database();
  const canonical = { ...linkedProduct, unit: "ชิ้น" };
  const runtime = await ragRuntime(db, [], { getProductDetail: async () => canonical });
  const { data } = await runtime.request({ query: "ตัวนี้เบอร์ 150 ค่ะ", history: [
    { role: "user", content: `SKU ${canonical.sku} #400` },
    { role: "assistant", content: guidedExactProductAnswer(canonical, null, price.response, "th"), verified_product: { source: "catalogue", sku: canonical.sku } },
  ], conversation_id: conversationId, stream: false });
  assert.equal(data.model, "guardrail:active_item_review");
  assert.equal(db.calls[0].args.p_payload.review_kind, "product_specification");
});

test("verification of one SKU cannot clear an explicit additional-product request", () => {
  const sku = linkedProduct.sku;
  const state = activeItemContext("10 ชิ้น", [
    { role: "user", content: `SKU ${sku} และอีกสินค้า ขอเพิ่มอีกเป็นกระดาษทราย` },
    { role: "assistant", content: "สินค้าแรกค่ะ", verified_product: { source: "catalogue", sku } },
  ]);
  assert.equal(state.multiple, true);
});

test("the real handler resolves a customer URL in Thai without waiting for the old bot answer", async () => {
  const lookedUp = [];
  const runtime = await ragRuntime(database(), [], {
    getProductDetail: async (_admin, sku) => { lookedUp.push(sku); return linkedProduct; },
    getExactPrice: async () => price,
  });
  const { data } = await runtime.request({ query: link, history: [{ role: "user", content: "สวัสดีค่ะ สนใจสินค้าค่ะ" }], conversation_id: conversationId, channel: "line", stream: false });
  assert.deepEqual(lookedUp, [linkedProduct.sku]);
  assert.match(data.answer, /พบ.*ค่ะ/);
  assert.doesNotMatch(data.answer, /I found|How many/);
  assert.deepEqual(data.active_item, { source: "catalogue", sku: linkedProduct.sku });
  assert.equal(runtime.trace.modelCalls, 0);
});

test("rapid URL plus quotation uses the known item/unit and reuses server billing, with no invented pack conversion", async () => {
  const requests = [];
  const runtime = await ragRuntime(database(), [], {
    getProductDetail: async () => linkedProduct,
    requestQuote: async (_admin, args) => { requests.push(args); return { quote_created: true, quote_code: "QT-TEST" }; },
  });
  const { data } = await runtime.request({ query: "ขอใบเสนอราคาตัวนี้ 1 แพ็คค่ะ", history: [{ role: "user", content: link }], conversation_id: conversationId, channel: "line", stream: false });
  assert.deepEqual(requests[0].items, [{ sku: linkedProduct.sku, qty: 1 }]);
  assert.match(data.answer, /QT-TEST/);
  assert.doesNotMatch(data.answer, /ชื่อบริษัท|เลขผู้เสียภาษี|SKU.*อะไร/);
  assert.equal(runtime.trace.modelCalls, 0);
  const db = database();
  const unverifiedPack = await ragRuntime(db, [], { getProductDetail: async () => ({ ...linkedProduct, unit: "ชิ้น" }) });
  const result = await unverifiedPack.request({ query: "ขอใบเสนอราคาตัวนี้ 1 แพ็คค่ะ", history: [{ role: "user", content: link }], conversation_id: conversationId, stream: false });
  assert.match(result.data.answer, /กำลังรอเจ้าหน้าที่รับเรื่อง/);
  assert.equal(db.calls[0].args.p_kind, "ops.chat_followup");
});

test("pieces per pack and conflicting specification questions go to real review, never unrelated menus", async () => {
  for (const query of ["1 แพ็คมีกี่ตัวคะ", "ตัวนี้เบอร์ 150 ค่ะ"]) {
    const db = database();
    const runtime = await ragRuntime(db, [], { getProductDetail: async () => linkedProduct });
    const { data } = await runtime.request({ query, history: [{ role: "user", content: link }], conversation_id: conversationId, stream: false });
    assert.match(data.answer, /กำลังรอเจ้าหน้าที่รับเรื่อง/);
    assert.doesNotMatch(data.answer, /1\.|2\.|แนะนำสินค้า|ชิ้นต่อแพ็ค/);
    assert.equal(db.calls[0].args.p_payload.review_kind, "product_specification");
  }
});

test("verified catalogue metadata preserves image-to-text context without trusting generated SKU prose", async () => {
  const runtime = await ragRuntime(database(), [], {
    getProductDetail: async () => ({ ...linkedProduct, unit: "ชิ้น" }),
    getExactPrice: async (_admin, args) => ({ response: { ...price.response, quantity: args.qty, line_total: args.qty * 10 } }),
  });
  const { data } = await runtime.request({ query: "ต้องการ 10 ตัวค่ะ", history: [
    { role: "user", content: "![image](https://example.invalid/synthetic-image)" },
    { role: "assistant", content: `พบสินค้า SKU ${linkedProduct.sku} ต้องการกี่ตัวคะ`, verified_product: { source: "catalogue", sku: linkedProduct.sku } },
  ], conversation_id: conversationId, channel: "line", stream: false });
  assert.match(data.answer, /10 ชิ้น/);
  assert.doesNotMatch(data.answer, /ต้องการกี่|สินค้ารุ่นไหน/);
});

test("human request uses a verified queue receipt with the actual known specs; native OA remains untouched", async () => {
  for (const options of [{}, { rpcError: true }]) {
    const db = database(options), runtime = await ragRuntime(db);
    const { data } = await runtime.request({ query: "ขอคุยกับเจ้าหน้าที่ค่ะ", history: [
      { role: "user", content: "ล้อทรายแกน 3 มม เบอร์ 150" },
      { role: "assistant", content: "ขอตรวจสอบสเปกค่ะ" },
      { role: "user", content: "ค่ะ ต้องการ 10 ตัวค่ะ" },
    ], conversation_id: conversationId, stream: false });
    assert.match(data.answer, options.rpcError ? /ยังยืนยันการบันทึกคำขอ/ : /กำลังรอเจ้าหน้าที่รับเรื่อง/);
    assert.match(db.calls[0].args.p_summary, /150/);
    assert.match(db.calls[0].args.p_summary, /10/);
    assert.equal(db.calls[0].args.p_kind, "ops.chat_followup");
  }
});

test("billing details continue a genuine pending quotation, but cannot invent quote consent", () => {
  const details = "ชื่อบริษัท: ลูกค้าทดสอบ ที่อยู่ออกบิล: ทดสอบ เลขผู้เสียภาษี: ทดสอบ";
  const history = [{ role: "user", content: "ขอใบเสนอราคาตัวนี้ 1 แพ็ค" }, { role: "assistant", content: "รบกวนแจ้งชื่อบริษัท ที่อยู่ออกบิล และเลขผู้เสียภาษีค่ะ" }];
  assert.equal(quoteCreationBlockReason(details, false, history), null);
  assert.equal(quoteCreationBlockReason(details, false, []), "not_explicit_quote_request");
  assert.equal(quoteCreationBlockReason(details, true, history), "image_or_document");
});

test("a superseded generation cannot persist or publish a stale answer", async () => {
  const runtime = await ragRuntime(database(), [{ text: "Stale generated answer" }], { currentConversationTurn: async () => false });
  const { data, events } = await runtime.request({ query: "hello", session_id: "synthetic-session", stream: true });
  assert.equal(data.answer, "");
  assert.equal(runtime.trace.saved.filter(message => message.sender === "bot").length, 0);
  assert.equal(events.find(event => event.type === "paused")?.reason, "stale_conversation_turn");
});
