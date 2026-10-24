import assert from "node:assert/strict";
import test from "node:test";
import { database, conversationId } from "./helpers/critical-company-fixtures.mjs";
import { ragRuntime } from "./helpers/rag-critical-runtime.mjs";
import { quoteCreationBlockReason } from "../supabase/functions/_shared/guided-product-selection.mjs";

const link = "https://www.jnac.online/p/2020004210";
const linkedProduct = { sku: "2020004210", name_th: "ล้อทรายทดสอบ 12x10x3 มม เบอร์ 120", name_en: "Synthetic mounted wheel", unit: "แพ็ค", min_order_qty: 1, stock: null, spec: {} };
const price = { response: { ok: true, exact_match: true, sku: linkedProduct.sku, quantity: 1, unit_price: 10, line_total: 10, currency: "THB" } };

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
