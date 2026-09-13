const PRICE_SOURCES = new Set([
  "base",
  "tier",
  "customer_net",
  "flowaccount_quote",
]);

const CONTEXT_REASONS = new Set([
  "conversation_not_found",
  "customer_not_linked",
  "tax_customer_required",
  "no_verified_customer_context",
  "manual_or_preexisting_link",
  "price_history_verified",
  "verified_customer_contact",
  "tax_link_pending_verification",
]);

const MAX_QUOTE_ITEMS = 100;
const MAX_ITEM_QUANTITY = 1_000_000;

export function normalizeExactPriceRequest(rawSku, rawQuantity) {
  const sku = String(rawSku ?? "").trim().toUpperCase();
  if (!sku) return { ok: false, reason: "sku_required" };

  const quantity = Number(rawQuantity);
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > MAX_ITEM_QUANTITY
  ) {
    return { ok: false, reason: "positive_integer_quantity_required" };
  }
  return { ok: true, sku, quantity };
}

export function normalizeQuoteItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, reason: "items_required" };
  }
  if (rawItems.length > MAX_QUOTE_ITEMS) {
    return { ok: false, reason: "too_many_items" };
  }

  const items = [];
  for (let index = 0; index < rawItems.length; index++) {
    const rawItem = rawItems[index];
    const normalized = normalizeExactPriceRequest(rawItem?.sku, rawItem?.qty);
    if (!normalized.ok) {
      return {
        ok: false,
        reason: "invalid_quote_item",
        item_index: index,
        item_reason: normalized.reason,
      };
    }
    items.push({ sku: normalized.sku, qty: normalized.quantity });
  }

  return { ok: true, items };
}

/**
 * Split a pricing-RPC row into customer-safe facts for Gemini and private
 * provenance for CoreBiz telemetry. The LLM never receives the price source,
 * customer verification state, rule identity, fingerprints, or sync details.
 */
export function customerSafePriceResult(row, expectedSku, expectedQuantity) {
  if (!row || typeof row !== "object") {
    return {
      response: { ok: false, exact_match: false, reason: "price_not_resolved" },
      meta: { reason: "resolver_returned_no_row" },
    };
  }

  const sku = String(row.sku ?? "").trim().toUpperCase();
  const quantity = Number(row.quantity);
  const unitPrice = Number(row.final_price);
  if (
    sku !== expectedSku ||
    quantity !== expectedQuantity ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    return {
      response: { ok: false, exact_match: false, reason: "price_not_resolved" },
      meta: { reason: "resolver_result_mismatch" },
    };
  }

  const rawSource = String(row.price_source ?? "");
  const rawContextReason = String(row.pricing_context_reason ?? "");
  return {
    response: {
      ok: true,
      exact_match: true,
      sku,
      product_name: String(row.product_name ?? ""),
      unit: String(row.unit ?? ""),
      quantity,
      unit_price: unitPrice,
      line_total: Math.round(unitPrice * quantity * 100) / 100,
      currency: "THB",
    },
    meta: {
      price_source: PRICE_SOURCES.has(rawSource) ? rawSource : "unknown",
      personalized_allowed: row.personalized_allowed === true,
      reason: CONTEXT_REASONS.has(rawContextReason)
        ? rawContextReason
        : "resolver_context_unknown",
    },
  };
}
