import { extractModelCodes, normalizeProductSearchQuery, productMatchFacets } from "./product-selection.mjs";
import { pendingProductQuestion } from "./product-turn-context.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const PRODUCT_RE = /กระดาษทราย|ผ้าทราย|สายพาน(?:ขัด|ทราย)|จานทราย|จาานราย|ม้วน\s*ใย(?:ขัด)?\s*สังเคราะห์|\b(?:SA331|PS36|MIRKA|MIKA)\b/iu;
const FLAP_DISC_RE = /จานทราย|\bflap\s*disc\b/iu;
const NONWOVEN_ROLL_RE = /ม้วน\s*ใย(?:ขัด)?\s*สังเคราะห์|\b(?:nonwoven|scotch\s*brite)\s*roll\b/iu;
const OTHER_PRODUCT_RE = /กระดาษทราย|ผ้าทราย|ม้วน\s*ใย(?:ขัด)?\s*สังเคราะห์|ล้อทราย|(?:ล้อ|ลูก)ขัด|ใบ(?:ขัด|ตัด|เจียร)|หินเจียร|แผ่น(?:ขัด|เจียร)|แปรง(?:ลวด|ขัด)|สายพาน(?:ขัด|ทราย)|สว่านลม|เครื่องมือ(?:ลม)?|ลูกยาง|\b(?:SA331|PS36|MIRKA|MIKA)\b/iu;
const PRODUCT_SWITCH_RE = /(?:ขอ)?เปลี่ยน(?:สินค้า)?(?:เป็น|ไป(?:หา)?)/iu;
const FOLLOW_UP_RE = /(?:^|\s)(?:#\s*\d+|(?:เบอร์|grit)\s*#?\s*\d+|(?:ขนาด|ไซซ์|size)\s*\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม)|\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม)|\d+\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?))|มีรุ่นไหน|รุ่นไหน|แนะนำ|\bmi(?:r)?ka\b|^\d{1,6}$/iu;
const QUANTITY_REPLY_RE = /^(?:(?:ต้องการ|เอา|สั่ง|จำนวน)\s*)?(\d{1,6})\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)?(?:\s*(?:ครับ|ค่ะ|คะ))?$/iu;
const QUANTITY_QUESTION_RE = /(?:จำนวน\s*กี่|ต้องการ\s*กี่|กี่\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)|ต้องการปรับจำนวน|how many|what quantity)/iu;
const SKU_RE = /\bSKU\s*[:：]?\s*([A-Z0-9._/-]+)/giu;
const PRODUCT_IN_QUESTION_RE = /(?:กระดาษทราย|ผ้าทราย|สายพาน(?:ขัด|ทราย)|จานทราย|ม้วน\s*ใย(?:ขัด)?\s*สังเคราะห์|ล้อทราย|ใบ(?:ขัด|ตัด|เจียร))/iu;

function quantityPrompt(query, history) {
  const match = QUANTITY_REPLY_RE.exec(clean(query));
  const last = history.at(-1);
  return match && last?.role === "assistant" && QUANTITY_QUESTION_RE.test(last.content)
    ? { qty: Number(match[1]), question: clean(last.content) } : null;
}

function productInQuantityQuestion(question) {
  const text = clean(question);
  const start = PRODUCT_IN_QUESTION_RE.exec(text)?.index;
  if (start == null) return null;
  return clean(text.slice(start)
    .split(/(?:จำนวน\s*กี่|ต้องการ\s*กี่|กี่\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?))/iu)[0]
    .replace(/\(?SKU\s*[:：]?\s*[A-Z0-9._/-]+\)?/giu, ""));
}

function skuCodes(text) {
  return [...String(text ?? "").matchAll(SKU_RE)].map((match) => match[1]);
}

export function normalizeQuoteProductReference(text) {
  return String(text ?? "").replace(/\bNo\.?\s*(\d{1,5}[A-Z]?)\b/giu, "#$1");
}

export function sameProductReference(question, card) {
  const family = (text) => {
    if (/สายพาน|\b(?:abrasive|sanding)\s+belt\b/iu.test(text)) return "belt";
    if (/ผ้าทราย\s*ม้วน|\bsanding\s*roll\b/iu.test(text)) return "sanding_roll";
    if (/จานทราย|\bflap\s*disc\b/iu.test(text)) return "flap_disc";
    if (/ใบเจียร|แผ่นเจียร|\bgrinding\s*disc\b/iu.test(text)) return "grinding_disc";
    if (/ใบตัด|\bcutting\s*disc\b/iu.test(text)) return "cutting_disc";
    if (/กระดาษทราย|ผ้าทราย|\bsanding\s*disc\b/iu.test(text)) return "sandpaper";
    return null;
  };
  const askedFamily = family(question);
  const cardFamily = family(card);
  if (askedFamily && cardFamily && askedFamily !== cardFamily) return false;
  const color = (text) => {
    const value = /(?:สี\s*(ฟ้า|น้ำเงิน|แดง|เขียว|ดำ|ขาว|เหลือง|เทา|ชมพู|ส้ม)|\b(blue|red|green|black|white|yellow|grey|gray|pink|orange)\b)/iu.exec(text)?.[1]
      ?? /\b(blue|red|green|black|white|yellow|grey|gray|pink|orange)\b/iu.exec(text)?.[1];
    if (!value) return null;
    const names = { ฟ้า: "blue", น้ำเงิน: "blue", แดง: "red", เขียว: "green",
      ดำ: "black", ขาว: "white", เหลือง: "yellow", เทา: "gray", ชมพู: "pink", ส้ม: "orange", grey: "gray" };
    return names[value.toLowerCase()] ?? value.toLowerCase();
  };
  const askedColor = color(question);
  const cardColor = color(card);
  // A customer who asks for a quote after the exact SKU card has selected that
  // item. Reject a stated color conflict, but never invent an unstated color.
  if (askedColor && cardColor && askedColor !== cardColor) return false;
  const models = (text) => [...String(text).toUpperCase().matchAll(/\b[A-Z]{1,6}[- ]?\d{2,}[A-Z0-9-]*\b/gu)]
    .map((match) => match[0].replace(/[^A-Z0-9]/gu, ""));
  const askedModels = models(question);
  const cardModels = models(card);
  if (askedModels.length && cardModels.length && !askedModels.some((model) => cardModels.includes(model))) return false;
  const askedFacets = productMatchFacets(normalizeQuoteProductReference(question));
  const cardFacets = productMatchFacets(normalizeQuoteProductReference(card));
  return ["size", "grit", "backing"].every((field) =>
    !askedFacets[field].length || !cardFacets[field].length
      || askedFacets[field].some((value) => cardFacets[field].includes(value)));
}

export function normalizeGuidedProductTerm(value) {
  return clean(value)
    .replace(/ม้วน\s*ใย\s*สังเคราะห์/gu, "ม้วนใยขัดสังเคราะห์")
    .replace(/สก๊อตไบรท์/gu, "สก๊อตไบร์ท")
    .replace(/หลังกา+ว/gu, "หลังกาว")
    .replace(/\bMIKA\b/giu, "MIRKA")
    .replace(/จาานราย/gu, "จานทราย")
    .replace(/จานทราย\s*ซ้อน/gu, "จานทราย");
}

const normalized = normalizeGuidedProductTerm;
const isOtherProductTurn = (value) => !FLAP_DISC_RE.test(value)
  && (OTHER_PRODUCT_RE.test(value) || PRODUCT_SWITCH_RE.test(value)
    && !productMatchFacets(value).size.length && !productMatchFacets(value).grit.length
    && !/หลังอ่อน|หลังแข็ง|หลังกาว|สักหลาด/iu.test(value));

function numberedChoice(query, history) {
  const last = history.at(-1);
  if (last?.role !== "assistant") return query;
  const options = String(last.content ?? "").split(/\r?\n/u)
    .map((line) => /^\s*\d{1,2}\.\s+(.+)$/u.exec(line)?.[1]?.trim())
    .filter(Boolean);
  const choice = /^\d{1,2}$/u.test(query)
    ? options[Number(query) - 1]
    : (() => {
      const term = query.replace(/^(?:ขอ(?:เป็น|เอา)|เอา)\s*/iu, "");
      if (!/^[A-Z][A-Z0-9 ._-]{2,30}$/iu.test(term)) return null;
      const matches = options.filter((option) => option.toUpperCase().includes(term.toUpperCase()));
      return matches.length === 1 ? matches[0] : null;
    })();
  return choice && (PRODUCT_RE.test(choice) || OTHER_PRODUCT_RE.test(choice)) ? choice : query;
}

function pendingExactQuantitySku(query, history) {
  const prompt = quantityPrompt(query, history);
  if (!prompt) return null;
  const exactSku = /\(SKU\s+([A-Z0-9._/-]+)\)/iu.exec(prompt.question)?.[1];
  if (exactSku) return exactSku;
  const product = productInQuantityQuestion(prompt.question);
  if (product) return product;
  if (history.slice(0, -1).some((item) => item.role === "user" && PRODUCT_RE.test(item.content))) return null;
  const priorCards = history.slice(0, -1).filter((item) => item.role === "assistant")
    .flatMap((item) => skuCodes(item.content));
  return [...new Set(priorCards)].length === 1 ? priorCards[0] : null;
}

function guidedFlapDiscQuery(current, history) {
  const currentIsFlapDisc = FLAP_DISC_RE.test(current) && !OTHER_PRODUCT_RE.test(current);
  const userTurns = history.slice(-12).filter((item) => item.role === "user")
    .map((item) => normalized(item.content));
  const lastProductTurn = [...userTurns].reverse().find((item) =>
    FLAP_DISC_RE.test(item) || isOtherProductTurn(item));
  if (!currentIsFlapDisc && (!lastProductTurn || !FLAP_DISC_RE.test(lastProductTurn)
    || isOtherProductTurn(current))) return null;
  const currentFacets = productMatchFacets(current);
  if (!currentIsFlapDisc && !FOLLOW_UP_RE.test(current)
    && !currentFacets.size.length && !currentFacets.grit.length
    && !/หลังอ่อน|หลังแข็ง|\bEco\b/iu.test(current)) return null;

  const lastOtherIndex = userTurns.findLastIndex(isOtherProductTurn);
  const sameTopicTurns = userTurns.slice(lastOtherIndex + 1);
  const freshRequestIndex = sameTopicTurns.findLastIndex((item) =>
    /^(?:มี|ขอ|สนใจ|ต้องการ|อยากได้)\s*จานทราย/iu.test(item));
  const context = /^(?:มี|ขอ|สนใจ|ต้องการ|อยากได้)\s*จานทราย/iu.test(current)
    ? [] : sameTopicTurns.slice(Math.max(0, freshRequestIndex));
  const values = [current, ...context.reverse()];
  const facets = values.map(productMatchFacets);
  const backing = facets.flatMap((item) => item.backing)
    .find((item) => item === "หลังอ่อน" || item === "หลังแข็ง") ?? "";
  const size = facets.flatMap((item) => item.size)[0] ?? "";
  const grit = facets.flatMap((item) => item.grit)[0] ?? "";
  const model = values.map((item) => extractModelCodes(item)[0]
    ?? /\bEco\b/iu.exec(item)?.[0]).find(Boolean) ?? "";
  const fullCatalogChoice = /^จานทรายหลัง(?:อ่อน|แข็ง)\s+(?:[A-Z]{2,6}\d+[A-Z0-9-]*|Eco)\b/iu.test(current);
  const base = fullCatalogChoice ? current : ["จานทราย" + backing, model].filter(Boolean).join(" ");
  return [base,
    ...(size && !productMatchFacets(base).size.length ? [size] : []),
    ...(grit && !productMatchFacets(base).grit.length ? [grit] : []),
  ].join(" ");
}

/** A narrow, catalog-derived query for disc selections and adjacent replies. */
export function guidedCatalogQuery(query, history = []) {
  const quantitySku = pendingExactQuantitySku(clean(query), history);
  if (quantitySku) return quantitySku;
  const current = normalized(numberedChoice(clean(query), history));
  const flapDiscQuery = guidedFlapDiscQuery(current, history);
  if (flapDiscQuery) return flapDiscQuery;
  if (NONWOVEN_ROLL_RE.test(current)) return current;
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
  if (!backingText || !/(?:กระดาษทราย|SA331|PS36|MIRKA)/iu.test(current + " " + prior) && !/หลังกาว/iu.test(current)) {
    if (OTHER_PRODUCT_RE.test(current) || extractModelCodes(current).length) {
      return normalizeProductSearchQuery(current);
    }
    if (!FOLLOW_UP_RE.test(current)) return null;
    const lastProduct = [...history].reverse().find((item) => item.role === "user"
      && (OTHER_PRODUCT_RE.test(normalized(item.content)) || extractModelCodes(item.content).length
        || isOtherProductTurn(normalized(item.content))));
    if (!lastProduct) return null;
    if (!OTHER_PRODUCT_RE.test(normalized(lastProduct.content)) && !extractModelCodes(lastProduct.content).length) return null;
    let base = normalized(normalizeProductSearchQuery(lastProduct.content));
    const facets = productMatchFacets(current);
    if (facets.size.length) base = base.replace(/\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม)/giu, " ");
    if (facets.grit.length) base = base.replace(/#\s*\d{1,5}[A-Z]?|(?:เบอร์|grit)\s*#?\s*\d{1,5}[A-Z]?/giu, " ");
    const additional = [facets.size[0], facets.grit[0], facets.backing[0], facets.holes[0]]
      .filter(Boolean).join(" ");
    return clean(`${base} ${additional}`);
  }

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
  const explicit = /(?:^|\s)(\d{1,6})\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)(?:\s|$)/iu.exec(current);
  if (explicit) return Number(explicit[1]);
  if (/^\d{1,6}$/u.test(current) && QUANTITY_QUESTION_RE.test(String(history.at(-1)?.content ?? ""))) {
    return Number(current);
  }
  if (PRODUCT_RE.test(clean(resolvedQuery)) && history.at(-1)?.role === "assistant") {
    const modelOf = (value) => extractModelCodes(value)[0]
      ?? (/MIRKA\s+GOLD/iu.test(value) ? "MIRKA GOLD" : /\bEco\b/iu.test(value) ? "Eco" : "");
    const resolvedModel = modelOf(resolvedQuery);
    const resolvedBacking = productMatchFacets(resolvedQuery).backing;
    for (const item of [...history].slice(-8).reverse()) {
      if (item.role !== "user") continue;
      const prior = normalized(item.content);
      const priorModel = modelOf(prior);
      const priorBacking = productMatchFacets(prior).backing;
      if (NONWOVEN_ROLL_RE.test(prior) !== NONWOVEN_ROLL_RE.test(resolvedQuery)) break;
      if (NONWOVEN_ROLL_RE.test(resolvedQuery)) {
        const priorFacets = productMatchFacets(prior);
        const currentFacets = productMatchFacets(resolvedQuery);
        if (["size", "grit"].some((field) => priorFacets[field].length && currentFacets[field].length
          && !priorFacets[field].every((value) => currentFacets[field].includes(value)))) break;
      }
      if (priorModel && resolvedModel && priorModel !== resolvedModel) break;
      if (priorBacking.length && resolvedBacking.length && !priorBacking.every((backing) => resolvedBacking.includes(backing))) break;
      const quantity = /(?:^|\s)(\d{1,6})\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)(?:\s|$)/iu.exec(prior);
      if (quantity) return Number(quantity[1]);
    }
  }
  return null;
}

export function guidedExactProductAnswer(product, quantity = null, price = null, lang = "th") {
  const name = clean(lang === "th" ? product.name_th || product.name_en : product.name_en || product.name_th);
  const verifiedColor = clean(product.verified_color);
  const displayName = lang === "th" && verifiedColor && !name.includes(`สี${verifiedColor}`)
    ? `${name} สี${verifiedColor}` : name;
  const sku = clean(product.sku);
  const unit = clean(product.unit) || (lang === "th" ? "ชิ้น" : "piece");
  const stock = Number(product.stock);
  const stockText = Number.isFinite(stock)
    ? lang === "th" ? `สต็อกที่ตรวจได้ ${stock} ${unit}` : `Current stock: ${stock} ${unit}`
    : "";
  const minimum = Math.max(1, Number(product.min_order_qty ?? 1));
  if (quantity != null && quantity < minimum) {
    return lang === "th"
      ? `พบ ${displayName} (SKU ${sku}) ค่ะ ขั้นต่ำ ${minimum} ${unit} ต้องการปรับจำนวนเป็นเท่าไรคะ`
      : `I found ${name} (SKU ${sku}). The minimum is ${minimum} ${unit}. What quantity would you like?`;
  }
  if (quantity != null && price?.ok === true && price?.exact_match === true && price?.sku === sku) {
    return lang === "th"
      ? `พบ ${displayName} (SKU ${sku}) ค่ะ จำนวน ${quantity} ${unit} ราคา ${price.unit_price} บาท/${unit}${stockText ? ` ${stockText}` : ""}\nให้เอยทำใบเสนอราคาให้เลยไหมคะ`
      : `I found ${name} (SKU ${sku}). For ${quantity} ${unit}, the price is THB ${price.unit_price}/${unit}.${stockText ? ` ${stockText}.` : ""} Would you like a quotation?`;
  }
  if (quantity != null) return null;
  return lang === "th"
    ? `พบ ${displayName} (SKU ${sku}) ค่ะ${stockText ? ` ${stockText}` : ""} ต้องการกี่${unit}คะ${minimum > 1 ? ` (ขั้นต่ำ ${minimum} ${unit})` : ""}`
    : `I found ${name} (SKU ${sku}).${stockText ? ` ${stockText}.` : ""} How many ${unit} would you like?${minimum > 1 ? ` (Minimum ${minimum} ${unit})` : ""}`;
}

const SHORT_QUOTE_CONSENT_RE = /^(?:เอา|ได้|ตกลง|ทำ|ทํา|จัด|โอเค|yes|please do)(?:เลย)?(?:ครับ|ค่ะ|คะ|ด้วย)?[.!\s]*$/iu;
const DIRECT_QUOTE_RE = /(?:ขอ|ต้องการ|อยากได้|ออก|ทำ|ทํา|จัดทำ|จัดทํา|ส่ง)\s*(?:ใบเสนอราคา|ใบราคา)|\b(?:issue|prepare|create|make|send|need|want|request)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?(?:quotation|quote)\b/iu;
const EXACT_QUOTE_OFFER_RE = /ให้เอยทำใบเสนอราคาให้เลยไหมคะ|Would you like a quotation\?/iu;
const COMPLETED_QUOTE_RE = /(?:ทำ|ทํา|สร้าง|ออก|ใช้)ใบเสนอราคา(?:ฉบับ)?(?:เลขที่|หมายเลข)?\s*(QT-\d+)/iu;
const bareQuoteRequest = (text) => DIRECT_QUOTE_RE.test(text)
  && !/ใบเสนอราคาใหม่|\bnew\s+(?:quotation|quote)\b|\bQT-\d+\b/iu.test(text)
  && !OTHER_PRODUCT_RE.test(text) && extractModelCodes(text).length === 0
  && !/(?:\bSKU\s*[:：]?\s*[A-Z0-9._/-]+|\d{1,6}\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)|#\s*\d+|(?:เบอร์|ขนาด|ไซซ์|size|grit)\s*\d+)/iu.test(text);

/** Resolve a confirmed exact offer, including a direct repeat after one short consent. */
export function confirmedGuidedQuoteRequest(query, history = []) {
  const text = clean(query);
  const shortConsent = SHORT_QUOTE_CONSENT_RE.test(text);
  const directRequest = bareQuoteRequest(text);
  if (!shortConsent && !directRequest) return null;
  const offerIndex = history.findLastIndex((item) => item.role === "assistant"
    && EXACT_QUOTE_OFFER_RE.test(item.content));
  if (offerIndex < 0 || shortConsent && offerIndex !== history.length - 1) return null;
  const offer = history[offerIndex].content;
  const skus = [...new Set(skuCodes(offer))];
  const quantity = /(?:จำนวน|For)\s+(\d{1,6})\s+/iu.exec(offer)?.[1];
  if (skus.length !== 1 || !quantity) return null;
  let existingQuoteCode = null;
  for (const item of history.slice(offerIndex + 1)) {
    if (item.role === "user" && (SHORT_QUOTE_CONSENT_RE.test(clean(item.content))
      || bareQuoteRequest(clean(item.content)))) continue;
    const completed = item.role === "assistant" && COMPLETED_QUOTE_RE.exec(item.content);
    if (!completed) return null;
    existingQuoteCode = completed[1];
  }
  return existingQuoteCode
    ? { sku: skus[0], qty: Number(quantity), existingQuoteCode }
    : { sku: skus[0], qty: Number(quantity) };
}

/** Quantity may finish only the customer's immediately pending, exact-SKU quote request. */
export function pendingQuoteQuantityRequest(query, history = []) {
  const prompt = quantityPrompt(query, history);
  if (!prompt || /\bQT-\d+\b|(?:สร้าง|ทำ|ส่ง)ใบเสนอราคา(?:เลขที่|แล้ว)/iu.test(prompt.question)) return null;
  const quoteIndex = history.findLastIndex((item) => item.role === "user");
  const quoteText = clean(history[quoteIndex]?.content);
  if (quoteIndex < 0 || !DIRECT_QUOTE_RE.test(quoteText)
    || /\bQT-\d+\b|ใบเสนอราคา(?:ฉบับ)?เดิม/iu.test(quoteText)) return null;
  if (history.slice(quoteIndex + 1).some((item) => /\bQT-\d+\b|(?:สร้าง|ทำ|ส่ง)ใบเสนอราคา(?:เลขที่|แล้ว)/iu.test(item.content))) return null;
  if (!/ใบเสนอราคาใหม่|new\s+(?:quotation|quote)/iu.test(quoteText)
    && history.slice(0, quoteIndex).some((item) => item.role === "assistant"
      && /\bQT-\d+\b|(?:สร้าง|ทำ|ส่ง)ใบเสนอราคา(?:เลขที่|แล้ว)/iu.test(item.content))) return null;

  const questionSku = [...new Set(skuCodes(prompt.question))];
  const questionProduct = productInQuantityQuestion(prompt.question);
  const priorProduct = [...history.slice(0, quoteIndex)].reverse().find((item) =>
    item.role === "user" && PRODUCT_IN_QUESTION_RE.test(item.content));
  if (questionProduct && priorProduct && !sameProductReference(questionProduct, priorProduct.content)) return null;
  const cards = history.slice(0, quoteIndex).filter((item) => item.role === "assistant")
    .flatMap((item) => skuCodes(item.content).map((sku) => ({ sku, content: item.content })));
  const matches = cards.filter((card) =>
    (!questionProduct || sameProductReference(questionProduct, card.content))
    && (!priorProduct || sameProductReference(priorProduct.content, card.content)));
  const candidates = questionSku.length ? questionSku : [...new Set(matches.map((card) => card.sku))];
  if (candidates.length !== 1) return null;
  const sku = candidates[0];
  if (cards.length && !matches.some((card) => card.sku === sku)) return null;
  return {
    sku, qty: prompt.qty,
    productQuery: questionProduct ?? clean(priorProduct?.content),
    customerProductQuery: clean(priorProduct?.content),
  };
}

/** A model tool call is not consent to issue a document. Check the customer turn. */
export function quoteCreationBlockReason(query, hasImages, history = []) {
  if (hasImages) return "image_or_document";
  const text = clean(query);
  if (!text) return "empty_message";
  if (/^(?:ขอบคุณ|ขอบใจ|thanks?|thank\s+you)(?:\s*(?:มาก|มากครับ|มากค่ะ|ครับ|ค่ะ|นะ|นะครับ|นะคะ|so\s+much|very\s+much|again|!|🙏|😊|🙂))*$/iu.test(text)) {
    return "acknowledgement";
  }
  if (/(?:สั่งสินค้า|สั่งของ).{0,16}(?:ยังไง|อย่างไร|วิธี)|(?:วิธี|ขั้นตอน).{0,16}(?:สั่งสินค้า|สั่งของ)/iu.test(text)) {
    return "ordering_information";
  }
  if (/(?:ชำระ|ชําระ|จ่าย|โอน|มัดจำ|มัดจํา|payment|pay\b)/iu.test(text)
    && /(?:ก่อน|ไหม|มั้ย|หรือไม่|อย่างไร|ยังไง|วิธี|เมื่อไร|\?)/iu.test(text)) {
    return "payment_question";
  }
  if (/(?:QT-\d+|ใบเสนอราคา(?:ฉบับ)?เดิม|ใบเสนอราคา.{0,20}(?:เลขที่|ที่ส่ง|ที่ทำ|แล้วหรือยัง|ส่งแล้ว|สถานะ))/iu.test(text)
    && !/ใบเสนอราคาใหม่/iu.test(text)) {
    return "existing_quote_followup";
  }
  const directRequest = DIRECT_QUOTE_RE.test(text);
  const latestOfferIndex = history.findLastIndex((item) => item.role === "assistant"
    && EXACT_QUOTE_OFFER_RE.test(item.content));
  if (bareQuoteRequest(text)
    && history.slice(latestOfferIndex + 1).some((item) => item.role === "assistant"
      && COMPLETED_QUOTE_RE.test(item.content))) return "existing_quote_followup";
  if (directRequest) return null;
  if (pendingQuoteQuantityRequest(text, history)) return null;
  const shortConsent = SHORT_QUOTE_CONSENT_RE.test(text);
  const last = history.at(-1);
  const quoteOffer = last?.role === "assistant"
    && /(?:ใบเสนอราคา|quotation).{0,40}(?:ไหม|มั้ย|หรือเปล่า|หรือไม่|\?)/iu.test(last.content);
  return shortConsent && quoteOffer ? null : "not_explicit_quote_request";
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
        ? `ยังไม่พบเบอร์ ${grit} ของสินค้าที่ระบุในรายการที่ตรวจได้ค่ะ ตัวเลือกที่มีในระบบ:`
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
