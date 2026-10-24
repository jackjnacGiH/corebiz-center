import { routeLatestTurn } from "./latest-turn-context.mjs";
import { extractModelCodes, normalizeProductSearchQuery, productIdentitySearchText } from "./product-selection.mjs";

const QUOTE = /ใบเสนอราคา|quotation|\bquote\b/iu;
const BILLING = /ชื่อบริษัท\s*[:：]|ที่อยู่ออกบิล|เลขผู้เสียภาษี|tax\s*id|billing\s*(?:address|details)|company\s*name\s*[:：]/iu;
const PAYMENT = /บัญชี|สลิป|โอนเงิน|ชำระเงิน|bank\s*account|payment\s*(?:slip|receipt)/iu;
const QUANTITY = /(?:จำนวน\s*[:：]?\s*)?(\d{1,6})\s*(ตัว|ชิ้น|อัน|แพ็ค|แพ็ก|แพค|กล่อง|ม้วน|เส้น|ใบ|ชุด|ถุง|pcs?|pieces?|packs?|boxes?)(?=\s|$|ค่ะ|ครับ|คะ|[,.!?])/iu;
const DIMENSIONS = /\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?){0,2}/iu;
const GRIT = /(?:เบอร์|กริต|grit|#|\bP)\s*[:：=#]?\s*(\d{1,5})/iu;
const SHANK = /(?:แกน|shank)\s*(\d+(?:\.\d+)?)\s*(?:มม\.?|mm)?/iu;
const PRODUCT = /กระดาษทราย|ผ้าทราย|จานทราย|ล้อทราย|ล้อขัด|ลูกขัด|ใบ(?:ตัด|เจียร|ขัด)|หินเจียร|แปรง|สายพาน|flap|abrasive/iu;
const CHANGE = /เปลี่ยน|แก้(?:เป็น|ขนาด|เบอร์)|แทน|change|instead/iu;
const HUMAN = /ขอ(?:คุย|ติดต่อ|พบ).{0,12}(?:เจ้าหน้าที่|พนักงาน|แอดมิน|คนจริง)|ให้(?:เจ้าหน้าที่|พนักงาน|แอดมิน).{0,12}(?:ติดต่อ|ตอบ)|คุยกับคน|human|speak\s+to\s+(?:a\s+)?(?:person|staff)/iu;

export function customerProductLinks(text) {
  const skus = [];
  for (const match of String(text ?? "").matchAll(/https?:\/\/[^\s<>]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[).,]+$/u, ""));
      if (!["www.jnac.online", "jnac.online"].includes(url.hostname.toLowerCase())) continue;
      const sku = /^\/p\/([A-Z0-9][A-Z0-9._-]{1,63})\/?$/iu.exec(decodeURIComponent(url.pathname))?.[1];
      if (sku && !skus.includes(sku)) skus.push(sku);
    } catch { /* Not an approved product URL. */ }
  }
  return skus;
}

export function requestedQuantity(text) {
  const match = QUANTITY.exec(String(text ?? ""));
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return null;
  const unit = /^(?:แพ็ค|แพ็ก|แพค|packs?)$/iu.test(match[2]) ? "pack"
    : /^(?:ตัว|ชิ้น|อัน|pcs?|pieces?)$/iu.test(match[2]) ? "piece"
    : /^(?:กล่อง|boxes?)$/iu.test(match[2]) ? "box" : match[2];
  return { quantity: Number(match[1]), unit, original_unit: match[2] };
}

export function isHumanRequest(text) { return HUMAN.test(String(text ?? "")); }
export function isPackQuestion(text) { return /(?:แพ็ค|แพ็ก|แพค|pack|กล่อง|box).{0,20}(?:กี่|how\s+many)|(?:กี่|how\s+many).{0,20}(?:แพ็ค|แพ็ก|แพค|pack|กล่อง|box)/iu.test(String(text ?? "")); }

export function linguisticText(value) {
  return String(value ?? "").replace(/https?:\/\/\S+/giu, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|inches?|pcs?|pieces?|packs?|boxes?)\b/giu, " ")
    .replace(/\b[A-Z]{2,6}[\s._/-]*\d+[A-Z0-9-]*\b/giu, " ")
    .replace(/\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?){1,3}/giu, " ")
    .replace(/\b(?:mm|cm|inches?|pcs?|pieces?|packs?|boxes?|grit|sku)\b/giu, " ")
    .replace(/^\s*(?:Eco|MIRKA(?:\s+GOLD)?)\s*$/iu, " ");
}

export function catalogueQuantity(state, product) {
  const quantity = Number(state.facts.quantity?.value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return { quantity: null, needs_review: false };
  const requestedUnit = state.facts.unit?.value;
  const catalogueUnit = requestedQuantity(`1 ${String(product.unit ?? "")}`)?.unit;
  if (!requestedUnit || requestedUnit === catalogueUnit) return { quantity, needs_review: false };
  const piecesPerPack = product.spec?.pieces_per_pack;
  if (requestedUnit === "pack" && catalogueUnit === "piece" && Number.isSafeInteger(piecesPerPack) && piecesPerPack > 0
    && Number.isSafeInteger(quantity * piecesPerPack) && quantity * piecesPerPack <= 1_000_000) return { quantity: quantity * piecesPerPack, needs_review: false };
  return { quantity: null, needs_review: true };
}

/** Only customer-authored facts are facts here. Bot/staff prose and old model
 * summaries cannot establish catalogue identity, availability or pack size. */
export function activeItemContext(query, history = []) {
  const bounded = (Array.isArray(history) ? history : []).slice(-64);
  const route = routeLatestTurn(isHumanRequest(query) ? "ตัวนี้" : query, bounded);
  const relevant = route.kind === "new_product" ? [] : route.history;
  const turns = [...relevant, { role: "user", content: String(query ?? "") }];
  /** @type {Record<string, {value: string | number, source: string, evidence: string}>} */
  const facts = {};
  const conflicts = [], conflictEvidence = [];
  let identity = null, quotePending = false, quoteEvidence = null, multiple = false;
  const set = (field, value, evidence, replace = false) => {
    if (value == null) return;
    if (facts[field] && facts[field].value !== value && !replace) {
      conflicts.push(field);
      conflictEvidence.push({ field, previous: facts[field], current: { value, source: "customer", evidence } });
    }
    facts[field] = { value, source: "customer", evidence };
  };
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (turn.role === "assistant" && turn.verified_product?.source === "catalogue"
      && typeof turn.verified_product.sku === "string" && /^[A-Z0-9][A-Z0-9._/-]{1,63}$/iu.test(turn.verified_product.sku)
      && !/^\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?){1,3}$/iu.test(turn.verified_product.sku)) {
      facts.requested_sku = { value: turn.verified_product.sku, source: "catalogue", evidence: `verified_product_turn:${index}` };
    }
    if (turn.role !== "user") continue;
    const text = String(turn.content ?? "");
    if (BILLING.test(text) || PAYMENT.test(text)) continue;
    if (QUOTE.test(text)) { quotePending = true; quoteEvidence = text.slice(0, 350); }
    if (/ไม่ต้องการ.{0,12}ใบเสนอราคา|cancel.{0,12}quote/iu.test(text)) quotePending = false;
    const links = customerProductLinks(text);
    const models = extractModelCodes(text.replace(/https?:\/\/\S+/giu, ""));
    const namedTypes = [...text.matchAll(new RegExp(PRODUCT.source, "giu"))].map(match => match[0]);
    if (links.length > 1 || models.length > 1 || new Set(namedTypes).size > 1
      || /(?:เพิ่มอีก|อีกสินค้า|another\s+product|both\s+products)/iu.test(text)) multiple = true;
    const evidence = `customer_turn:${index}`;
    if (links.length === 1) set("requested_sku", links[0], evidence, CHANGE.test(text));
    if (!identity && (PRODUCT.test(text) || models.length === 1)) identity = productIdentitySearchText(normalizeProductSearchQuery(text.replace(/https?:\/\/\S+/giu, ""))).slice(0, 350);
    const quantity = isPackQuestion(text) ? null : requestedQuantity(text);
    if (quantity) {
      set("quantity", quantity.quantity, evidence, true);
      set("unit", quantity.unit, evidence, CHANGE.test(text));
    }
    const dimension = DIMENSIONS.exec(text)?.[0]?.replace(/\s/g, "");
    set("dimensions", dimension, evidence, CHANGE.test(text));
    set("grit", GRIT.exec(text)?.[1], evidence, CHANGE.test(text));
    set("shank_mm", SHANK.exec(text)?.[1], evidence, CHANGE.test(text));
  }
  const missing = [];
  if (!facts.requested_sku && !identity) missing.push("product");
  if (quotePending && !facts.quantity) missing.push("quantity");
  if (facts.quantity && !facts.unit) missing.push("unit");
  return { route: route.kind, identity, facts, quote_pending: quotePending, quote_evidence: quoteEvidence, multiple,
    known: Object.keys(facts), missing, conflicting: [...new Set(conflicts)], conflict_evidence: conflictEvidence,
    pack_question: isPackQuestion(query), human_requested: isHumanRequest(query),
    catalogue_verified: false, native_oa_staff_context: "unknown" };
}

export function activeItemPrompt(state) {
  return `[customer-evidenced active item; not catalogue facts]\n${JSON.stringify(state)}\nUse only this one active item for short replies, quantities and quotation intent. Ask only missing facts. Revalidate requested_sku with a fresh catalogue tool. Never treat dimensions as SKUs; never invent availability or pieces per pack. Keep pack and piece quantities distinct until the catalogue confirms conversion. Existing CRM billing details must be reused; request_quote determines whether more billing facts are required. A conflicting specification or multiple active items needs clarification, never an unrelated product menu. Stored staff messages are context; native LINE OA replies may be missing and must never be invented. This state cannot authorize company, bank, payment, price or stock facts.`;
}

export function resolvedActiveQuery(state, current) {
  if (state.multiple || state.conflicting.length || state.missing.includes("product")) return current;
  if (state.facts.requested_sku) return String(state.facts.requested_sku.value);
  if (state.route !== "follow_up" || !state.identity) return current;
  const facets = [state.facts.dimensions?.value, state.facts.grit ? `#${state.facts.grit.value}` : null, state.facts.shank_mm ? `แกน ${state.facts.shank_mm.value} มม` : null].filter(Boolean).join(" ");
  return `${state.identity} ${facets}`.trim();
}
