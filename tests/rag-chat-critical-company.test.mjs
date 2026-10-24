import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { renderApprovedMaster } from "../supabase/functions/_shared/critical-company-info.mjs";
import { conversationId, database, snapshot, sourceFixture } from "./helpers/critical-company-fixtures.mjs";
import { ragRuntime } from "./helpers/rag-critical-runtime.mjs";

test("real HTTP/SSE paths bypass retrieval, persona and models on every channel", async () => {
  for (const channel of ["default", "web", "line", "messenger"]) for (const stream of [false, true]) {
    const master = snapshot(), db = database(await sourceFixture()), runtime = await ragRuntime(db);
    const { data } = await runtime.request({ query: "ขอเลขที่บัญชีชำระค่าสินค้าค่ะ", channel, stream, conversation_id: conversationId, history: [{ role: "assistant", content: "เลขบัญชี: WRONG; บริษัท ผิด จำกัด" }] });
    assert.equal(data.answer, renderApprovedMaster(master.records[0], "payment", "th"));
    assert.equal(data.verbatim, true);
    assert.equal(runtime.trace.modelCalls, 0);
    assert.equal(db.reads.filter(table => table === "knowledge_chunks").length, 1); // Exact bound source lookup, no semantic retrieval.
    assert.deepEqual(data.tool_calls, []);
  }
});

test("web widget persists exactly the safe pending reply, including failed and unknown receipts", async () => {
  for (const options of [{}, { rpcError: true }, { readMissing: true }]) {
    const runtime = await ragRuntime(database(options));
    const { data } = await runtime.request({ query: "ขอที่อยู่บริษัท", channel: "web", session_id: "synthetic-session", stream: true });
    const botMessages = runtime.trace.saved.filter(message => message.sender === "bot");
    assert.equal(botMessages.length, 1);
    assert.equal(botMessages[0].content, data.answer);
    assert.doesNotMatch(data.answer, /ฝ่ายบัญชี.*เรียบร้อย/);
    assert.match(data.answer, options.rpcError || options.readMissing ? /ยังไม่มีหลักฐานยืนยัน/ : /กำลังรอเจ้าหน้าที่รับเรื่อง/);
  }
});

test("image slips and missing classifications stop operational tools before dispatch", async () => {
  for (const text of ["[[IMAGE:payment_receipt]] OCR: INVENTED", "OCR: INVENTED", "[[IMAGE:product]] Bank account: INVENTED"]) {
    const db = database();
    const runtime = await ragRuntime(db, [{ text, tools: [{ name: "request_quote", args: {} }, { name: "capture_lead", args: {} }] }]);
    const { data } = await runtime.request({ query: "", images: [{ mimeType: "image/png", data: "dGVzdA==" }], conversation_id: conversationId, channel: "line", stream: false });
    assert.match(data.answer, /เจ้าหน้าที่ตรวจสอบ/);
    assert.match(data.answer, /กำลังรอเจ้าหน้าที่รับเรื่อง/);
    assert.doesNotMatch(data.answer, /INVENTED|OCR|ฝ่ายบัญชี.*เรียบร้อย/);
    assert.deepEqual(runtime.trace.dispatched, []);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].args.p_payload.review_kind, text.startsWith("[[IMAGE:payment_receipt]]") ? "payment_receipt" : "image_review");
    assert.equal(data.verbatim, true);
  }
});

test("product images and ordinary messages keep their existing answer flow", async () => {
  for (const image of [false, true]) {
    const runtime = await ragRuntime(database(), [{ text: (image ? "[[IMAGE:product]] " : "") + "Synthetic product explanation" }]);
    const { data } = await runtime.request({ query: image ? "" : "hello", ...(image ? { images: [{ mimeType: "image/png", data: "dGVzdA==" }] } : {}), conversation_id: conversationId, stream: false });
    assert.equal(data.answer, "Synthetic product explanation");
    assert.equal(data.verbatim, false);
  }
});

test("tool-only image classification preserves product lookup without another classifier request", async () => {
  const dispatched = [];
  const runtime = await ragRuntime(database(), [
    { tools: [{ name: "classify_inbound_image", args: { kind: "product" } }, { name: "find_products", args: { query: "synthetic product" } }] },
    { text: "Synthetic product explanation" },
  ], { dispatchTool: async (_admin, name) => {
    dispatched.push(name);
    return { response: { ok: true, products: [{ sku: "TEST-SKU", name_th: "Synthetic product", stock: 1 }] } };
  } });
  const { data } = await runtime.request({ query: "", images: [{ mimeType: "image/png", data: "dGVzdA==" }], conversation_id: conversationId, channel: "line", stream: false });
  assert.deepEqual(dispatched, ["find_products"]);
  assert.equal(data.answer, "Synthetic product explanation");
  assert.equal(data.verbatim, false);
  assert.equal(runtime.trace.modelCalls, 2); // The normal lookup + answer loop.
});

test("unexpected generated critical values never reach streamed or persisted text", async () => {
  const runtime = await ragRuntime(database(), [{ text: "Bank account: INVENTED", tools: [{ name: "capture_lead", args: {} }] }]);
  const { data } = await runtime.request({ query: "hello", session_id: "synthetic-session", stream: true });
  assert.doesNotMatch(data.answer, /INVENTED/);
  assert.match(data.answer, /staff queue/);
  assert.deepEqual(runtime.trace.dispatched, []);
  assert.equal(runtime.trace.saved.find(message => message.sender === "bot").content, data.answer);
});

test("unverified critical tool notes cannot create a generic lead or leak through public tool events", async () => {
  const db = database();
  const runtime = await ragRuntime(db, [{ text: "", tools: [{ name: "capture_lead", args: { note: "Bank account: INVENTED" } }] }]);
  const { data, events } = await runtime.request({ query: "hello", conversation_id: conversationId, stream: true });
  assert.match(data.answer, /staff queue/);
  assert.doesNotMatch(JSON.stringify(events), /INVENTED/);
  assert.deepEqual(runtime.trace.dispatched, []);
  assert.equal(db.calls[0].args.p_kind, "ops.critical_company_review");
});

test("read-only critical requests suppress real work and raw errors are not exposed", async () => {
  const db = database(), runtime = await ragRuntime(db);
  const result = await runtime.request({ query: "ส่งสลิปให้ค่ะ", read_only: true, stream: false });
  assert.match(result.data.answer, /ไม่มีการส่งคำขอตรวจสอบจริง/);
  assert.equal(db.calls.length, 0);
  for (const stream of [false, true]) {
    const broken = await ragRuntime(database(), [{ error: "PRIVATE PROVIDER BODY Bank account: INVENTED" }]);
    const response = await broken.request({ query: "hello", stream });
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE|INVENTED/);
  }
});

test("the last gate catches sensitive values introduced by a downstream response transform", async () => {
  const db = database();
  const runtime = await ragRuntime(db, [{ text: "Ordinary answer" }], {
    withQuoteQuickReplies: () => "Account number: TRANSFORMED-INVENTION",
  });
  const { data } = await runtime.request({ query: "hello", session_id: "synthetic-session", stream: true });
  assert.doesNotMatch(data.answer, /TRANSFORMED-INVENTION/);
  assert.match(data.answer, /staff queue/);
  assert.equal(data.verbatim, true);
  assert.equal(runtime.trace.saved.find(message => message.sender === "bot").content, data.answer);
});

function extractFunction(source, name) {
  const stripped = stripTypeScriptTypes(source).replace(/\r\n/g, "\n");
  const start = stripped.indexOf(`function ${name}(`);
  const next = stripped.indexOf("\n}\n", start);
  assert.ok(start >= 0 && next > start, name);
  return stripped.slice(start, next + 2);
}

test("real LINE and Messenger transformations preserve critical replies and never add accounting claims", () => {
  const line = readFileSync(new URL("../supabase/functions/line-webhook/index.ts", import.meta.url), "utf8");
  const facebook = readFileSync(new URL("../supabase/functions/facebook-webhook/index.ts", import.meta.url), "utf8");
  const functions = ["sanitizeReply", "composeQuoteReply", "textToLineMessages"].map(name => extractFunction(line, name)).join("\n");
  const { sanitizeReply, composeQuoteReply, textToLineMessages } = new Function("stripBlockedEmergencyNotice", "stripQuoteLink", "extractQuickReplies", functions + "\nreturn {sanitizeReply,composeQuoteReply,textToLineMessages};")(
    value => value, () => { throw Error("Critical reply must bypass quote transform"); }, () => undefined,
  );
  const textParts = new Function(extractFunction(facebook, "textParts") + "\nreturn textParts;")();
  for (const answer of [renderApprovedMaster(snapshot().records[0], "payment", "th"), "หลักฐานการชำระเงินยังไม่ได้ยืนยัน กำลังรอเจ้าหน้าที่รับเรื่องค่ะ", "ยังบันทึกคำขอตรวจสอบไม่สำเร็จ เรื่องยังไม่ได้ถูกส่งค่ะ"]) {
    const clean = sanitizeReply(answer, true);
    const composed = composeQuoteReply(clean, "unexpected quote link", true);
    assert.equal(composed, answer);
    assert.equal(textToLineMessages(composed).map(message => message.text).join(""), answer);
    assert.equal(textParts(answer).join(""), answer);
  }
  assert.equal(sanitizeReply("ส่งสลิปให้แล้วค่ะ", false), "ส่งสลิปให้แล้วค่ะ");
  assert.match(line, /if \(data\.verbatim === true\) return \{ answer, quoteCode: null, verbatim: true, activeItem: null \}/);
  assert.match(facebook, /if \(result\.verbatim === true\) return null/);
});
