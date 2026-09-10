const MODEL_CODE_RE = /\b([A-Z]{2,6})[\s._/-]*(\d{2,}[A-Z0-9-]*)\b/g;
const NON_MODEL_CODE_PREFIXES = new Set(["GRIT", "SIZE"]);
const THAI_SEARCH_PREFIX_RE = /^(?:(?:ผม|ฉัน|หนู|เรา|ลูกค้า)\s*)?(?:(?:สนใจ(?:ซื้อ)?|ต้องการ|อยาก(?:ได้|หา|ทราบ(?:ราคา)?|รู้(?:ราคา)?)|กำลังหา|เอา(?=\s|\d)|ขอ(?:ซื้อ|ราคา|รายละเอียด|สเป[กค]|spec)?|สอบถาม(?:ราคา|รายละเอียด)?|รบกวน(?:ช่วย)?(?:หา|เช็ก|เช็ค|ตรวจสอบ)?|ช่วย(?:หา|เช็ก|เช็ค|ตรวจสอบ)?|หา|เช็ก|เช็ค|ดู|สินค้า)\s*)+/iu;
const THAI_SEARCH_SUFFIX_RE = /\s*(?:(?:มี)?(?:ไหม|มั้ย|หรือเปล่า)|หน่อย)?\s*(?:ครับ|ค่ะ|คะ|ฮะ|นะครับ|นะคะ|นะ)?\s*$/iu;
const ENGLISH_SEARCH_PREFIX_RE = /^(?:(?:i|we)\s+)?(?:(?:am|are)\s+)?(?:interested\s+in|want|need|looking\s+for|find|show\s+me|check(?:\s+the)?(?:\s+price\s+of)?)\s+/i;
const THAI_AVAILABILITY_PREFIX_RE = /^มี(?:สินค้า)?(?=\s|[A-Z]{2,6}[\s._/-]*\d{2,})\s*/iu;
const DIMENSION_UNIT_SOURCE = '(?:"|นิ้ว|inch(?:es)?|in\\b|มม\\.?|mm\\b)\\.?';
const DIMENSION_UNIT_SEPARATOR_SOURCE = '\\s*(?:[-‐‑‒–—]\\s*)?';
const SCALAR_DIMENSION_SOURCE = `\\b\\d+(?:\\.\\d+)?${DIMENSION_UNIT_SEPARATOR_SOURCE}${DIMENSION_UNIT_SOURCE}`;
const DIMENSION_TUPLE_SOURCE = `\\b\\d+(?:\\.\\d+)?(?:\\s*[x×*]\\s*\\d+(?:\\.\\d+)?){1,3}${DIMENSION_UNIT_SEPARATOR_SOURCE}${DIMENSION_UNIT_SOURCE}`;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function naturalSort(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "th", {
    numeric: true,
    sensitivity: "base",
  }));
}

/**
 * Extract catalog model identifiers such as SA331, CS561 or "FA 331".
 * Requiring at least two letters avoids treating a grit such as P120 as a
 * product model.
 */
export function extractModelCodes(value) {
  const text = String(value ?? "").toUpperCase();
  return unique([...text.matchAll(MODEL_CODE_RE)]
    .filter((match) => !NON_MODEL_CODE_PREFIXES.has(match[1]))
    .map((match) => `${match[1]}${match[2]}`.replace(/[^A-Z0-9]/g, "")));
}

export function hasExactModelCodeMatch(query, candidate) {
  const requested = extractModelCodes(query);
  if (requested.length === 0) return false;
  const available = new Set(extractModelCodes(candidate));
  return requested.every((code) => available.has(code));
}

/** Remove buying/search intent even when Thai is typed without a space. */
export function normalizeProductSearchQuery(value) {
  let text = String(value ?? "").trim();
  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text
      .replace(THAI_AVAILABILITY_PREFIX_RE, "")
      .replace(THAI_SEARCH_PREFIX_RE, "")
      .replace(ENGLISH_SEARCH_PREFIX_RE, "")
      .replace(THAI_SEARCH_SUFFIX_RE, "")
      .trim();
  }
  return text || String(value ?? "").trim();
}

/**
 * Keep model/name/brand terms for the database scan and leave exact variant
 * matching to matchesExplicitProductVariant. This bridges equivalent units
 * such as `5 นิ้ว` in chat and `5\"` in the catalog.
 */
export function productIdentitySearchText(value) {
  return String(value ?? "")
    .replace(new RegExp(DIMENSION_TUPLE_SOURCE, "giu"), " ")
    .replace(new RegExp(SCALAR_DIMENSION_SOURCE, "giu"), " ")
    .replace(/(?:เบอร์|grit)\s*[:=]?\s*#?\s*P\s*\d{1,5}[A-Z]?/gi, " ")
    .replace(/\b\d{1,5}[A-Z]?\s*grit\b/gi, " ")
    .replace(/#\s*\d{1,5}[A-Z]?/gi, " ")
    .replace(/\bP\s*\d{1,5}[A-Z]?\b/gi, " ")
    .replace(/(?:เบอร์|grit)\s*[:=]?\s*#?\s*\d{1,5}[A-Z]?/gi, " ")
    .replace(/(?:ไม่มีรู|ไม่เจาะรู|no\s*holes?|\b\d{1,3}\s*รู\b|\bholes?\s*[:=]?\s*\d{1,3}\b)/giu, " ")
    .replace(/(?:^|\s)(?:ขนาด|ไซซ์|size|เบอร์|grit)\s*[:=]?(?=\s|$)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(product) {
  const canonicalName = product?.name_th || product?.name_en;
  return [
    canonicalName,
    product?.brand,
  ].filter(Boolean).join(" ");
}

function extractSizes(value) {
  const text = String(value ?? "");
  const dimensions = [];
  const tupleRe = new RegExp(`\\b(\\d+(?:\\.\\d+)?(?:\\s*[x×*]\\s*\\d+(?:\\.\\d+)?){1,3})${DIMENSION_UNIT_SEPARATOR_SOURCE}(${DIMENSION_UNIT_SOURCE})`, "giu");
  const textWithoutTuples = text.replace(tupleRe, (full, tuple, rawUnit) => {
    const values = String(tuple).split(/\s*[x×*]\s*/iu).map((part) => Number(part));
    if (values.length >= 2 && values.every((part) => Number.isFinite(part) && part > 0)) {
      const unit = /มม|mm/i.test(rawUnit) ? "มม." : "นิ้ว";
      dimensions.push(`${values.join("x")}${unit}`);
    }
    return " ".repeat(full.length);
  });
  const re = new RegExp(`\\b(\\d+(?:\\.\\d+)?)${DIMENSION_UNIT_SEPARATOR_SOURCE}(${DIMENSION_UNIT_SOURCE})`, "giu");
  for (const match of textWithoutTuples.matchAll(re)) {
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number <= 0) continue;
    const unit = /มม|mm/i.test(match[2]) ? "มม." : "นิ้ว";
    dimensions.push(`${number}${unit}`);
  }
  return unique(dimensions);
}

function extractGrits(value) {
  const text = String(value ?? "");
  const values = [];
  for (const match of text.matchAll(/#\s*(\d{1,5}[A-Z]?)/gi)) values.push(`#${match[1].toUpperCase()}`);
  for (const match of text.matchAll(/\bP\s*(\d{1,5}[A-Z]?)\b/gi)) values.push(`#${match[1].toUpperCase()}`);
  for (const match of text.matchAll(/(?:เบอร์|grit)\s*[:=]?\s*#?\s*(\d{1,5}[A-Z]?)/gi)) values.push(`#${match[1].toUpperCase()}`);
  for (const match of text.matchAll(/\b(\d{1,5}[A-Z]?)\s*grit\b/gi)) values.push(`#${match[1].toUpperCase()}`);
  return unique(values);
}

function extractHoles(value) {
  const text = String(value ?? "");
  const values = [];
  if (/ไม่มีรู|ไม่เจาะรู|no\s*holes?/i.test(text)) values.push("ไม่มีรู");
  for (const match of text.matchAll(/\b(\d{1,3})\s*รู/giu)) values.push(`${Number(match[1])} รู`);
  for (const match of text.matchAll(/\b(?:holes?|孔)\s*[:=]?\s*(\d{1,3})\b/giu)) values.push(`${Number(match[1])} รู`);
  return unique(values);
}

function extractBackings(value) {
  const text = String(value ?? "");
  const values = [];
  if (/สักหลาด|velcro|hook\s*(?:and|&)\s*loop/i.test(text)) values.push("สักหลาด");
  if (/หลังกาว|adhesive|\bpsa\b/i.test(text)) values.push("หลังกาว");
  return unique(values);
}

const FIELD_DEFINITIONS = [
  { key: "size", questionTh: "ใช้ขนาดเท่าไร", questionEn: "what size do you need", extract: extractSizes },
  { key: "grit", questionTh: "ต้องการเบอร์ความละเอียดอะไร", questionEn: "what grit do you need", extract: extractGrits },
  { key: "holes", questionTh: "ต้องการกี่รู", questionEn: "what hole pattern do you need", extract: extractHoles },
  { key: "backing", questionTh: "ต้องการแบบสักหลาดหรือหลังกาว", questionEn: "which backing type do you need", extract: extractBackings },
];

/**
 * Post-filter substring database matches when the customer supplied a precise
 * facet. For example, `%#120%` also matches `#1200`; this guard keeps only the
 * exact requested grit. A catalog row without the supplied facet fails closed.
 */
export function matchesExplicitProductVariant(query, product) {
  const candidate = sourceText(product);
  for (const field of FIELD_DEFINITIONS) {
    const requested = field.extract(query);
    if (requested.length === 0) continue;
    const available = new Set(field.extract(candidate));
    if (available.size === 0 || !requested.every((value) => available.has(value))) return false;
  }
  return true;
}

function joinThai(questions) {
  if (questions.length <= 1) return questions[0] ?? "ต้องการรุ่นย่อยแบบไหน";
  return `${questions.slice(0, -1).join(" ")} และ${questions.at(-1)}`;
}

function joinEnglish(questions) {
  if (questions.length <= 1) return questions[0] ?? "which variant do you need";
  if (questions.length === 2) return `${questions[0]} and ${questions[1]}`;
  return `${questions.slice(0, -1).join(", ")}, and ${questions.at(-1)}`;
}

/**
 * Tell the chatbot which variant facts are still missing. The result is based
 * only on fields that actually vary across the matched catalog rows, so the
 * bot does not ask unnecessary questions.
 */
export function buildProductSelection(query, products) {
  if (!Array.isArray(products) || products.length < 2) return null;

  const missing = [];
  const availableValues = {};
  for (const field of FIELD_DEFINITIONS) {
    const values = naturalSort(unique(products.flatMap((product) => field.extract(sourceText(product)))));
    if (values.length > 1 && field.extract(query).length === 0) {
      missing.push(field);
      availableValues[field.key] = values.slice(0, 24);
    }
  }

  if (missing.length === 0) return null;
  const questionsTh = missing.map((field) => field.questionTh);
  const questionsEn = missing.map((field) => field.questionEn);
  return {
    selection_required: true,
    missing_fields: missing.map((field) => field.key),
    available_values: availableValues,
    clarification_question_th: `สินค้านี้มีหลายตัวเลือกค่ะ ${joinThai(questionsTh)}คะ`,
    clarification_question_en: `This product has several variants. Please tell me ${joinEnglish(questionsEn)}.`,
  };
}

export function productSearchDisposition(result) {
  if (!result || typeof result !== "object") return "none";
  if (result.selection_required === true) return "needs_selection";
  if (Array.isArray(result.clarification_candidates) && result.clarification_candidates.length > 0) {
    return "needs_selection";
  }
  if (Array.isArray(result.products) && result.products.length > 0) return "resolved";
  if (result.sku && !result.error) return "resolved";
  if (Number(result.count ?? 0) === 0) return "unresolved";
  return "none";
}

/** Product lookup must run before tools that can mutate sales workflow state. */
export function prioritizeProductToolCalls(calls) {
  return calls
    .map((call, index) => ({ call, index }))
    .sort((left, right) => {
      const leftPriority = left.call?.name === "find_products" || left.call?.name === "get_product_detail" ? 0 : 1;
      const rightPriority = right.call?.name === "find_products" || right.call?.name === "get_product_detail" ? 0 : 1;
      return leftPriority - rightPriority || left.index - right.index;
    });
}

export function shouldSuppressToolForProductSearch(toolName, disposition) {
  if (disposition !== "needs_selection") return false;
  return toolName === "capture_lead" ||
    toolName === "request_quote" ||
    toolName === "link_quote_customer";
}
