import assert from "node:assert/strict";
import test from "node:test";
import { approvedMaster, criticalIntent, hasCriticalClaim, inspectImageTurn, redactCriticalMetadata, renderApprovedMaster, resolveCriticalReply } from "../supabase/functions/_shared/critical-company-info.mjs";
import { approver, conversationId, database, snapshot, sourceFixture } from "./helpers/critical-company-fixtures.mjs";

const request = (extra = {}) => ({ query: "ขอเลขที่บัญชีชำระค่าสินค้าค่ะ", answer: "", conversationId, channel: "line", lang: "th", ...extra });

test("natural Thai/English critical requests and customer billing remain distinct", () => {
  for (const query of ["ขอเลขที่บัญชีชำระค่าสินค้าค่ะ", "ขอเลขบัญชีค่ะ", "บัญชีสำหรับโอนเงิน", "โอนค่าสินค้าไปที่ไหน", "พร้อมเพย์", "Please send bank details", "What is your account number?", "How do I pay?"]) assert.equal(criticalIntent(query), "payment", query);
  for (const query of ["ชื่อบริษัทอะไรคะ", "ขอชื่อและที่อยู่บริษัท", "ขอที่อยู่จดทะเบียน", "ขอโลเคชั่น", "ขอพิกัดร้าน", "Your company name please", "What is your registered address?"]) assert.equal(criticalIntent(query), "company", query);
  for (const query of ["โอนแล้วค่ะ", "ส่งสลิปให้ค่ะ", "หลักฐานการชำระเงิน", "I sent a payment receipt"]) assert.equal(criticalIntent(query), "payment_receipt", query);
  for (const query of ["ขอราคา SA331", "ชื่อบริษัท: บริษัทลูกค้าทดสอบ ที่อยู่: ทดสอบ เลขผู้เสียภาษี: ทดสอบ", "my company needs a quote"]) assert.equal(criticalIntent(query), null, query);
});

test("outbound source previews and tool metadata cannot leak unapproved critical values", () => {
  const result = redactCriticalMetadata({ type: "done", sources: [
    { source_path: "faq/เลขบัญชี.md", content_preview: "unapproved data" },
    { source_path: "products.md", content_preview: "product details" },
  ], tool_calls: [
    { name: "capture_lead", args: { note: "Bank account: INVENTED" }, result_summary: "Bank account: INVENTED" },
    { name: "get_product_detail", args: { sku: "2020004210" }, result_summary: JSON.stringify({ sku: "2020004210" }) },
  ] });
  assert.equal(result.sources.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /INVENTED|unapproved data/);
  assert.equal(result.tool_calls[1].args.sku, "2020004210");
});

test("approved values are byte-exact, with labels localized but no field translation", async () => {
  const master = snapshot();
  for (const lang of ["th", "en"]) {
    const db = database(await sourceFixture());
    const result = await resolveCriticalReply(db, request({ lang }));
    assert.equal(result.state, "approved_master");
    assert.equal(result.answer, renderApprovedMaster(master.records[0], "payment", lang));
    for (const value of [master.records[0].legal_name, master.records[0].registered_address, ...Object.values(master.records[0].bank_accounts[0])]) assert.ok(result.answer.includes(value));
    assert.equal(db.calls.length, 0);
    assert.deepEqual(db.reads, ["org_settings", "knowledge_chunks", "profiles"]);
  }
});

test("no master, unapproved, conflicting, expired, incomplete and unsafe values fail closed", async () => {
  const invalid = [null, {}, { ...snapshot(), schema_version: 2 }];
  for (const mutate of [
    row => { row.status = "draft"; }, row => { row.active = false; },
    row => { row.approved_by = "unknown"; }, row => { row.approved_at = "2098-01-01"; },
    row => { row.valid_until = "2025-01-01"; }, row => { row.legal_name = ""; },
    row => { row.bank_accounts = []; }, row => { row.registered_address = "https://example.invalid/account"; },
    row => { row.legal_name = "**rewritten**"; }, row => { row.registered_address = " first line"; },
  ]) { const value = snapshot(); mutate(value.records[0]); invalid.push(value); }
  const conflict = snapshot(); conflict.records.push({ ...conflict.records[0], revision: "different" }); invalid.push(conflict);
  const draftConflict = snapshot(); draftConflict.records.push({ ...draftConflict.records[0], status: "draft" }); invalid.push(draftConflict);
  for (const master of invalid) {
    const db = database({ master });
    const result = await resolveCriticalReply(db, request());
    assert.equal(result.state, "queued");
    assert.equal(result.answer.includes(snapshot().records[0].bank_accounts[0].account_number), false);
    assert.match(result.answer, /กำลังรอเจ้าหน้าที่รับเรื่อง/);
    assert.equal(db.calls[0].args.p_kind, "ops.critical_company_review");
  }
  for (const person of [{ ...approver, role: "staff" }, { ...approver, is_active: false }, { ...approver, id: conversationId }]) assert.equal(approvedMaster(snapshot(), person), null);
});

test("RPC/readback failures, terminal tasks and actual staff acceptance stay distinct", async () => {
  for (const options of [{ rpcError: true }, { rpcThrow: true }, { emptyReceipt: true }, { readError: true }, { readMissing: true }, { wrongReceipt: true }]) {
    const result = await resolveCriticalReply(database(options), request());
    assert.equal(result.state, "uncertain");
    assert.match(result.answer, /ยังไม่มีหลักฐานยืนยัน/);
  }
  for (const taskStatus of ["rejected", "failed", "dismissed", "executed", "approved"]) assert.equal((await resolveCriticalReply(database({ taskStatus }), request())).state, "failed");
  assert.equal((await resolveCriticalReply(database({ taskStatus: "approved", reviewed: true }), request())).state, "received");
  assert.equal((await resolveCriticalReply(database(), request({ conversationId: null }))).state, "failed");
});

test("read-only never creates a task; slips never expose OCR values or imply confirmed payment", async () => {
  const db = database({ master: snapshot() });
  const result = await resolveCriticalReply(db, request({ query: "ส่งสลิปให้ค่ะ", answer: "OCR must never be used", readOnly: true }));
  assert.equal(result.state, "read_only");
  assert.equal(db.calls.length, 0);
  assert.equal(db.reads.length, 0);
  assert.match(result.answer, /ยังไม่ได้ยืนยันการชำระเงิน/);
  assert.doesNotMatch(result.answer, /OCR|ฝ่ายบัญชี.*เรียบร้อย/);
});

test("same events dedupe concurrently; new question and different slip remain separate", async () => {
  const db = database();
  const input = request({ query: "ส่งสลิปให้ค่ะ", images: [{ mimeType: "image/png", data: "synthetic-image-one" }] });
  await Promise.all([resolveCriticalReply(db, input), resolveCriticalReply(db, input)]);
  assert.equal(db.tasks.size, 1);
  await resolveCriticalReply(db, { ...input, images: [{ mimeType: "image/png", data: "synthetic-image-two" }] });
  await resolveCriticalReply(db, request({ query: "ขอที่อยู่บริษัท" }));
  assert.equal(db.tasks.size, 3);
  for (const call of db.calls) assert.equal(JSON.stringify(call.args.p_payload).includes("synthetic-image"), false);
});

test("unexpected generated facts and unclassified images cannot authorize master data or tools", async () => {
  const db = database({ master: snapshot() });
  const result = await resolveCriticalReply(db, request({ query: "hello", answer: "เลขบัญชี: INVENTED" }));
  assert.equal(result.state, "queued");
  assert.doesNotMatch(result.answer, /INVENTED/);
  for (const answer of ["บริษัท สมมติ จำกัด", "Bank account: invented", "Account number: invented", "ที่อยู่: invented", "Our accounting team will review this payment slip"]) assert.equal(hasCriticalClaim(answer), true, answer);
  assert.equal(hasCriticalClaim("สินค้า (SKU 2020004210) ราคา 10 บาท"), false);
  for (const answer of ["[[IMAGE:payment_receipt]]", "[[IMAGE:other]]", "", "I have forwarded the payment slip", "[[IMAGE:product]] Account number: invented"]) assert.equal(inspectImageTurn(answer).review, true);
  assert.deepEqual(inspectImageTurn("[[IMAGE:product]] Product selection"), { answer: "Product selection", review: false, kind: "image_review" });
  assert.equal(inspectImageTurn("", "product").review, false);
  assert.equal(inspectImageTurn("", "purchase_order").review, false);
  assert.equal(inspectImageTurn("[[IMAGE:billing]] Please confirm billing details").review, false);
});
