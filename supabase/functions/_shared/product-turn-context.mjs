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

export const PRODUCT_OPTIONS_MENU_RE = /^(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:ตัวเลือกสินค้า|Catalog options)(?:[ \t]+(?:หน้า|page)[ \t]*\d+\/\d+)?(?:\*\*|__)?[ \t]*\r?$/imu;
const NO_MATCH_OPTION = { th: "ไม่มีสินค้าที่ต้องการในตัวเลือก", en: "None of these products match" };
const NUMBERED_CHOICE_RE = /^[ \t]*(\d+)\.[ \t]+(.+)$/u;
const isMenuControl = (label) => /^(?:แสดงเพิ่มเติม|Show more)$/iu.test(label) || Object.values(NO_MATCH_OPTION).includes(label);

export function numberedChoices(text) {
  return String(text ?? "").split(/\r?\n/u).flatMap((line) => {
    const match = NUMBERED_CHOICE_RE.exec(line);
    return match ? [{ number: Number(match[1]), label: match[2].trim() }] : [];
  });
}

export function isProductOptionsReply(answer) {
  if (PRODUCT_OPTIONS_MENU_RE.test(answer)) return true;
  const intro = answer.split(/^[ \t]*1\.[ \t]+/mu, 1)[0];
  if (!/เลือก[^\n]{0,40}(?:สินค้า|รุ่น|รายการ|ขนาด|เบอร์)|\b(?:choose|select)\b[^\n]{0,40}\b(?:product|item|model|size|grit)/iu.test(intro)) return false;
  const choices = numberedChoices(answer).filter(({ label }) => !isMenuControl(label));
  return choices.length > 0 && choices.every(({ label }) => PRODUCT_HINT_RE.test(label)
    || EXPLICIT_VARIANT_RE.test(label) || extractModelCodes(label).length > 0 || /^หลัง(?:อ่อน|แข็ง)$/iu.test(label));
}

export function formatProductOptions(answer, lang = "th", offset = 0) {
  const choices = [...new Set(numberedChoices(answer).map(({ label }) => label)
    .filter((label) => !isMenuControl(label)))];
  if (!choices.length) return answer;
  const intro = answer.split(/\r?\n/u).filter((line) => !NUMBERED_CHOICE_RE.test(line)
    && !PRODUCT_OPTIONS_MENU_RE.test(line) && !/^(?:หน้า|page)\s*\d+\/\d+\s*$/iu.test(line)).join("\n").trim();
  const start = offset < choices.length ? offset : 0;
  const options = choices.slice(start, start + 5).map((label, index) => `${index + 1}. ${label}`);
  return [intro, lang === "th" ? "ตัวเลือกสินค้า" : "Catalog options", ...options,
    `6. ${NO_MATCH_OPTION[lang === "th" ? "th" : "en"]}`].filter(Boolean).join("\n");
}

/** Only the reserved action on the immediately preceding bot menu is a handoff. */
export function declinedProductOptions(query, history) {
  const offer = history.at(-1);
  if (offer?.role !== "assistant" || /^\[เจ้าหน้าที่\]/u.test(offer.content)
    || !PRODUCT_OPTIONS_MENU_RE.test(offer.content)) return false;
  const choices = numberedChoices(offer.content);
  const action = choices.at(-1);
  if (choices[0]?.number !== 1 || action?.number !== 6 || !Object.values(NO_MATCH_OPTION).includes(action.label)) return false;
  const text = String(query ?? "").trim();
  return /^(?:ข้อ\s*)?6[.)]?(?:\s*(?:ครับ|ค่ะ|คะ))?$/u.test(text)
    || text.replace(/^6\.\s*/u, "").toLowerCase() === action.label.toLowerCase();
}

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
export function pendingProductQuestion(result, lang = "th", offset = 0) {
  const row = result && typeof result === "object" ? result : {};
  const provided = lang === "th" ? row.clarification_question_th : row.clarification_question_en;
  if (typeof provided === "string" && provided.trim()) return formatProductOptions(provided.trim(), lang, offset);

  const candidates = Array.isArray(row.clarification_candidates)
    ? row.clarification_candidates.map((candidate) => candidateLabel(candidate, lang)).filter(Boolean).slice(0, 5)
    : [];
  if (candidates.length > 0) {
    const choices = candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n");
    const answer = lang === "th"
      ? `พบสินค้าที่ชื่อใกล้เคียงกันค่ะ รบกวนเลือกสินค้าที่ต้องการนะคะ\n${choices}`
      : `I found similar product names. Please choose the product you mean:\n${choices}`;
    return formatProductOptions(answer, lang, offset);
  }

  return lang === "th"
    ? "สินค้านี้มีหลายตัวเลือกค่ะ รบกวนระบุขนาดและเบอร์ความละเอียดที่ต้องการนะคะ"
    : "This product has several variants. Please tell me the size and grit you need.";
}
