import {
  extractModelCodes,
  normalizeProductSearchQuery,
  productIdentitySearchText,
} from "./product-selection.mjs";

const DIMENSION_UNIT_SOURCE = '(?:"|นิ้ว|inch(?:es)?|in\\b|มม\\.?|mm\\b)\\.?';
const DIMENSION_UNIT_SEPARATOR_SOURCE = "\\s*(?:[-‐‑‒–—]\\s*)?";
const EXPLICIT_VARIANT_RE = new RegExp(
  `(?:\\b\\d+(?:\\.\\d+)?(?:\\s*[x×*]\\s*\\d+(?:\\.\\d+)?){0,3}${DIMENSION_UNIT_SEPARATOR_SOURCE}${DIMENSION_UNIT_SOURCE}|#\\s*\\d{1,5}[A-Z]?|\\bP\\s*\\d{1,5}[A-Z]?\\b|(?:เบอร์|grit)\\s*[:=]?\\s*#?\\s*P?\\s*\\d{1,5}[A-Z]?|\\b\\d{1,5}[A-Z]?\\s*grit\\b|ไม่มีรู|ไม่เจาะรู|no\\s*holes?|\\b\\d{1,3}\\s*รู\\b|\\bholes?\\s*[:=]?\\s*\\d{1,3}\\b|สักหลาด|velcro|hook\\s*(?:and|&)\\s*loop|หลังกาว|adhesive|\\bpsa\\b)`,
  "iu",
);
const VARIANT_QUESTION_RE = /(?:สินค้านี้|product).*(?:ขนาด|size|เบอร์ความละเอียด|grit|กี่รู|holes?|สักหลาด|หลังกาว|backing)|(?:ขนาด|size|เบอร์ความละเอียด|grit|กี่รู|holes?|สักหลาด|หลังกาว|backing).*(?:ต้องการ|need|which|what)/iu;
const PRODUCT_HINT_RE = /(?:สินค้า|กระดาษทราย|ผ้าทราย|จานทราย|ล้อทราย|ใบขัด|หินเจียร|แผ่นขัด|แปรง|เทป|กาว|deerfos|mirka|paco|sia|3m|norton|vsm)/iu;

function hasStrongProductIdentity(value) {
  const identity = String(value ?? "").trim();
  return /\b\d{7,}\b/u.test(identity) ||
    extractModelCodes(identity).length > 0 ||
    PRODUCT_HINT_RE.test(identity);
}

function cleanHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content ?? "").trim(),
    }))
    .filter((item) => item.content)
    .slice(-6);
}

/**
 * Carry the immediately preceding product identity into a facet-only reply.
 * The adjacency + clarification checks deliberately fail closed so an older
 * product cannot bleed into a new topic.
 */
export function mergeFacetOnlyProductQuery(query, history) {
  const current = String(query ?? "").trim();
  if (!current || !EXPLICIT_VARIANT_RE.test(current)) return current;

  const normalizedCurrent = normalizeProductSearchQuery(current);
  const currentIdentity = productIdentitySearchText(normalizedCurrent);
  if (hasStrongProductIdentity(currentIdentity)) return current;

  const recent = cleanHistory(history);
  const clarification = recent.at(-1);
  const priorCustomer = recent.at(-2);
  if (
    clarification?.role !== "assistant" ||
    priorCustomer?.role !== "user" ||
    !VARIANT_QUESTION_RE.test(clarification.content)
  ) return current;

  const normalizedPrior = normalizeProductSearchQuery(priorCustomer.content);
  const priorIdentity = productIdentitySearchText(normalizedPrior).trim();
  if (!priorIdentity) return current;

  const modelCodes = extractModelCodes(priorIdentity);
  if (modelCodes.length > 1 || !hasStrongProductIdentity(priorIdentity)) return current;

  return `${priorIdentity} ${normalizedCurrent}`.replace(/\s+/g, " ").trim();
}

function candidateLabel(candidate, lang) {
  if (!candidate || typeof candidate !== "object") return "";
  const name = lang === "th"
    ? candidate.name_th || candidate.name_en
    : candidate.name_en || candidate.name_th;
  const safeName = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  const safeSku = String(candidate.sku ?? "").replace(/[^A-Z0-9._/-]/gi, "").slice(0, 40);
  if (!safeName) return safeSku;
  return safeSku ? `${safeName} (${safeSku})` : safeName;
}

/** Return one deterministic customer question for every pending disposition. */
export function pendingProductQuestion(result, lang = "th") {
  const row = result && typeof result === "object" ? result : {};
  const provided = lang === "th" ? row.clarification_question_th : row.clarification_question_en;
  if (typeof provided === "string" && provided.trim()) return provided.trim();

  const candidates = Array.isArray(row.clarification_candidates)
    ? row.clarification_candidates.map((candidate) => candidateLabel(candidate, lang)).filter(Boolean).slice(0, 5)
    : [];
  if (candidates.length > 0) {
    const choices = candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n");
    return lang === "th"
      ? `พบสินค้าที่ชื่อใกล้เคียงกันค่ะ รบกวนเลือกสินค้าที่ต้องการนะคะ\n${choices}`
      : `I found similar product names. Please choose the product you mean:\n${choices}`;
  }

  return lang === "th"
    ? "สินค้านี้มีหลายตัวเลือกค่ะ รบกวนระบุขนาดและเบอร์ความละเอียดที่ต้องการนะคะ"
    : "This product has several variants. Please tell me the size and grit you need.";
}
