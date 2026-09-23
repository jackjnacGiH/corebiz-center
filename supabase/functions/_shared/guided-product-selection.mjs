import { extractModelCodes, productMatchFacets } from "./product-selection.mjs";
import { pendingProductQuestion } from "./product-turn-context.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const PRODUCT_RE = /กระดาษทราย|\b(?:SA331|PS36|MIRKA|MIKA)\b/iu;
const FOLLOW_UP_RE = /(?:^|\s)(?:#\s*\d+|\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม)|\d+\s*(?:ชิ้น|ใบ|กล่อง|pcs?))|มีรุ่นไหน|รุ่นไหน|แนะนำ|\bmi(?:r)?ka\b|^\d{1,6}$/iu;

function normalized(value) {
  return clean(value)
    .replace(/หลังกา+ว/gu, "หลังกาว")
    .replace(/\bMIKA\b/giu, "MIRKA");
}

function numberedChoice(query, history) {
  if (!/^\d{1,2}$/u.test(query)) return query;
  const last = history.at(-1);
  if (last?.role !== "assistant") return query;
  const line = String(last.content ?? "").split(/\r?\n/u)
    .find((item) => new RegExp(`^\\s*${Number(query)}\\.\\s+`).test(item));
  const choice = line?.replace(/^\s*\d{1,2}\.\s+/u, "").trim();
  return choice && PRODUCT_RE.test(choice) ? choice : query;
}

/** A narrow, catalog-derived query for disc selections and adjacent replies. */
export function guidedCatalogQuery(query, history = []) {
  const current = normalized(numberedChoice(clean(query), history));
  const needsContext = !PRODUCT_RE.test(current) && FOLLOW_UP_RE.test(current)
    || /\bMIRKA\b/iu.test(current) && !/กระดาษทราย/iu.test(current);
  const context = needsContext
    ? [...history].slice(-8).reverse().find((item) =>
      item.role === "user" && (PRODUCT_RE.test(normalized(item.content)) || /หลังกาว|สักหลาด/iu.test(normalized(item.content))))
    : null;
  const prior = normalized(context?.content);
  const backingText = /หลังกาว/iu.test(current) ? "หลังกาว"
    : /สักหลาด|velcro/iu.test(current) ? "สักหลาด"
    : /หลังกาว/iu.test(prior) ? "หลังกาว"
    : /สักหลาด|velcro/iu.test(prior) ? "สักหลาด" : "";
  if (!backingText || !/(?:กระดาษทราย|SA331|PS36|MIRKA)/iu.test(current + " " + prior) && !/หลังกาว/iu.test(current)) return null;

  const currentModel = extractModelCodes(current)[0]
    ?? (/MIRKA\s+GOLD/iu.test(current) ? "MIRKA GOLD" : /\bMIRKA\b/iu.test(current) ? "MIRKA" : "");
  const model = currentModel || (needsContext
    ? extractModelCodes(prior)[0]
      ?? (/MIRKA\s+GOLD/iu.test(prior) ? "MIRKA GOLD" : "")
    : "");
  const currentFacets = productMatchFacets(current);
  const priorFacets = productMatchFacets(prior);
  const carryFacets = needsContext && !currentFacets.size.length && !currentFacets.grit.length;
  const size = currentFacets.size[0] ?? (carryFacets ? priorFacets.size[0] : "");
  const grit = currentFacets.grit[0] ?? (carryFacets ? priorFacets.grit[0] : "");
  return ["กระดาษทรายกลม" + backingText, model, size, grit].filter(Boolean).join(" ");
}

export function guidedRequestedQuantity(query, history = [], resolvedQuery = query) {
  const current = clean(query);
  const explicit = /(?:^|\s)(\d{1,6})\s*(?:ชิ้น|ใบ|กล่อง|pcs?)(?:\s|$)/iu.exec(current);
  if (explicit) return Number(explicit[1]);
  if (/^\d{1,6}$/u.test(current) && /(?:กี่ชิ้น|จำนวน(?:เท่าไร|กี่)|quantity|how many)/iu.test(String(history.at(-1)?.content ?? ""))) {
    return Number(current);
  }
  if (PRODUCT_RE.test(clean(resolvedQuery)) && history.at(-1)?.role === "assistant") {
    const modelOf = (value) => extractModelCodes(value)[0]
      ?? (/MIRKA\s+GOLD/iu.test(value) ? "MIRKA GOLD" : "");
    const resolvedModel = modelOf(resolvedQuery);
    const resolvedBacking = productMatchFacets(resolvedQuery).backing;
    for (const item of [...history].slice(-8).reverse()) {
      if (item.role !== "user") continue;
      const prior = normalized(item.content);
      const priorModel = modelOf(prior);
      const priorBacking = productMatchFacets(prior).backing;
      if (priorModel && resolvedModel && priorModel !== resolvedModel) break;
      if (priorBacking.length && resolvedBacking.length && !priorBacking.every((backing) => resolvedBacking.includes(backing))) break;
      const quantity = /(?:^|\s)(\d{1,6})\s*(?:ชิ้น|ใบ|กล่อง|pcs?)(?:\s|$)/iu.exec(prior);
      if (quantity) return Number(quantity[1]);
    }
  }
  return null;
}

export function guidedExactProductAnswer(product, quantity = null, price = null, lang = "th") {
  const name = clean(lang === "th" ? product.name_th || product.name_en : product.name_en || product.name_th);
  const sku = clean(product.sku);
  const unit = clean(product.unit) || (lang === "th" ? "ชิ้น" : "piece");
  const stock = Number(product.stock);
  const stockText = Number.isFinite(stock)
    ? lang === "th" ? `สต็อกที่ตรวจได้ ${stock} ${unit}` : `Current stock: ${stock} ${unit}`
    : "";
  const minimum = Math.max(1, Number(product.min_order_qty ?? 1));
  if (quantity != null && quantity < minimum) {
    return lang === "th"
      ? `พบ ${name} (SKU ${sku}) ค่ะ ขั้นต่ำ ${minimum} ${unit} ต้องการปรับจำนวนเป็นเท่าไรคะ`
      : `I found ${name} (SKU ${sku}). The minimum is ${minimum} ${unit}. What quantity would you like?`;
  }
  if (quantity != null && price?.ok === true && price?.exact_match === true && price?.sku === sku) {
    return lang === "th"
      ? `พบ ${name} (SKU ${sku}) ค่ะ จำนวน ${quantity} ${unit} ราคา ${price.unit_price} บาท/${unit}${stockText ? ` ${stockText}` : ""}\nให้เอยทำใบเสนอราคาให้เลยไหมคะ`
      : `I found ${name} (SKU ${sku}). For ${quantity} ${unit}, the price is THB ${price.unit_price}/${unit}.${stockText ? ` ${stockText}.` : ""} Would you like a quotation?`;
  }
  if (quantity != null) return null;
  return lang === "th"
    ? `พบ ${name} (SKU ${sku}) ค่ะ${stockText ? ` ${stockText}` : ""} ต้องการกี่${unit}คะ${minimum > 1 ? ` (ขั้นต่ำ ${minimum} ${unit})` : ""}`
    : `I found ${name} (SKU ${sku}).${stockText ? ` ${stockText}.` : ""} How many ${unit} would you like?${minimum > 1 ? ` (Minimum ${minimum} ${unit})` : ""}`;
}

/** A short "yes" authorizes only the immediately preceding exact quote offer. */
export function confirmedGuidedQuoteRequest(query, history = []) {
  if (!/^(?:เอา|ได้|ตกลง|ทำเลย|จัดเลย|โอเค|ครับ|yes|please do)(?:เลย)?(?:ครับ|ค่ะ|คะ|ด้วย)?[.!\s]*$/iu.test(clean(query))) return null;
  const last = history.at(-1);
  if (last?.role !== "assistant" || !/ให้เอยทำใบเสนอราคาให้เลยไหมคะ|Would you like a quotation\?/iu.test(last.content)) return null;
  const sku = /\(SKU\s+([A-Z0-9._/-]+)\)/iu.exec(last.content)?.[1];
  const quantity = /(?:จำนวน|For)\s+(\d{1,6})\s+/iu.exec(last.content)?.[1];
  return sku && quantity ? { sku, qty: Number(quantity) } : null;
}

export async function guidedProductDecision(query, history, lang, lookup) {
  const lookupQuery = guidedCatalogQuery(query, history);
  if (!lookupQuery) return null;
  const result = await lookup(lookupQuery);
  if (result?.selection_required) {
    return { answer: pendingProductQuestion(result, lang), lookupQuery, result };
  }

  // An unavailable grit is not proof that the product family is unavailable.
  // Keep the requested backing/model/size, then offer only real catalog rows.
  const grit = productMatchFacets(lookupQuery).grit[0];
  if (grit && Number(result?.count ?? 0) === 0 && !result?.error) {
    if (/เท่านั้น|ไม่เอา.*(?:เบอร์|รุ่น|แบบ)อื่น|ต้อง(?:เป็น|ใช้)\s*#\s*\d+/iu.test(query)) {
      return { answer: null, lookupQuery, result, escalate: true };
    }
    const relaxedQuery = lookupQuery.replace(/\s*#\s*\d{1,5}[A-Z]?\b/iu, "").trim();
    const available = await lookup(relaxedQuery);
    if (available?.selection_required && available.match_scan_complete === true) {
      const intro = lang === "th"
        ? `ยังไม่พบเบอร์ ${grit} ของสินค้าที่ระบุในรายการที่ตรวจได้ค่ะ รุ่นและเบอร์ที่มีให้เลือก:`
        : `I could not find grit ${grit} for that product. Available catalog choices:`;
      return {
        answer: `${intro}\n${pendingProductQuestion(available, lang)}`,
        lookupQuery: relaxedQuery,
        result: available,
      };
    }
  }
  return { answer: null, lookupQuery, result };
}
