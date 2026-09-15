import {
  extractModelCodes,
  normalizeProductSearchQuery,
  productIdentitySearchText,
} from "./product-selection.mjs";

const AMOUNT_SOURCE = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;

const PRICE_LABEL_AMOUNT_RE = new RegExp(
  String.raw`(?:ราคาสุทธิ|ราคาขาย|ราคาสินค้า|ราคาต่อหน่วย|ราคา|selling\s+price|product\s+price|unit\s+price|price)\s*(?:อยู่ที่|เริ่มต้น(?:ที่)?|คือ|เท่ากับ|starts?\s+at|is|=|:)?\s*(?:฿|THB\s*|\$)?${AMOUNT_SOURCE}`,
  "iu",
);
const PER_UNIT_AMOUNT_RE = new RegExp(
  String.raw`(?:(?:ตัว|ชิ้น|แผ่น|กล่อง|ชุด|ม้วน|อัน|หน่วย)\s*ละ\s*(?:฿|THB\s*)?${AMOUNT_SOURCE}(?![\d,.])(?=\s*(?:บาท|THB|ค่ะ|ครับ|$|[.,!?]))|(?:each|per\s+(?:piece|sheet|box|set|roll|unit))\s*(?:is|=|:)?\s*(?:฿|THB\s*|\$)?${AMOUNT_SOURCE}(?![\d,.])(?=\s*(?:THB|baht|$|[.,!?]))|${AMOUNT_SOURCE}\s*(?:บาท|THB)?\s*(?:\/|ต่อ)\s*(?:ชิ้น|แผ่น|กล่อง|ชุด|ม้วน|อัน|หน่วย|piece|sheet|box|set|roll|unit))`,
  "iu",
);
const CURRENCY_AMOUNT_RE = new RegExp(
  String.raw`(?:฿|\bTHB\b|\$)\s*${AMOUNT_SOURCE}|${AMOUNT_SOURCE}\s*(?:บาท|บ\.?|฿|\bTHB\b)`,
  "iu",
);
const PRICE_DASH_AMOUNT_RE = new RegExp(
  String.raw`${AMOUNT_SOURCE}(?![\d,])\s*\.\s*-`,
  "iu",
);
const CONTEXTUAL_UNLABELLED_AMOUNT_RE = new RegExp(
  String.raw`(?:อยู่ที่|เพียง|เริ่มต้น(?:ที่)?|เท่ากับ|comes?\s+to|starts?\s+at|only)\s*(?:฿|THB\s*|\$)?${AMOUNT_SOURCE}(?![\d,.])(?=\s*(?:บาท|THB|baht|ค่ะ|ครับ|$|[.,!?]))`,
  "iu",
);
const BARE_PRICE_ANSWER_RE = new RegExp(
  String.raw`^\s*(?:฿|THB\s*|\$)?${AMOUNT_SOURCE}\s*(?:บาท|บ\.?|฿|THB|baht)?\s*(?:ค่ะ|ครับ|คะ|นะคะ|นะครับ)?\s*[.!?]*\s*$`,
  "iu",
);

const PRODUCT_PRICE_INTENT_RE = /(?:ราคาสินค้า|ราคาขาย|ราคาสุทธิ|ราคาต่อหน่วย|สินค้า.{0,40}ราคา|(?:selling|product|unit)\s+price)/iu;
const GENERIC_PRICE_INTENT_RE = /(?:เช็ก|เช็ค|สอบถาม|ถาม|ดู|ขอ)?\s*ราคา|กี่บาท|เท่า(?:ไหร่|ไร)|ใบเสนอราคา|ส่วนลด|\bprice\b|\bhow\s+much\b|\bquote\b|\bquotation\b|\bdiscount\b/iu;
const NON_PRODUCT_MONEY_INTENT_RE = /(?:ค่าขนส่ง|ค่าส่ง|ค่าจัดส่ง|ค่าธรรมเนียม|ชำระเงิน|แจ้งโอน|โอนเงิน|เลขบัญชี|ยอดเก็บเงิน|ยอด\s*COD|\bshipping\s+(?:fee|cost|price)\b|\bdelivery\s+(?:fee|cost|price)\b|\bfreight\b|\bpayment\b|\bbank\s+transfer\b|\bCOD\b|\bfee\b)/iu;
const NON_PRODUCT_MONEY_ANSWER_RE = /(?:ค่าขนส่ง|ค่าส่ง|ค่าจัดส่ง|ค่าธรรมเนียม|ยอดชำระ|ยอดโอน|\bshipping\b|\bdelivery\b|\bfreight\b|\bpayment\b|\bbank\b|\bCOD\b|\bfee\b)/iu;
const PRODUCT_PRICE_ANSWER_RE = /(?:ราคาสินค้า|ราคาขาย|ราคาสุทธิ|ราคาต่อหน่วย|ต่อชิ้น|ต่อแผ่น|ต่อกล่อง|(?:selling|product|unit)\s+price|per\s+(?:piece|sheet|box|set|roll|unit))/iu;
const ITEM_UNIT_SOURCE = String.raw`(?:ตัว|ชิ้น|แผ่น|ใบ|กล่อง|ชุด|ม้วน|อัน|หน่วย|แพ็ก|ห่อ|ลัง|กระป๋อง|ขวด|เครื่อง|pack(?:s)?|piece(?:s)?|sheet(?:s)?|box(?:es)?|set(?:s)?|roll(?:s)?|unit(?:s)?|pcs?)`;
const QUANTITY_CUE_RE = new RegExp(
  String.raw`(?:จำนวน\s*[:=]?\s*\d+|\d+\s*${ITEM_UNIT_SOURCE})(?=\s|[.,!?;:/]|$)`,
  "iu",
);
const OWN_QUANTITY_RE = new RegExp(
  String.raw`(?:จำนวน|qty|quantity)\s*[:=]?\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*${ITEM_UNIT_SOURCE}(?=\s|[.,!?;:/]|$)`,
  "iu",
);
const SHARED_EACH_RE = new RegExp(
  String.raw`(?:อย่างละ\s*\d+(?:\.\d+)?(?:\s*${ITEM_UNIT_SOURCE})?|\b\d+(?:\.\d+)?\s*(?:${ITEM_UNIT_SOURCE}\s*)?each\b)`,
  "iu",
);
const SKU_TOKEN_SOURCE = String.raw`[A-Z0-9][A-Z0-9._/-]*`;
const EXPLICIT_SKU_RE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(?:SKUs?|รหัสสินค้า)(?:\s*(?:[:#=]|-)?\s*)(${SKU_TOKEN_SOURCE})`,
  "giu",
);
const INHERITED_SKU_LIST_RE = new RegExp(
  String.raw`(?:SKUs?|รหัสสินค้า)\s*[:=]\s*(${SKU_TOKEN_SOURCE}(?:\s*(?:[,;|&]|\band\b|และ)\s*${SKU_TOKEN_SOURCE})+)`,
  "giu",
);
const INHERITED_SKU_SEPARATOR_RE = /\s*(?:[,;|&]|\band\b|และ)\s*/iu;
const COREBIZ_NUMERIC_SKU_RE = /\b20\d{8}\b/gu;
const CONTACT_OR_TAX_CUE_RE = /(?:เบอร์โทร|โทร|เลขผู้เสียภาษี|เลขภาษี|phone|telephone|tax\s*id)/iu;
const NON_PRODUCT_MODEL_PREFIXES = new Set([
  "CM", "COD", "DIN", "DN", "GRIT", "ISO", "KG", "MM", "MOQ", "PCS", "PO", "QT", "SIZE", "SO", "TEL", "THB", "VAT",
]);
const PRODUCT_NAME_ANCHOR_SOURCE = String.raw`(?:กระดาษทราย(?:\s*กลม)?|ผ้าทราย(?:\s*(?:สายพาน|ม้วน))?|จานทราย(?:\s*ซ้อน)?|ล้อทราย(?:\s*มีแกน)?|(?:ล้อ|ลูก)\s*ขัด|ฟองน้ำ(?:\s*ขัด)?|ใบ(?:ตัด|เจียร|ขัด|เลื่อย)|จาน(?:ตัด|เจียร|ขัด)|ดอก(?:เจาะ|เจียร|กัด)|เครื่อง(?:ขัด|เจียร|ตัด)|หินเจียร|แผ่นขัด|แปรงลวด|ปืนลม|สว่าน|เทป|กาว|น้ำยา|อะไหล่|sanding\s+(?:disc|belt|roll)|abrasive\s+(?:disc|belt|roll|wheel)|sandpaper|flap\s+disc|cutting\s+(?:disc|wheel)|grinding\s+(?:disc|wheel)|nonwoven\s+wheel|mounted\s+wheel|wire\s+brush|drill\s+bit|saw\s+blade|power\s+tool|pneumatic\s+tool)`;
const PRODUCT_NAME_ANCHOR_RE = new RegExp(PRODUCT_NAME_ANCHOR_SOURCE, "iu");
const CANDIDATE_ITEM_SEPARATOR_RE = new RegExp(
  String.raw`;+\s*|\|+\s*|,(?!\d)\s*|\s+[+&]\s+|\s+(?:และ|กับ|รวมทั้ง|รวมถึง|พร้อมกับ|and|plus|as\s+well\s+as)\s+|และ(?=${PRODUCT_NAME_ANCHOR_SOURCE})|กับ(?=${PRODUCT_NAME_ANCHOR_SOURCE})`,
  "iu",
);
const ATTRIBUTE_ONLY_PREFIX_RE = /^(?:(?:และ|กับ)\s*)?(?:ขนาด|ไซซ์|เบอร์|เกรด|รุ่น|จำนวน|สี|ยี่ห้อ|แบบ|ชนิด|ใช้กับ|ใช้งาน|สำหรับ|ความหนา|ความกว้าง|ความยาว|เส้นผ่านศูนย์กลาง|รู|บรรจุ|แพ็ก|รายละเอียด|ข้อมูล|สเป[กค]|สต็อก|รูป|วิธีใช้|ค่าส่ง|บริษัท|โทร|size\b|grit\b|grade\b|model\b|qty\b|quantity\b|colou?r\b|brand\b|with\b|without\b|for\b|use(?:d)?\b|application\b|pack(?:ing)?\b|width\b|length\b|height\b|diameter\b|thickness\b|compatible\b|fits?\b|details?\b|specs?\b|stock\b|image\b|shipping\b|company\b|phone\b|MOQ\b)/iu;
const QUANTITY_DETAIL_RE = new RegExp(
  String.raw`(?:อย่างละ|จำนวน|qty|quantity)\s*[:=]?\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*${ITEM_UNIT_SOURCE}\b`,
  "giu",
);
const REQUEST_FILLER_RE = /(?:ขอ|เช็ก|เช็ค|สอบถาม|ดู|รบกวน|ช่วย|ราคา|ราคาสินค้า|เท่าไหร่|เท่าไร|กี่บาท|อย่างละ|ต้องการ|please|check|price|pricing|quote|quotation|how\s+much|need|want|for|of|each)/giu;
const ENGLISH_NAME_TOKEN_RE = /\b(?:[A-Z][A-Za-z0-9&.+/-]{1,}|\d+[A-Z][A-Z0-9&.+/-]*)\b/g;
const ENGLISH_LEXICAL_TOKEN_RE = /\b[a-z][a-z0-9&.+/-]{1,}\b/giu;
const ENGLISH_ATTRIBUTE_WORDS = new Set([
  "and", "as", "at", "baht", "black", "blue", "box", "boxes", "brand", "color", "colour",
  "each", "for", "grade", "grit", "inch", "inches", "mm", "model", "pack", "packs", "piece",
  "pieces", "qty", "quantity", "red", "sheet", "sheets", "size", "stainless", "steel", "thb", "unit",
  "units", "velcro", "white", "with", "without",
]);
const VARIANT_SIZE_RE = /\b(\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?){0,3})\s*(นิ้ว|inch(?:es)?|in\b|มม\.?|mm\b|ซม\.?|cm\b|")/giu;
const VARIANT_GRIT_RE = /(?:#\s*|\bP\s*|(?:เบอร์|grit)\s*[:=]?\s*#?\s*)(\d{1,5}[A-Z]?)/giu;
const VARIANT_HOLE_RE = /(?:ไม่มีรู|ไม่เจาะรู|no\s*holes?|\b\d{1,3}\s*รู\b|\bholes?\s*[:=]?\s*\d{1,3}\b)/giu;
const VARIANT_BACKING_RE = /(?:สักหลาด|หลังกาว|velcro|hook\s*(?:and|&)\s*loop|adhesive|\bPSA\b)/giu;
const RELATIONAL_CONNECTOR_RE = /(?:ใช้|ใช้งาน|เหมาะ|เข้า|คู่|ทำงานร่วม)\s*กับ|compatible\s+with|for\s+use\s+with|fits?\s+(?:with\s+)?/giu;
const LIST_MARKER_RE = /(?:^|[\r\n]|\s)(?:\d{1,2}[.)]|[-•])\s+/gu;

export function hasSellingPriceIntent(query) {
  const value = String(query ?? "").trim();
  if (!value) return false;
  if (PRODUCT_PRICE_INTENT_RE.test(value)) return true;
  if (NON_PRODUCT_MONEY_INTENT_RE.test(value)) return false;
  return GENERIC_PRICE_INTENT_RE.test(value);
}

/**
 * Detect a money number only when the surrounding text identifies it as a
 * selling price. Model/SKU/grit/size/quantity numbers have no price or currency
 * marker, so they deliberately do not match this guard.
 */
export function hasNumericSellingPrice(answer, query = "", productContext = false) {
  const value = String(answer ?? "").replace(/\u00a0/g, " ");
  if (!value) return false;

  const clearlyNonProductMoney = NON_PRODUCT_MONEY_INTENT_RE.test(String(query ?? "")) &&
    NON_PRODUCT_MONEY_ANSWER_RE.test(value) &&
    !PRODUCT_PRICE_ANSWER_RE.test(value);
  if (clearlyNonProductMoney) return false;

  if (PRICE_LABEL_AMOUNT_RE.test(value)) return true;
  const priceContext = productContext || hasSellingPriceIntent(query);
  if (!priceContext) return false;
  return PER_UNIT_AMOUNT_RE.test(value) ||
    CURRENCY_AMOUNT_RE.test(value) ||
    PRICE_DASH_AMOUNT_RE.test(value) ||
    CONTEXTUAL_UNLABELLED_AMOUNT_RE.test(value) ||
    (hasSellingPriceIntent(query) && BARE_PRICE_ANSWER_RE.test(value));
}

/**
 * Conservative lower bound for explicit multi-item requests. We count only
 * values that the customer labels as SKU, so model/grit/size numbers for one
 * product do not become extra line items. The caller's resolved-product count
 * remains the primary signal for requests written only with product names.
 */
export function inferExplicitRequestedSkuCount(query) {
  const skus = new Set();
  const value = String(query ?? "");
  for (const match of value.matchAll(EXPLICIT_SKU_RE)) {
    const sku = String(match[1] ?? "").replace(/[.,;!?]+$/g, "").trim().toUpperCase();
    if (sku) skus.add(sku);
  }
  for (const match of value.matchAll(INHERITED_SKU_LIST_RE)) {
    for (const token of String(match[1] ?? "").split(INHERITED_SKU_SEPARATOR_RE)) {
      const sku = token.replace(/[.,;!?]+$/g, "").trim().toUpperCase();
      if (sku) skus.add(sku);
    }
  }
  return skus.size;
}

function extractRequestedProductModelCodes(value) {
  return extractModelCodes(value).filter((code) => {
    const prefix = code.match(/^[A-Z]+/)?.[0] ?? "";
    return !NON_PRODUCT_MODEL_PREFIXES.has(prefix);
  });
}

function hasOwnQuantity(value) {
  return OWN_QUANTITY_RE.test(String(value ?? ""));
}

function variantFingerprint(value) {
  const variants = [];
  for (const match of String(value ?? "").matchAll(VARIANT_SIZE_RE)) {
    const unit = /^(?:มม|mm)/iu.test(match[2])
      ? "mm"
      : /^(?:ซม|cm)/iu.test(match[2])
      ? "cm"
      : "in";
    variants.push(`size:${String(match[1]).replace(/\s+/g, "").toLowerCase()}${unit}`);
  }
  for (const match of String(value ?? "").matchAll(VARIANT_GRIT_RE)) {
    variants.push(`grit:${String(match[1]).toUpperCase()}`);
  }
  for (const match of String(value ?? "").matchAll(VARIANT_HOLE_RE)) {
    variants.push(`hole:${String(match[0]).replace(/\s+/g, "").toLowerCase()}`);
  }
  for (const match of String(value ?? "").matchAll(VARIANT_BACKING_RE)) {
    variants.push(`backing:${String(match[0]).replace(/\s+/g, "").toLowerCase()}`);
  }
  return [...new Set(variants)].sort().join("|");
}

function explicitSkuValues(value) {
  const skus = [];
  for (const match of String(value ?? "").matchAll(EXPLICIT_SKU_RE)) {
    const sku = String(match[1] ?? "").replace(/[.,;!?]+$/g, "").trim().toUpperCase();
    if (sku) skus.push(sku);
  }
  return [...new Set(skus)];
}

function productIdentityKey(rawClause, allowFlexibleName = false) {
  const original = String(rawClause ?? "")
    .replace(/^\s*(?:\d{1,2}[.)]|[-•])\s*/u, "")
    .trim();
  if (!original || ATTRIBUTE_ONLY_PREFIX_RE.test(original)) return null;

  const labelledSkus = explicitSkuValues(original);
  if (labelledSkus.length > 0) return `sku:${labelledSkus.sort().join("+")}`;

  if (hasOwnQuantity(original) && !CONTACT_OR_TAX_CUE_RE.test(original)) {
    const numericSkus = [...original.matchAll(COREBIZ_NUMERIC_SKU_RE)].map((match) => match[0]);
    if (numericSkus.length > 0) return `sku:${[...new Set(numericSkus)].sort().join("+")}`;
  }

  const variant = variantFingerprint(original);
  const variantSuffix = variant ? `|${variant}` : "";
  const modelCodes = extractRequestedProductModelCodes(original);
  if (modelCodes.length > 0) return `model:${modelCodes.sort().join("+")}${variantSuffix}`;

  const identity = productIdentitySearchText(normalizeProductSearchQuery(original))
    .replace(QUANTITY_DETAIL_RE, " ")
    .replace(REQUEST_FILLER_RE, " ")
    // Thai vowels/tone marks are Unicode marks rather than letters. Keep
    // them, otherwise product anchors such as ใบตัด are corrupted.
    .replace(/[^\p{L}\p{M}\p{N}&.+/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!identity || ATTRIBUTE_ONLY_PREFIX_RE.test(identity)) return null;
  if (PRODUCT_NAME_ANCHOR_RE.test(identity)) {
    return `name:${identity.toLocaleLowerCase("th-TH")}${variantSuffix}`;
  }

  // Names such as "Sign Neon Gloss" or "Mirka Gold" have no generic product
  // noun. Require at least two title/upper-case tokens and discard common
  // specification words so a colour, material, size, or backing clause cannot
  // create a phantom second item.
  const nameTokens = [...identity.matchAll(ENGLISH_NAME_TOKEN_RE)]
    .map((match) => match[0])
    .filter((token) => !ENGLISH_ATTRIBUTE_WORDS.has(token.toLowerCase()));
  if (nameTokens.length >= 2) return `en:${nameTokens.join(" ").toLowerCase()}${variantSuffix}`;
  if (!allowFlexibleName) return null;

  const lexicalTokens = [...identity.matchAll(ENGLISH_LEXICAL_TOKEN_RE)]
    .map((match) => match[0].toLowerCase())
    .filter((token) => !ENGLISH_ATTRIBUTE_WORDS.has(token));
  if (lexicalTokens.length >= 2) return `en:${lexicalTokens.join(" ")}${variantSuffix}`;
  const thaiName = identity.match(/[\u0E00-\u0E7F]{4,}/u)?.[0] ?? "";
  return thaiName ? `th:${identity.toLocaleLowerCase("th-TH")}${variantSuffix}` : null;
}

function requestedItemSegments(value) {
  const markerCount = [...value.matchAll(LIST_MARKER_RE)].length;
  if (markerCount >= 2) {
    return {
      mode: "numbered",
      segments: value
        .replace(LIST_MARKER_RE, "\n")
        .split(/\r?\n+/u)
        .map((segment) => segment.trim())
        .filter(Boolean),
    };
  }

  const lines = value.split(/\r?\n+/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every(hasOwnQuantity)) {
    return { mode: "quantity_lines", segments: lines };
  }

  // Descriptive wrapping is not an item boundary. Protect relational phrases
  // first so a compatible tool/model stays a detail of the requested item.
  const collapsed = lines.join(" ").replace(RELATIONAL_CONNECTOR_RE, " connected-to ");
  return {
    mode: SHARED_EACH_RE.test(collapsed) ? "shared_each" : "candidate",
    segments: collapsed
      .split(CANDIDATE_ITEM_SEPARATOR_RE)
      .map((segment) => segment.trim())
      .filter(Boolean),
  };
}

/**
 * Derive a conservative lower bound from the raw customer request before any
 * product lookup runs. It recognises distinct labelled SKUs/model codes and
 * clearly separated product-name clauses. A detail alone never creates an
 * item; a size/grit fingerprint only distinguishes two independently
 * evidenced clauses for variants that can have different SKUs and prices.
 */
export function inferRequestedProductItemCount(query) {
  const value = String(query ?? "").trim();
  if (!value) return 0;

  const explicitSkuCount = inferExplicitRequestedSkuCount(value);
  const { mode, segments } = requestedItemSegments(value);
  const entries = segments.map((segment) => ({
    ownQuantity: hasOwnQuantity(segment),
    strictKey: productIdentityKey(segment, false),
    flexibleKey: productIdentityKey(segment, true),
  }));

  let acceptedKeys = [];
  if (mode === "numbered" || mode === "quantity_lines" || mode === "shared_each") {
    acceptedKeys = entries.map((entry) => entry.flexibleKey).filter(Boolean);
  } else {
    const quantityKeys = entries
      .filter((entry) => entry.ownQuantity)
      .map((entry) => entry.flexibleKey)
      .filter(Boolean);
    if (new Set(quantityKeys).size >= 2) {
      acceptedKeys = quantityKeys;
    } else if (!entries.some((entry) => entry.ownQuantity)) {
      // A bare comma/conjunction list is accepted only for strong identities.
      // Attribute/status clauses therefore cannot inflate the lower bound.
      acceptedKeys = entries.map((entry) => entry.strictKey).filter(Boolean);
    } else {
      acceptedKeys = quantityKeys;
    }
  }

  const acceptedCount = new Set(acceptedKeys).size;
  const wholeRequestKey = productIdentityKey(value, hasOwnQuantity(value));
  return Math.max(explicitSkuCount, acceptedCount, wholeRequestKey ? 1 : 0);
}

export function isSuccessfulExactPriceResult(result) {
  if (!result || typeof result !== "object") return false;
  const sku = String(result.sku ?? "").trim().toUpperCase();
  const quantity = Number(result.quantity);
  const unitPrice = Number(result.unit_price);
  const lineTotal = Number(result.line_total);
  const expectedLineTotal = Math.round(unitPrice * quantity * 100) / 100;
  return result.ok === true &&
    result.exact_match === true &&
    result.currency === "THB" &&
    Boolean(sku) &&
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    Number.isFinite(unitPrice) &&
    unitPrice > 0 &&
    Number.isFinite(lineTotal) &&
    lineTotal > 0 &&
    Math.abs(lineTotal - expectedLineTotal) < 0.005;
}

export function isTrustedQuoteResult(result) {
  if (!result || typeof result !== "object" || result.ok !== true || result.saved !== true) return false;
  const createdCode = typeof result.quote_code === "string" ? result.quote_code.trim() : "";
  const reusedCode = typeof result.existing_quote_code === "string" ? result.existing_quote_code.trim() : "";
  return (result.quote_created === true && result.quote_reused === false && Boolean(createdCode)) ||
    (result.quote_created === false && result.quote_reused === true && Boolean(reusedCode));
}

function cleanLabel(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanQuoteCode(value) {
  return String(value ?? "").replace(/[^A-Z0-9._/-]/gi, "").slice(0, 80);
}

function formatMoney(value) {
  const [whole, fraction] = Number(value).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function normalizeExactPriceResults(rawResults) {
  const byRequest = new Map();
  for (const result of Array.isArray(rawResults) ? rawResults : []) {
    if (!isSuccessfulExactPriceResult(result)) continue;
    const normalized = {
      sku: String(result.sku).trim().toUpperCase(),
      product_name: cleanLabel(result.product_name, 160),
      unit: cleanLabel(result.unit, 40),
      quantity: Number(result.quantity),
      unit_price: Number(result.unit_price),
      line_total: Number(result.line_total),
    };
    byRequest.set(`${normalized.sku}\u0000${normalized.quantity}`, normalized);
  }
  return [...byRequest.values()];
}

function hasRequestedQuantity(query) {
  return QUANTITY_CUE_RE.test(String(query ?? ""));
}

function exactPriceReply(results, lang) {
  const lines = results.map((result) => {
    const product = result.product_name
      ? `${result.product_name} (${result.sku})`
      : result.sku;
    const unit = result.unit || (lang === "en" ? "unit" : "หน่วย");
    return lang === "en"
      ? `${product}: THB ${formatMoney(result.unit_price)} per ${unit} for ${result.quantity} ${unit} (THB ${formatMoney(result.line_total)} total)`
      : `${product}: ${formatMoney(result.unit_price)} บาท/${unit} สำหรับ ${result.quantity} ${unit} (รวม ${formatMoney(result.line_total)} บาท)`;
  });
  return lang === "en"
    ? `Current verified price:\n${lines.join("\n")}`
    : `ราคาปัจจุบันที่ตรวจสอบจากระบบแล้ว:\n${lines.join("\n")}`;
}

function quoteReply(result, lang) {
  const created = result.quote_created === true;
  const code = cleanQuoteCode(created ? result.quote_code : result.existing_quote_code);
  const total = Number(result.estimated_total_incl_vat);
  const totalText = Number.isFinite(total) && total > 0
    ? (lang === "en" ? ` The quotation total is THB ${formatMoney(total)}.` : ` ยอดรวมตามใบเสนอราคา ${formatMoney(total)} บาทค่ะ`)
    : "";
  if (lang === "en") {
    return created
      ? `Draft quotation ${code} has been created.${totalText} You can use this number as the reference.`
      : `I found the existing draft quotation ${code} for the same items and quantities, so you can continue using it.`;
  }
  return created
    ? `สร้างใบเสนอราคาฉบับร่างเลขที่ ${code} เรียบร้อยแล้วค่ะ${totalText} สามารถใช้เลขที่นี้อ้างอิงได้ทันทีค่ะ`
    : `พบใบเสนอราคาฉบับร่างเลขที่ ${code} สำหรับรายการและจำนวนเดิมแล้วค่ะ จึงใช้ใบเดิมได้เลยค่ะ`;
}

/**
 * Last-mile deterministic protection for model text. Exact-price results are
 * keyed by SKU + quantity by the caller and supplied only from this request.
 * When price output is appropriate, code synthesizes the reply rather than
 * trusting model-provided money amounts.
 *
 * @param {{
 *   query?: unknown,
 *   answer?: unknown,
 *   lang?: string,
 *   exactPriceResults?: unknown[],
 *   exactPriceAttemptCount?: number,
 *   expectedExactProductCount?: number,
 *   requestedProductItemCount?: number,
 *   trustedQuoteResult?: unknown,
 * }} [options]
 */
export function guardNumericSellingPriceAnswer(options = {}) {
  const {
    query = "",
    answer = "",
    lang = "th",
    exactPriceResults = [],
    exactPriceAttemptCount = 0,
    expectedExactProductCount = 0,
    requestedProductItemCount = 0,
    trustedQuoteResult = null,
  } = options;
  const original = String(answer ?? "");
  const quoteTrusted = isTrustedQuoteResult(trustedQuoteResult);
  // request_quote is a write tool with its own server-side price resolver. A
  // successful create/reuse must always win, even when the customer's wording
  // does not contain "price" or "quotation" and the model omits/mangles the
  // code in prose.
  if (quoteTrusted) {
    return { answer: quoteReply(trustedQuoteResult, lang), guarded: true, reason: "trusted_quote_reply" };
  }
  const priceIntent = hasSellingPriceIntent(query);

  const prices = normalizeExactPriceResults(exactPriceResults);
  const attemptCount = Number.isSafeInteger(exactPriceAttemptCount) && exactPriceAttemptCount > 0
    ? exactPriceAttemptCount
    : 0;
  const callerExpectedCount = Number.isSafeInteger(expectedExactProductCount) && expectedExactProductCount > 0
    ? expectedExactProductCount
    : 0;
  const callerRequestedCount = Number.isSafeInteger(requestedProductItemCount) && requestedProductItemCount > 0
    ? requestedProductItemCount
    : 0;
  const requiredResultCount = Math.max(
    callerExpectedCount,
    callerRequestedCount,
    inferRequestedProductItemCount(query),
  );
  const distinctSkuCount = new Set(prices.map((result) => result.sku)).size;
  const completeExactPriceSet = prices.length > 0 &&
    attemptCount === prices.length &&
    (requiredResultCount === 0 || distinctSkuCount >= requiredResultCount);

  if (priceIntent && completeExactPriceSet) {
    return { answer: exactPriceReply(prices, lang), guarded: true, reason: "verified_exact_price_reply" };
  }

  // Only a successful exact product lookup means the product is resolved.
  // The raw-request item count is solely a completeness floor and must not
  // turn a model/name mention into an exact-SKU claim.
  const productContext = callerExpectedCount > 0;
  if (!hasNumericSellingPrice(original, query, productContext)) {
    return { answer: original, guarded: false, reason: null };
  }
  if (completeExactPriceSet) {
    return { answer: exactPriceReply(prices, lang), guarded: true, reason: "verified_exact_price_reply" };
  }

  const needsVerification = attemptCount > 0 ||
    (requiredResultCount > 0 && hasRequestedQuantity(query));
  if (lang === "en") {
    if (needsVerification) {
      return {
        answer: "I can't verify the current selling price from the system right now. Please try again, or contact our team with the exact SKU and quantity.",
        guarded: true,
        reason: "exact_price_not_verified",
      };
    }
    if (callerExpectedCount > 0) {
      return {
        answer: "I found the exact product. How many units do you need so I can check the current price accurately?",
        guarded: true,
        reason: "quantity_required",
      };
    }
    return {
      answer: "To check the current price accurately, please provide the exact SKU or product size/grit and the quantity you need.",
      guarded: true,
      reason: "exact_product_and_quantity_required",
    };
  }

  if (needsVerification) {
    return {
      answer: "ขณะนี้ยังยืนยันราคาขายปัจจุบันจากระบบไม่ได้ค่ะ รบกวนลองใหม่อีกครั้ง หรือติดต่อทีมงานพร้อมแจ้ง SKU และจำนวนที่ต้องการนะคะ",
      guarded: true,
      reason: "exact_price_not_verified",
    };
  }
  if (callerExpectedCount > 0) {
    return {
      answer: "พบสินค้าที่ตรงแล้วค่ะ รบกวนแจ้งจำนวนที่ต้องการ เพื่อเช็กราคาปัจจุบันให้ถูกต้องนะคะ",
      guarded: true,
      reason: "quantity_required",
    };
  }
  return {
    answer: "เพื่อเช็กราคาปัจจุบันให้ถูกต้อง รบกวนระบุ SKU หรือขนาด/เบอร์ของสินค้า และจำนวนที่ต้องการนะคะ",
    guarded: true,
    reason: "exact_product_and_quantity_required",
  };
}
