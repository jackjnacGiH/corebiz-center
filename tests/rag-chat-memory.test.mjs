import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildConversationContinuityPrompt,
  buildMemorySummaryPrompt,
  buildTrustedCustomerPrompt,
  conversationStateSummary,
  constrainConversationStateToEvidence,
  deterministicConversationState,
  normalizeConversationState,
  normalizeTrustedCustomerContext,
  parseConversationStateJson,
  redactConversationMemoryText,
  resolveTrustedConversationId,
  sanitizeMemoryToolOutcome,
} from "../supabase/functions/_shared/conversation-memory.mjs";

const ragSource = readFileSync(
  new URL("../supabase/functions/rag-chat/index.ts", import.meta.url),
  "utf8",
);
const helperSource = readFileSync(
  new URL("../supabase/functions/_shared/conversation-memory.mjs", import.meta.url),
  "utf8",
);

const conversationA = "11111111-1111-4111-8111-111111111111";
const conversationB = "22222222-2222-4222-8222-222222222222";
const customerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("conversation state accepts only the bounded schema and removes restricted facts", () => {
  const state = normalizeConversationState({
    active_intent: "price request",
    products: [{
      sku: "2020000979",
      name: "กระดาษทราย SA331",
      size: "5 นิ้ว",
      grit: "120",
      unit: "แผ่น",
      quantity: 10,
      unit_price: 98765,
      stock: 44,
    }],
    application: "ขัดสี",
    machine: "DEROS650",
    material: "steel",
    confirmed_facts: [
      "sku=2020000979",
      "ราคา 98765",
      "โทร 0812345678",
      "เลขผู้เสียภาษี 1234567890123",
      "ที่อยู่ 84 ถนนสุขุมวิท กรุงเทพ",
    ],
    pending_questions: ["grit", "quantity", "machine", "material", "size", "unit", "holes", "backing", "unsafe-slot"],
    preferences: ["ตอบสั้น", "stock มากกว่า 10", "สมชาย ใจดี"],
    last_action: "payment received",
    customer_id: customerA,
    address: "private",
  });

  assert.equal(state.active_intent, null);
  assert.deepEqual(state.products, [{
    sku: "2020000979",
    name: "กระดาษทราย SA331",
    size: "5 นิ้ว",
    grit: "120",
    unit: "แผ่น",
    quantity: 10,
  }]);
  assert.deepEqual(state.confirmed_facts, ["sku=2020000979"]);
  assert.equal(state.pending_questions.length, 8);
  assert.deepEqual(state.preferences, ["ตอบสั้น"]);
  assert.equal(state.last_action, null);
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /98765|0812345678|1234567890123|สุขุมวิท|customer_id|unit_price|stock/i);
});

test("memory sanitizer drops bare names and unlabeled addresses while retaining sales slots", () => {
  const state = normalizeConversationState({
    active_intent: "product_inquiry",
    products: [{ sku: "SA331-120", name: "กระดาษทราย SA331", size: "5 นิ้ว", grit: "120", unit: "แผ่น", quantity: 10 }],
    application: "sanding",
    machine: "DEROS650",
    material: "steel",
    confirmed_facts: ["sku=SA331-120", "สมชาย ใจดี", "machine=สมชาย ใจดี", "84/2 สุขุมวิท 71 กรุงเทพฯ"],
    pending_questions: ["grit", "สมชาย ใจดี"],
    preferences: ["ตอบกระชับ", "สมชาย ใจดี"],
    last_action: "product_search",
  });
  assert.equal(state.application, "sanding");
  assert.equal(state.machine, "DEROS650");
  assert.equal(state.material, "steel");
  assert.equal(state.products[0].sku, "SA331-120");
  assert.deepEqual(state.confirmed_facts, ["sku=SA331-120"]);
  assert.deepEqual(state.pending_questions, ["grit"]);
  assert.deepEqual(state.preferences, ["ตอบกระชับ"]);
  assert.doesNotMatch(JSON.stringify(state), /สมชาย|ใจดี|สุขุมวิท|กรุงเทพ/);

  const parsed = parseConversationStateJson(JSON.stringify({
    active_intent: "product_inquiry",
    products: [{ sku: "SA331-120", name: "กระดาษทราย SA331" }],
    application: "84/2 สุขุมวิท 71 กรุงเทพฯ",
    machine: "DEROS650",
    material: "steel",
    confirmed_facts: ["สมชาย ใจดี"],
    pending_questions: [],
    preferences: [],
    last_action: "product_search",
  }));
  assert.ok(parsed);
  assert.equal(parsed.application, null);
  assert.doesNotMatch(JSON.stringify(parsed), /สมชาย|ใจดี|สุขุมวิท|กรุงเทพ/);
});

test("model summary cannot add unevidenced identity or sales facts", () => {
  const evidence = deterministicConversationState({
    previousState: null,
    query: "ขอราคา SA331 เบอร์ 120 จำนวน 10 แผ่น ใช้ขัดเหล็ก",
    toolOutcomes: [{
      action: "product_search",
      outcome: "success",
      products: [{ sku: "SA331-120", name: "กระดาษทราย SA331", unit: "แผ่น" }],
      missing_slots: [],
    }],
  });
  const constrained = constrainConversationStateToEvidence({
    active_intent: "quotation_request",
    products: [{ sku: "FAKE", name: "สมชาย ใจดี" }],
    application: "84/2 สุขุมวิท 71 กรุงเทพฯ",
    machine: "PERSON-NAME",
    material: "ทองแดง",
    confirmed_facts: ["sku=FAKE"],
    pending_questions: ["size"],
    preferences: ["ตอบสั้น"],
    last_action: "quotation_request",
  }, evidence);
  assert.equal(constrained.products[0].sku, "SA331-120");
  assert.equal(constrained.products.some((product) => product.sku === "FAKE"), false);
  assert.equal(constrained.application, evidence.application);
  assert.equal(constrained.material, evidence.material);
  assert.deepEqual(constrained.preferences, ["ตอบสั้น"]);
  assert.doesNotMatch(JSON.stringify(constrained), /สมชาย|ใจดี|สุขุมวิท|กรุงเทพ|PERSON-NAME|FAKE/);
});

test("deterministic fallback carries product slots across turns and removes answered questions", () => {
  const firstOutcome = sanitizeMemoryToolOutcome(
    "find_products",
    { query: "SA331 5 นิ้ว" },
    {
      ok: true,
      selection_required: true,
      missing_fields: ["grit", "quantity"],
      products: [{ sku: "2020000979", name_th: "กระดาษทราย SA331", size: "5 นิ้ว", unit: "แผ่น" }],
    },
    { disposition: "needs_selection", missing_fields: ["grit", "quantity"] },
  );
  const turnOne = deterministicConversationState({
    previousState: null,
    query: "ขอราคา SA331 ขนาด 5 นิ้ว",
    toolOutcomes: [firstOutcome],
  });
  assert.equal(turnOne.active_intent, "product_purchase_inquiry");
  assert.deepEqual(turnOne.pending_questions, ["grit", "quantity"]);
  assert.equal(turnOne.products[0].sku, "2020000979");

  const turnTwo = deterministicConversationState({
    previousState: turnOne,
    query: "เบอร์ 120 จำนวน 10 แผ่นครับ",
    toolOutcomes: [],
  });
  assert.equal(turnTwo.active_intent, "product_purchase_inquiry");
  assert.equal(turnTwo.products.length, 1);
  assert.equal(turnTwo.products[0].grit, "120");
  assert.equal(turnTwo.products[0].quantity, 10);
  assert.deepEqual(turnTwo.pending_questions, []);
  assert.ok(turnTwo.confirmed_facts.includes("grit=120"));
  assert.ok(turnTwo.confirmed_facts.includes("quantity=10"));
});

test("deterministic memory summary is bounded readable Thai instead of raw JSON", () => {
  const summary = conversationStateSummary({
    active_intent: "quotation_request",
    products: [{
      sku: "2020000979",
      name: "กระดาษทราย SA331",
      size: "5 นิ้ว",
      grit: "120",
      unit: "แผ่น",
      quantity: 10,
    }],
    application: "sanding",
    confirmed_facts: ["grit=120", "quantity=10", "ราคา 98,765 บาท", "โทร 0812345678"],
    pending_questions: ["machine"],
    last_action: "product_search",
  }, 600);

  assert.match(summary, /ความต้องการ: ขอจัดทำเอกสารเสนอขาย/);
  assert.match(summary, /สินค้า: กระดาษทราย SA331 \(รหัส 2020000979\)/);
  assert.match(summary, /ขนาด 5 นิ้ว/);
  assert.match(summary, /เบอร์ 120/);
  assert.match(summary, /จำนวน 10 แผ่น/);
  assert.match(summary, /ลักษณะงาน: งานขัด/);
  assert.match(summary, /ยังต้องถาม: เครื่องที่ใช้/);
  assert.match(summary, /ขั้นตอนล่าสุด: ค้นหาสินค้า/);
  assert.doesNotMatch(summary, /[{}\[\]"]/);
  assert.doesNotMatch(summary, /98,765|0812345678/);
  assert.ok([...summary].length <= 600);
  assert.equal(redactConversationMemoryText(summary, 600), summary);

  const short = conversationStateSummary({
    active_intent: "product_inquiry",
    products: Array.from({ length: 12 }, (_, index) => ({
      sku: `SKU-${index + 1}`,
      name: `สินค้าทดสอบ ${index + 1}`,
    })),
  }, 80);
  assert.ok([...short].length <= 80);
  assert.doesNotMatch(short, /[{}\[\]"]/);
});

test("trusted conversation context is isolated to an internal verified conversation id", () => {
  assert.equal(resolveTrustedConversationId(false, conversationA), null);
  assert.equal(resolveTrustedConversationId(true, "not-a-uuid"), null);
  assert.equal(resolveTrustedConversationId(true, conversationA), conversationA);
  assert.equal(resolveTrustedConversationId(true, conversationB), conversationB);

  const context = normalizeTrustedCustomerContext({
    customer_id: customerA,
    company_name: "บริษัท เอ จำกัด",
    contact_name: "คุณสมชาย",
    tier: "vip-secret",
    phone: "0812345678",
    history: [{
      document_type: "order",
      sku: "2020000979",
      product_name: "กระดาษทราย SA331",
      quantity: 10,
      unit: "แผ่น",
      status: "completed",
      document_date: "2026-09-01T10:00:00Z",
      unit_price: 98765,
      address: "private-address",
    }],
  });
  assert.deepEqual(context, {
    company_name: "บริษัท เอ จำกัด",
    contact_name: "คุณสมชาย",
    history: [{
      document_type: "order",
      sku: "2020000979",
      product_name: "กระดาษทราย SA331",
      quantity: 10,
      unit: "แผ่น",
      status: "completed",
      document_date: "2026-09-01T10:00:00.000Z",
    }],
  });
  assert.equal(normalizeTrustedCustomerContext({}), null);
  assert.equal(normalizeTrustedCustomerContext([
    { customer_id: customerA, company_name: "บริษัท เอ จำกัด" },
    { customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", company_name: "บริษัท บี จำกัด" },
  ]), null);
  const prompt = buildTrustedCustomerPrompt({ customer_id: customerA, ...context, tier: "vip-secret" });
  const normalizedPrompt = buildTrustedCustomerPrompt(context);
  assert.match(prompt, /personalization and historical continuity only/);
  assert.match(prompt, /Fresh tool results always override/);
  assert.match(prompt, /Use contact_name sparingly/);
  assert.equal((prompt.match(/คุณสมชาย/g) ?? []).length, 1);
  assert.doesNotMatch(prompt, new RegExp(customerA, "i"));
  assert.doesNotMatch(prompt, /vip-secret|customer_id|unit_price|private-address/i);
  assert.match(normalizedPrompt, /คุณสมชาย/);
});

test("continuity prompt exposes only safe structured slots and tells the model not to repeat questions", () => {
  const prompt = buildConversationContinuityPrompt({
    summary: "ลูกค้าต้องการ SA331",
    topics: ["product"],
    structured_state: {
      active_intent: "product_purchase_inquiry",
      products: [{ sku: "2020000979", name: "SA331", size: "5 นิ้ว", unit: "แผ่น" }],
      confirmed_facts: ["size=5 นิ้ว"],
      pending_questions: ["grit", "quantity"],
    },
    locked: true,
    staff_note: "ถามเฉพาะจำนวนที่ยังขาด",
  });
  assert.match(prompt, /private conversation continuity/);
  assert.match(prompt, /"locked":true/);
  assert.match(prompt, /"pending_questions":\["grit","quantity"\]/);
  assert.match(prompt, /ask for the missing slot only/);
  assert.match(prompt, /avoid repeating confirmed questions/);
  assert.match(prompt, /Fresh tools and approved knowledge always override/);
  assert.match(prompt, /ถามเฉพาะจำนวนที่ยังขาด/);

  const sensitive = buildConversationContinuityPrompt({
    summary: "ราคา 98765 บาท โทร 0812345678",
    structured_state: { products: [{ sku: "2020000979" }] },
    staff_note: "ที่อยู่ 84 ถนนสุขุมวิท",
  });
  assert.doesNotMatch(sensitive, /98765|0812345678|สุขุมวิท/);
});

test("memory tool outcomes omit prices, stock, document ids, and contact data", () => {
  const outcome = sanitizeMemoryToolOutcome(
    "get_exact_price",
    { sku: "2020000979", qty: 10, phone: "0812345678" },
    {
      ok: true,
      sku: "2020000979",
      product_name: "กระดาษทราย SA331",
      unit: "แผ่น",
      quantity: 10,
      unit_price: 98765,
      stock: 44,
      quote_code: "QT-SECRET",
    },
    { price_source: "customer_net", personalized_allowed: true },
  );
  assert.deepEqual(outcome, {
    action: "product_request_validation",
    outcome: "success",
    products: [{
      sku: "2020000979",
      name: "กระดาษทราย SA331",
      size: null,
      grit: null,
      unit: "แผ่น",
      quantity: 10,
    }],
    missing_slots: [],
  });
  assert.doesNotMatch(JSON.stringify(outcome), /98765|44|QT-SECRET|0812345678|price|stock|customer_net/i);
});

test("Flash-Lite summary input is redacted and parsed output is validated", () => {
  const prompt = buildMemorySummaryPrompt({
    previousMemory: {
      summary: "ติดต่อ old@example.com",
      structured_state: { products: [{ sku: "2020000979" }] },
    },
    query: "ขอราคา 98,765 บาท โทร 0812345678 สำหรับ SA331 จำนวน 10 แผ่น",
    answer: "มี stock 44 ชิ้น ส่งที่ 84 ถนนสุขุมวิท",
    toolOutcomes: [{
      action: "product_search",
      outcome: "success",
      products: [{ sku: "2020000979", quantity: 10, unit_price: 98765 }],
      missing_slots: [],
      raw_customer: "secret@example.com",
    }],
  });
  assert.match(prompt, /Allowed schema exactly/);
  assert.match(prompt, /assistant text only as conversational context, never as a factual source/i);
  assert.match(prompt, /customer's own words or a successful sanitized tool outcome/i);
  assert.doesNotMatch(prompt, /old@example\.com|secret@example\.com|0812345678|98,765|สุขุมวิท|"unit_price"/);

  const parsed = parseConversationStateJson(`\`\`\`json\n${JSON.stringify({
    active_intent: "product_purchase_inquiry",
    products: [{ sku: "2020000979", name: "SA331", size: "5 นิ้ว", grit: "120", unit: "แผ่น", quantity: 10, unit_price: 98765 }],
    application: "sanding",
    machine: "DEROS650",
    material: "steel",
    confirmed_facts: ["grit=120"],
    pending_questions: [],
    preferences: [],
    last_action: "product_search",
    customer_id: customerA,
  })}\n\`\`\``);
  assert.equal(parsed.products[0].sku, "2020000979");
  assert.doesNotMatch(JSON.stringify(parsed), /unit_price|98765|customer_id/);
  assert.equal(parseConversationStateJson("not json"), null);
});

test("rag-chat loads memory and customer context with strict flags and isolation guards", () => {
  assert.match(ragSource, /structured_memory_enabled: false/);
  assert.match(ragSource, /row\.structured_memory_enabled === true/);
  assert.match(ragSource, /structured_memory_enabled, candidate_capture_enabled/);
  assert.match(ragSource, /settings\.structured_memory_enabled\s*\?\s*"summary, topics, structured_state, staff_locked, staff_note"\s*:\s*"summary, topics"/);
  assert.match(ragSource, /locked: row\.staff_locked === true/);
  assert.doesNotMatch(ragSource, /structured_state, locked, staff_note/);
  assert.match(ragSource, /\.eq\("conversation_id", conversationId\)[\s\S]*\.gt\("expires_at"/);
  assert.match(ragSource, /if \(!conversationId \|\| !settings\.enabled \|\| !settings\.context_memory_enabled\) return null/);
  assert.match(ragSource, /resolveTrustedConversationId\(\s*internalServiceCall,\s*body\.conversation_id/);
  assert.match(ragSource, /loadTrustedCustomerContext\(admin, trustedConversationId, learningSettings\)/);
  assert.match(ragSource, /!settings\.structured_memory_enabled\) return null/);
  assert.match(ragSource, /admin\.rpc\("get_bot_customer_context", \{\s*p_conversation_id: trustedConversationId/);
  assert.match(ragSource, /trusted bot customer context unavailable/);
  assert.match(ragSource, /previousMemory\?\.locked/);
  assert.match(ragSource, /if \(!settings\.structured_memory_enabled\) \{[\s\S]*Latest customer context:/);
  assert.match(ragSource, /const legacySummaryLimit = Math\.min\(600, settings\.max_context_chars\)/);
  assert.match(ragSource, /`Latest customer context: \$\{safeQuery\}`\.slice\(0, legacySummaryLimit\)/);
  assert.match(ragSource, /Unknown lock state must not permit a background overwrite/);
});

test("structured memory is deterministic, free of a second model call, and runs post-response", () => {
  assert.match(ragSource, /const GEMINI_MODELS = \["gemini-2\.5-flash", "gemini-2\.5-flash-lite"\]/);
  assert.match(ragSource, /if \(!settings\.structured_memory_enabled\)/);
  assert.doesNotMatch(ragSource, /MEMORY_SUMMARY_MODEL|summarizeConversationStateWithFlashLite|buildMemorySummaryPrompt/);
  assert.match(ragSource, /const state = deterministicConversationState/);
  assert.match(ragSource, /adds no[\s\S]*second model request[\s\S]*token usage[\s\S]*quota pressure/);
  assert.match(ragSource, /admin\.rpc\("upsert_bot_conversation_memory_state", \{[\s\S]*p_turn_at: turnAt/);

  const finalStart = ragSource.lastIndexOf("const responseCriticalWrites");
  const finalPath = ragSource.slice(finalStart);
  const doneAt = finalPath.indexOf('send({ type: "done"');
  const memoryAt = finalPath.indexOf('runInBackground("conversation_memory"');
  assert.ok(finalStart >= 0 && doneAt >= 0 && memoryAt > doneAt);
  assert.doesNotMatch(finalPath.slice(0, doneAt), /updateConversationMemoryState/);
  assert.doesNotMatch(finalPath, /await\s+updateConversationMemoryState/);
  assert.doesNotMatch(ragSource, /saveConversationMemory/);
  assert.match(ragSource, /p_turn_at with the stored turn timestamp/);
  assert.match(ragSource, /EdgeRuntime\?: \{ waitUntil/);
});

test("new memory path leaves exact-price and quote guards intact", () => {
  assert.match(ragSource, /admin\.rpc\("resolve_bot_quote_prices"/);
  assert.match(ragSource, /const exactPriceEligibleSkus = new Set<string>\(\)/);
  assert.match(ragSource, /guardNumericSellingPriceAnswer\(\{/);
  assert.match(ragSource, /call\.name === "request_quote" && isTrustedQuoteResult\(result\)/);
  assert.match(ragSource, /result = dispatched\.response/);
  assert.doesNotMatch(helperSource, /resolve_bot_quote_prices|create_or_reuse_bot_quote/);
});
