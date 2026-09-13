import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  guardNumericSellingPriceAnswer,
  hasNumericSellingPrice,
  hasSellingPriceIntent,
  inferExplicitRequestedSkuCount,
  inferRequestedProductItemCount,
  isSuccessfulExactPriceResult,
  isTrustedQuoteResult,
} from "../supabase/functions/_shared/price-answer-guard.mjs";

const ragSource = readFileSync(
  new URL("../supabase/functions/rag-chat/index.ts", import.meta.url),
  "utf8",
);

const exactPrice = ({
  sku = "SA331-120",
  quantity = 10,
  unitPrice = 125,
  productName = "กระดาษทราย SA331 #120",
  unit = "แผ่น",
} = {}) => ({
  ok: true,
  exact_match: true,
  sku,
  product_name: productName,
  unit,
  quantity,
  unit_price: unitPrice,
  line_total: Math.round(unitPrice * quantity * 100) / 100,
  currency: "THB",
});

test("recognizes Thai and English product-price intent without treating delivery or payment as product price", () => {
  for (const query of [
    "ขอราคา FA 331 #120 ครับ",
    "สินค้าตัวนี้ราคาเท่าไหร่",
    "ขอใบเสนอราคา 10 กล่อง",
    "How much is SA331?",
    "Please quote 10 boxes of this product",
  ]) assert.equal(hasSellingPriceIntent(query), true, query);

  for (const query of [
    "ค่าขนส่งเท่าไหร่",
    "แจ้งโอนเงิน 1,200 บาท",
    "What is the shipping fee?",
    "I sent the bank transfer receipt",
  ]) assert.equal(hasSellingPriceIntent(query), false, query);
});

test("detects labelled, currency and common unlabelled prices", () => {
  for (const [query, answer] of [
    ["ขอราคา SA331 #120", "ราคาปัจจุบัน 125 บาทต่อแผ่นค่ะ"],
    ["ขอราคา SA331 #120", "ตัวละ 125.00 ค่ะ"],
    ["ขอราคา SA331 #120", "อยู่ที่ 125 ค่ะ"],
    ["ขอราคา SA331 #120", "125.- ค่ะ"],
    ["ขอราคา SA331 #120", "125฿ ค่ะ"],
    ["ขอราคา SA331 #120", "125 บ."],
    ["ขอราคา SA331 #120", "125 ค่ะ"],
    ["ขอราคา SA331 #120", "125.00"],
    ["How much is SA331?", "Unit price: THB 125.00 per sheet."],
    ["Please quote this item", "The price is $12.50 each."],
  ]) assert.equal(hasNumericSellingPrice(answer, query, true), true, answer);
});

test("counts only explicitly labelled SKUs when deriving a multi-item lower bound", () => {
  assert.equal(inferExplicitRequestedSkuCount("ขอราคา SKU-A 10 ชิ้น และ SKU-B 5 ชิ้น"), 2);
  assert.equal(inferExplicitRequestedSkuCount("SKU 2020000979 และ SKU 2020000979"), 1);
  assert.equal(inferExplicitRequestedSkuCount("FA 331 เบอร์ #120 ขนาด 5 นิ้ว จำนวน 10 แผ่น"), 0);
  assert.equal(inferExplicitRequestedSkuCount("รหัสสินค้า 2020000979 และ รหัสสินค้า 2020000980"), 2);
  assert.equal(inferExplicitRequestedSkuCount("SKU: CUT-4, DISC-5"), 2);
  assert.equal(inferExplicitRequestedSkuCount("รหัสสินค้า: 2020002431 | 2020002432"), 2);
});

test("derives a tool-independent item lower bound from distinct product names", () => {
  for (const [query, expected] of [
    ["ขอราคา กระดาษทรายกลม SA331 10 แผ่น และ ใบตัดเหล็ก 4 นิ้ว 5 ใบ", 2],
    ["ขอราคา กระดาษทรายกลมกับผ้าทรายสายพาน อย่างละ 10 ชิ้น", 2],
    ["Price for Sign Neon Gloss 10 sheets and Mirka Gold 5 sheets", 2],
    ["1. จานทรายซ้อน 10 ชิ้น\n2. ใบตัดเหล็ก 5 ใบ", 2],
    ["ขอราคา SA331 และ FA331 อย่างละ 10 แผ่น", 2],
    ["ขอราคา SA331 และ ZK713X อย่างละ 10 ชิ้น", 2],
    ["ขอราคา SA331, SA332, ZK713X อย่างละ 10 ชิ้น", 3],
    ["ขอราคา กระดาษทรายกลม และ หินเจียร และ แปรงลวด อย่างละ 10 ชิ้น", 3],
    ["ขอราคา SA331 #120 10 แผ่น และ SA331 #220 10 แผ่น", 2],
    ["ขอราคา ใบตัด 4 นิ้ว 5 ใบ และ ใบตัด 7 นิ้ว 5 ใบ", 2],
    ["ขอราคา 2020002431 10 ชิ้น และ 2020002432 5 ชิ้น", 2],
    ["price for sign neon gloss 10 sheets and mirka gold 5 sheets", 2],
    ["ขอราคา ฟองน้ำขัด 10 ชิ้นและแปรงลวด 5 ชิ้น", 2],
    ["ขอราคา SKU: CUT-4, DISC-5", 2],
    ["ขอราคา SA331 | SA332 | ZK713X", 3],
    ["ขอราคา sanding disc 10 sheets & cutting wheel 5 pieces", 2],
  ]) assert.equal(inferRequestedProductItemCount(query), expected, query);
});

test("product facets, model details, quantities and packaging do not create phantom items", () => {
  for (const query of [
    "ขอราคา กระดาษทราย SA331 ขนาด 5 นิ้ว เบอร์ #120 จำนวน 10 แผ่น",
    "ขอราคา กระดาษทราย SA331 ขนาด 5 นิ้ว และ เบอร์ #120 จำนวน 10 แผ่น",
    "ขอราคา กระดาษทราย SA331 10 กล่อง กล่องละ 20 แผ่น",
    "ขอราคา Sign Neon Gloss FA331 และ แบบไม่มีรู จำนวน 10 แผ่น",
    "ขอราคา Mirka Gold และ ใช้กับ Stainless Steel จำนวน 10 แผ่น",
    "ขอราคา กระดาษทราย SA331 ใช้กับเครื่องขัด DEROS650 จำนวน 10 แผ่น",
    "ขอราคา กระดาษทราย SA331 ใช้ กับ เครื่องขัด DEROS650 จำนวน 10 แผ่น",
    "ขอราคา SA331 และข้อมูล BO5031",
    "ขอราคา SA331 และ MOQ 100",
    "ขอราคา SA331 และ SO-12345",
    "ขอราคา SA331 1 กล่อง 20 ชิ้น/กล่อง",
    "Price for SA331 compatible with BO5031, size 5 inch and grit 120",
    "ขอราคา Sign Neon Gloss\nFA331\nจำนวน 10 แผ่น",
    "ขอราคา กระดาษทราย Sign Neon Gloss\nFA331\nจำนวน 10 แผ่น",
    "Price for product description\nSign Neon Gloss\nFA331\nจำนวน 10 แผ่น",
    "ขอราคา Mirka Gold 10 แผ่น กับเครื่องขัดรุ่น M12",
    "Price for SA331 size 5 inch and grit 120",
    "ขอราคา SA331 หรือ SA332 จำนวน 10 แผ่น",
    "Price for SA331 or SA332, 10 sheets",
  ]) assert.equal(inferRequestedProductItemCount(query), 1, query);

  assert.equal(hasNumericSellingPrice("125 ค่ะ", "ขอรายละเอียดเบอร์สินค้า", true), false);
});

test("does not mistake SKU, model, grit, dimensions, quantities, delivery or payment amounts for product prices", () => {
  for (const [query, answer] of [
    ["ขอรายละเอียดสินค้า", "รุ่น FA 331 เบอร์ #120 ขนาด 5 นิ้ว จำนวน 10 แผ่นค่ะ"],
    ["มีของไหม", "SKU 2020000979 มีสินค้า 120 แผ่นค่ะ"],
    ["ขอข้อมูลติดต่อ", "โทร 0800161700 ที่เลขที่ 84 หมู่ 2 ค่ะ"],
    ["ค่าส่งเท่าไหร่", "ค่าขนส่ง 100 บาทค่ะ"],
    ["แจ้งโอนเงิน", "ได้รับยอดโอน 1,200 บาทแล้วค่ะ"],
    ["Product details please", "FA 331, grit 120, 5 inch, 10 sheets."],
    ["ขอราคาและข้อมูลการบรรจุ", "บรรจุกล่องละ 20 ชิ้น จำนวน 10 กล่องค่ะ"],
  ]) assert.equal(hasNumericSellingPrice(answer, query, false), false, answer);
});

test("only a SKU-and-quantity-bound positive THB result is authoritative", () => {
  assert.equal(isSuccessfulExactPriceResult(exactPrice()), true);
  for (const result of [
    null,
    { ...exactPrice(), ok: false },
    { ...exactPrice(), exact_match: false },
    { ...exactPrice(), sku: "" },
    { ...exactPrice(), quantity: 0, line_total: 0 },
    { ...exactPrice(), unit_price: 0, line_total: 0 },
    { ...exactPrice(), line_total: 999 },
    { ...exactPrice(), currency: "USD" },
  ]) assert.equal(isSuccessfulExactPriceResult(result), false);
});

test("suppresses an unverified price and asks only for the missing facts", () => {
  const missingProduct = guardNumericSellingPriceAnswer({
    query: "SA331 ราคาเท่าไหร่",
    answer: "ราคา 125 บาทค่ะ",
    lang: "th",
  });
  assert.equal(missingProduct.reason, "exact_product_and_quantity_required");
  assert.match(missingProduct.answer, /SKU.*ขนาด\/เบอร์.*จำนวน/);
  assert.doesNotMatch(missingProduct.answer, /125/);

  const missingQuantity = guardNumericSellingPriceAnswer({
    query: "ขอราคา SA331 #120",
    answer: "อยู่ที่ 125 ค่ะ",
    lang: "th",
    expectedExactProductCount: 1,
  });
  assert.equal(missingQuantity.reason, "quantity_required");
  assert.match(missingQuantity.answer, /แจ้งจำนวน/);

  const failedLookup = guardNumericSellingPriceAnswer({
    query: "ขอราคา SKU 2020000979 จำนวน 10 แผ่น",
    answer: "125.- ค่ะ",
    lang: "th",
    exactPriceAttemptCount: 1,
    expectedExactProductCount: 1,
  });
  assert.equal(failedLookup.reason, "exact_price_not_verified");
  assert.match(failedLookup.answer, /ยังยืนยันราคาขายปัจจุบันจากระบบไม่ได้/);
});

test("synthesizes the exact tool price instead of trusting a mismatched model amount", () => {
  const guarded = guardNumericSellingPriceAnswer({
    query: "ขอราคา SA331 #120 จำนวน 10 แผ่น",
    answer: "ราคาต่อแผ่น 150 บาท รวม 1,500 บาทค่ะ",
    lang: "th",
    exactPriceResults: [exactPrice()],
    exactPriceAttemptCount: 1,
    expectedExactProductCount: 1,
  });

  assert.equal(guarded.reason, "verified_exact_price_reply");
  assert.match(guarded.answer, /SA331-120/);
  assert.match(guarded.answer, /125\.00 บาท\/แผ่น/);
  assert.match(guarded.answer, /1,250\.00 บาท/);
  assert.doesNotMatch(guarded.answer, /150 บาท|1,500/);
});

test("fails closed when a multi-SKU price request resolved only some items", () => {
  const partial = guardNumericSellingPriceAnswer({
    query: "ขอราคา SKU-A 10 ชิ้น และ SKU-B 5 ชิ้น",
    answer: "SKU-A ราคา 125 บาท และ SKU-B ราคา 200 บาทค่ะ",
    lang: "th",
    exactPriceResults: [exactPrice({ sku: "SKU-A", quantity: 10 })],
    exactPriceAttemptCount: 2,
  });

  assert.equal(partial.reason, "exact_price_not_verified");
  assert.doesNotMatch(partial.answer, /125|200/);
});

test("fails closed when a named multi-product request has only one resolved price", () => {
  const partial = guardNumericSellingPriceAnswer({
    query: "ขอราคา กระดาษทรายกลม SA331 10 แผ่น และ ใบตัดเหล็ก 4 นิ้ว 5 ใบ",
    answer: "กระดาษทรายราคา 125 บาทค่ะ",
    lang: "th",
    exactPriceResults: [exactPrice({ sku: "SA331-120", quantity: 10 })],
    exactPriceAttemptCount: 1,
    expectedExactProductCount: 1,
  });

  assert.equal(partial.reason, "exact_price_not_verified");
  assert.doesNotMatch(partial.answer, /125/);
});

test("all independently evidenced multi-item forms reject a single resolved outcome", () => {
  for (const query of [
    "ขอราคา SA331 #120 10 แผ่น และ SA331 #220 10 แผ่น",
    "ขอราคา ใบตัด 4 นิ้ว 5 ใบ และ ใบตัด 7 นิ้ว 5 ใบ",
    "ขอราคา 2020002431 10 ชิ้น และ 2020002432 5 ชิ้น",
    "price for sign neon gloss 10 sheets and mirka gold 5 sheets",
    "ขอราคา ฟองน้ำขัด 10 ชิ้นและแปรงลวด 5 ชิ้น",
    "ขอราคา SKU: CUT-4, DISC-5 อย่างละ 10 ชิ้น",
  ]) {
    const partial = guardNumericSellingPriceAnswer({
      query,
      answer: "ราคาปัจจุบัน 125 บาทค่ะ",
      lang: /\bprice\b/iu.test(query) ? "en" : "th",
      exactPriceResults: [exactPrice()],
      exactPriceAttemptCount: 1,
      expectedExactProductCount: 1,
    });
    assert.equal(partial.reason, "exact_price_not_verified", query);
    assert.doesNotMatch(partial.answer, /125/, query);
  }
});

test("synthesizes all named products only after every requested item has a safe result", () => {
  const complete = guardNumericSellingPriceAnswer({
    query: "ขอราคา กระดาษทรายกลม SA331 10 แผ่น และ ใบตัดเหล็ก 4 นิ้ว 5 ใบ",
    answer: "รวมแล้ว 1 บาทค่ะ",
    lang: "th",
    exactPriceResults: [
      exactPrice({ sku: "SA331-120", quantity: 10 }),
      exactPrice({ sku: "CUT-4", quantity: 5, unitPrice: 40, productName: "ใบตัดเหล็ก 4 นิ้ว", unit: "ใบ" }),
    ],
    exactPriceAttemptCount: 2,
    expectedExactProductCount: 2,
  });

  assert.equal(complete.reason, "verified_exact_price_reply");
  assert.match(complete.answer, /SA331-120/);
  assert.match(complete.answer, /CUT-4/);
  assert.doesNotMatch(complete.answer, /รวมแล้ว 1 บาท/);
});

test("successful quote creation and reuse use only the trusted quote result", () => {
  const created = {
    ok: true,
    saved: true,
    quote_created: true,
    quote_reused: false,
    quote_code: "QT-2026-00123",
    estimated_total_incl_vat: 1070,
  };
  assert.equal(isTrustedQuoteResult(created), true);
  const createdReply = guardNumericSellingPriceAnswer({
    query: "ออกใบเสนอราคา SA331 จำนวน 10 แผ่น",
    answer: "สร้างแล้วค่ะ ยอดรวม 999 บาท เลขที่ QT-WRONG",
    lang: "th",
    trustedQuoteResult: created,
  });
  assert.equal(createdReply.reason, "trusted_quote_reply");
  assert.match(createdReply.answer, /QT-2026-00123/);
  assert.match(createdReply.answer, /1,070\.00 บาท/);
  assert.doesNotMatch(createdReply.answer, /999|QT-WRONG/);

  const implicitQuoteReply = guardNumericSellingPriceAnswer({
    query: "ทำเอกสารให้หน่อย",
    answer: "ดำเนินการเรียบร้อยค่ะ เลขที่ QT-WRONG",
    lang: "th",
    trustedQuoteResult: created,
  });
  assert.equal(implicitQuoteReply.reason, "trusted_quote_reply");
  assert.match(implicitQuoteReply.answer, /QT-2026-00123/);
  assert.doesNotMatch(implicitQuoteReply.answer, /QT-WRONG/);

  const reused = {
    ok: true,
    saved: true,
    quote_created: false,
    quote_reused: true,
    existing_quote_code: "QT-2026-00123",
  };
  assert.equal(isTrustedQuoteResult(reused), true);
  const reusedReply = guardNumericSellingPriceAnswer({
    query: "ขอใบเสนอราคาเดิมอีกครั้ง",
    answer: "ยอด 999 บาทค่ะ",
    lang: "th",
    trustedQuoteResult: reused,
  });
  assert.equal(reusedReply.reason, "trusted_quote_reply");
  assert.match(reusedReply.answer, /QT-2026-00123.*ใช้ใบเดิม/);
  assert.doesNotMatch(reusedReply.answer, /999/);
});

test("preserves harmless product numbers and a useful nonnumeric clarification", () => {
  for (const [query, answer, expectedCount] of [
    ["ขอรายละเอียด FA331", "รุ่น FA 331 เบอร์ #120 ขนาด 5 นิ้ว จำนวน 10 แผ่นค่ะ", 0],
    ["ขอราคา FA331 #120", "พบสินค้าแล้วค่ะ ต้องการจำนวนกี่แผ่นคะ", 1],
  ]) {
    assert.deepEqual(guardNumericSellingPriceAnswer({
      query,
      answer,
      lang: "th",
      expectedExactProductCount: expectedCount,
    }), { answer, guarded: false, reason: null });
  }
});

test("rag-chat binds request-local outcomes and applies the guard before its only final text event", () => {
  const requestedCount = ragSource.indexOf("const requestedProductItemCount = inferRequestedProductItemCount(query)");
  const loopStart = ragSource.indexOf("const exactPriceOutcomes = new Map<string, unknown | null>()");
  const guardCall = ragSource.indexOf("const guardedPriceAnswer = guardNumericSellingPriceAnswer", loopStart);
  const finalSend = ragSource.indexOf('send({ type: "text", chunk: fullAnswer })', guardCall);
  assert.ok(requestedCount >= 0 && loopStart > requestedCount && guardCall > loopStart && finalSend > guardCall);
  assert.match(ragSource.slice(loopStart, guardCall), /requestKey = `\$\{request\.sku\}\\u0000\$\{request\.quantity\}`/);
  assert.match(ragSource.slice(loopStart, guardCall), /isSuccessfulExactPriceResult\(result\) \? result : null/);
  assert.match(ragSource.slice(loopStart, guardCall), /isTrustedQuoteResult\(result\)/);
  assert.match(ragSource.slice(guardCall, finalSend), /exactPriceAttemptCount: exactPriceOutcomes\.size/);
  assert.match(ragSource.slice(guardCall, finalSend), /expectedExactProductCount: exactPriceEligibleSkus\.size/);
  assert.match(ragSource.slice(guardCall, finalSend), /requestedProductItemCount/);
  assert.match(ragSource.slice(guardCall, finalSend), /trustedQuoteResult/);
});
