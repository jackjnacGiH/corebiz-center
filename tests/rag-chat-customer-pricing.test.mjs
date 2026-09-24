import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  customerSafePriceResult,
  normalizeExactPriceRequest,
  normalizeQuoteItems,
} from "../supabase/functions/_shared/customer-pricing.mjs";
import { shouldSuppressToolForProductSearch } from "../supabase/functions/_shared/product-selection.mjs";
import { readOnlyToolDecision } from "../supabase/functions/_shared/rag-read-only.mjs";

const ragSource = readFileSync(
  new URL("../supabase/functions/rag-chat/index.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260913090000_customer_pricing_phase1.sql", import.meta.url),
  "utf8",
);

test("exact-price request requires an exact SKU and positive whole quantity", () => {
  assert.deepEqual(normalizeExactPriceRequest(" sa331-120 ", 25), {
    ok: true,
    sku: "SA331-120",
    quantity: 25,
  });
  assert.deepEqual(normalizeExactPriceRequest("", 25), {
    ok: false,
    reason: "sku_required",
  });
  for (const quantity of [undefined, 0, -1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(normalizeExactPriceRequest("SA331-120", quantity), {
      ok: false,
      reason: "positive_integer_quantity_required",
    });
  }
});

test("quote items fail closed instead of coercing or partially dropping invalid quantities", () => {
  assert.deepEqual(normalizeQuoteItems([
    { sku: " sa331-120 ", qty: 25 },
    { sku: "SA331-220", qty: 10 },
  ]), {
    ok: true,
    items: [
      { sku: "SA331-120", qty: 25 },
      { sku: "SA331-220", qty: 10 },
    ],
  });

  for (const quantity of [undefined, "", 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(normalizeQuoteItems([
      { sku: "SA331-120", qty: 25 },
      { sku: "SA331-220", qty: quantity },
    ]), {
      ok: false,
      reason: "invalid_quote_item",
      item_index: 1,
      item_reason: "positive_integer_quantity_required",
    });
  }

  assert.deepEqual(normalizeQuoteItems([
    { sku: "", qty: 10 },
    { sku: "VALID", qty: 10 },
  ]), {
    ok: false,
    reason: "invalid_quote_item",
    item_index: 0,
    item_reason: "sku_required",
  });
  assert.deepEqual(normalizeQuoteItems([]), {
    ok: false,
    reason: "items_required",
  });
  assert.deepEqual(normalizeQuoteItems(
    Array.from({ length: 101 }, (_, index) => ({ sku: `SKU-${index}`, qty: 1 })),
  ), {
    ok: false,
    reason: "too_many_items",
  });
});

test("customer-facing price facts exclude private pricing provenance", () => {
  const { response, meta } = customerSafePriceResult({
    sku: "SA331-120",
    product_name: "กระดาษทราย SA331 #120",
    unit: "แผ่น",
    quantity: 25,
    final_price: 18.5,
    price_source: "customer_net",
    personalized_allowed: true,
    pricing_context_reason: "verified_customer_contact",
    net_rule_id: "private-rule-id",
    price_fingerprint: "private-fingerprint",
  }, "SA331-120", 25);

  assert.deepEqual(response, {
    ok: true,
    exact_match: true,
    sku: "SA331-120",
    product_name: "กระดาษทราย SA331 #120",
    unit: "แผ่น",
    quantity: 25,
    unit_price: 18.5,
    line_total: 462.5,
    currency: "THB",
  });
  assert.deepEqual(meta, {
    price_source: "customer_net",
    personalized_allowed: true,
    reason: "verified_customer_contact",
  });
  const customerJson = JSON.stringify(response);
  assert.doesNotMatch(customerJson, /customer_net|FlowAccount|verified|rule|fingerprint/i);
});

test("mismatched resolver rows fail closed instead of returning another price", () => {
  const wrongSku = customerSafePriceResult({
    sku: "OTHER",
    quantity: 10,
    final_price: 9,
  }, "EXPECTED", 10);
  assert.equal(wrongSku.response.ok, false);
  assert.equal(wrongSku.meta.reason, "resolver_result_mismatch");

  const wrongQuantity = customerSafePriceResult({
    sku: "EXPECTED",
    quantity: 11,
    final_price: 9,
  }, "EXPECTED", 10);
  assert.equal(wrongQuantity.response.ok, false);

  const zeroPrice = customerSafePriceResult({
    sku: "EXPECTED",
    quantity: 10,
    final_price: 0,
  }, "EXPECTED", 10);
  assert.equal(zeroPrice.response.ok, false);
  assert.equal(zeroPrice.meta.reason, "resolver_result_mismatch");
});

test("product clarification blocks price lookup until the variant is exact", () => {
  assert.equal(shouldSuppressToolForProductSearch("get_exact_price", "needs_selection"), true);
  assert.equal(shouldSuppressToolForProductSearch("get_exact_price", "resolved"), false);
});

test("read-only evaluation may resolve only the resolver's safe base fallback", () => {
  assert.deepEqual(readOnlyToolDecision("get_exact_price", true), {
    execute: true,
    recordSuppressed: false,
    result: null,
  });
});

test("rag-chat has one authoritative numeric-price path", () => {
  const formatStart = ragSource.indexOf("function formatProductForLLM");
  const formatEnd = ragSource.indexOf("async function dispatchTool", formatStart);
  const formatter = ragSource.slice(formatStart, formatEnd);
  assert.match(formatter, /price_lookup_required: true/);
  assert.doesNotMatch(formatter, /price:\s*effective|effective_price|original_price|discount_value/);

  const lookupStart = ragSource.indexOf("async function getExactPrice");
  const lookupEnd = ragSource.indexOf("async function listProductGroups", lookupStart);
  const lookup = ragSource.slice(lookupStart, lookupEnd);
  assert.match(lookup, /normalizeExactPriceRequest\(args\.sku, args\.qty\)/);
  assert.match(lookup, /admin\.rpc\("resolve_bot_quote_prices"/);
  assert.match(lookup, /customerSafePriceResult\(row, request\.sku, request\.quantity\)/);
  assert.match(lookup, /toolResponse\(safe\.response, safe\.meta\)/);
  assert.doesNotMatch(lookup, /fetch\(|flowaccount/i);

  assert.match(ragSource, /result = dispatched\.response/);
  assert.match(ragSource, /call\.name === "get_exact_price" && dispatched\.resultMeta/);
  assert.match(ragSource, /console\.info\("get_exact_price provenance"/);
  assert.match(ragSource, /else \{\s*dispatchResultMeta = dispatched\.resultMeta/);
  assert.match(ragSource, /functionResponse: \{ name: call\.name, response: modelResult \}/);
  assert.match(ragSource, /const priced = await getExactPrice\(admin, \{ sku: exactProduct\.sku, qty: quantity \}, conversationId\)/);
  assert.match(ragSource, /isSuccessfulExactPriceResult\(priced\.response\)/);
  assert.match(ragSource, /const verified = await findProducts\(admin, acceptedQuote\.sku\)/);
  assert.match(ragSource, /exactSkuVerified[\s\S]+requestQuote\(admin, args, channel, conversationId, query, false, history\)/);
  assert.match(ragSource, /const exactPriceEligibleSkus = new Set<string>\(\)/);
  assert.match(ragSource, /call\.name === "get_exact_price"[\s\S]+exact_product_lookup_required/);
  assert.match(ragSource, /lookupDisposition === "resolved" && selectedSkus\.length === 1/);
});

test("bot prompt requires exact quantity and hides pricing provenance", () => {
  assert.match(ragSource, /ตัวเลขราคาขายต้องมาจาก get_exact_price เท่านั้น/);
  assert.match(ragSource, /ถ้ายังไม่ทราบจำนวนให้ถามจำนวนก่อน/);
  assert.match(ragSource, /ห้ามบอกลูกค้าว่าราคามาจาก Tier ราคาเฉพาะลูกค้า ประวัติ FlowAccount หรือสถานะการยืนยันตัวตน/);
  assert.match(ragSource, /A numeric selling price must come from get_exact_price only/);
});

test("database contract applies the same provenance gate to lookup and quote creation", () => {
  const contextStart = migrationSource.indexOf("create or replace function pricing_private.bot_pricing_context");
  const contextEnd = migrationSource.indexOf("create or replace function public.resolve_bot_quote_prices", contextStart);
  const context = migrationSource.slice(contextStart, contextEnd);
  assert.match(context, /quote_customer_link_method[^\n]+<> 'tax_id'/);
  assert.match(context, /price_history_verified_at/);
  assert.match(context, /contact\.verified/);
  assert.match(context, /profile\.line_user_id = v_external_id/);
  assert.match(context, /false, 'tax_link_pending_verification'/);

  const internalStart = migrationSource.indexOf("create or replace function pricing_private.resolve_quote_items");
  const internalEnd = migrationSource.indexOf("create or replace function public.resolve_customer_quote_prices", internalStart);
  const internal = migrationSource.slice(internalStart, internalEnd);
  assert.match(internal, /p_allow_personalized and c\.id is not null/);
  assert.ok((internal.match(/and p_allow_personalized/g) ?? []).length >= 2);

  const lookupStart = migrationSource.indexOf("create or replace function public.resolve_bot_quote_prices");
  const lookupEnd = migrationSource.indexOf("create or replace function public.create_or_reuse_bot_quote", lookupStart);
  const lookup = migrationSource.slice(lookupStart, lookupEnd);
  assert.match(lookup, /context\.personalized_allowed, context\.pricing_context_reason/);
  assert.match(lookup, /context\.customer_id, p_items, context\.personalized_allowed/);
  assert.match(lookup, /grant execute[\s\S]+to service_role/);
  assert.doesNotMatch(lookup, /flowaccount_price_cache_id|document_record_id|document_serial/);

  const quote = migrationSource.slice(lookupEnd);
  assert.match(quote, /bot_pricing_context\(p_conversation_id\)/);
  assert.match(quote, /resolve_quote_items\([\s\S]+v_allow_personalized/);
});

test("created quote is immediately usable without an Owner price approval message", () => {
  const start = ragSource.indexOf("async function requestQuote");
  const end = ragSource.indexOf("const PERSONA_HARDCODED_FALLBACK", start);
  const body = ragSource.slice(start, end);
  const createdBranchStart = body.indexOf("quote?.items_resolved === true && quote.quote_created === true");
  const reusedBranchStart = body.indexOf("quote?.items_resolved === true && quote.quote_reused === true");
  const createdBranch = body.slice(createdBranchStart, reusedBranchStart);

  assert.match(createdBranch, /ด้วยราคาที่ระบบคำนวณแล้ว/);
  assert.match(createdBranch, /แจ้งเลขที่นี้กับลูกค้าได้ทันที/);
  assert.doesNotMatch(createdBranch, /ทีมงานจะตรวจสอบ\/ยืนยันราคาสุทธิ|staff must confirm/i);
});

test("quote creation validates every SKU and quantity before calling the database", () => {
  const start = ragSource.indexOf("async function requestQuote");
  const end = ragSource.indexOf("const PERSONA_HARDCODED_FALLBACK", start);
  const body = ragSource.slice(start, end);
  const validation = body.indexOf("normalizeQuoteItems(args.items)");
  const quoteRpc = body.indexOf('admin.rpc("create_or_reuse_bot_quote"');

  assert.ok(validation >= 0 && validation < quoteRpc);
  assert.match(body, /reason: "invalid_quote_items"/);
  assert.doesNotMatch(body, /Math\.floor\(Number\(it\?\.qty\)/);
});
