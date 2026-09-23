import { extractModelCodes } from "./product-selection.mjs";
import { productModelSearchRoot } from "./product-match-score.mjs";
import { pendingProductQuestion } from "./product-turn-context.mjs";

const PRODUCT_WORD_RE = /กระดาษทราย|ผ้าทราย|จานทราย|ล้อทราย|สายพาน|ใบขัด|ใบตัด|ใบเจียร|แผ่นขัด|\b(?:sku|abrasive|sanding|product)\b/iu;
const SHORT_FOLLOW_UP_RE = /^(?:มี(?:ตัว)?ไหน|มี(?:สินค้า)?ไหม|มีมั้ย|มีหรือเปล่า|ยังมี|มีไหมครับ|มีไหมคะ|อันไหน|รุ่นไหน)(?:ครับ|ค่ะ|คะ|นะ)?[?.!\s]*$/iu;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function emptyAnswerProductQuery(query, history = []) {
  const current = clean(query);
  if (extractModelCodes(current).length || /\b\d{7,}\b/u.test(current) || PRODUCT_WORD_RE.test(current)) return current;
  const prior = history.at(-1);
  if (!SHORT_FOLLOW_UP_RE.test(current) || prior?.role !== "user") return null;
  const preceding = clean(prior.content);
  return extractModelCodes(preceding).length || PRODUCT_WORD_RE.test(preceding) ? preceding : null;
}

/** Read-only recovery for an empty model turn. Never infers SKU or price. */
export async function recoverEmptyProductAnswer(query, history, lang, lookup) {
  const productQuery = emptyAnswerProductQuery(query, history);
  if (!productQuery) return { answer: null, lookupQuery: null, result: null };
  const result = await lookup(productQuery);
  if (result?.selection_required) {
    return { answer: pendingProductQuestion(result, lang), lookupQuery: productQuery, result };
  }
  if (Array.isArray(result?.products) && result.products.length === 1) {
    const p = result.products[0];
    const name = clean(lang === "th" ? p.name_th || p.name_en : p.name_en || p.name_th);
    const sku = clean(p.sku);
    const answer = lang === "th"
      ? `พบสินค้า ${name} รหัส ${sku} ค่ะ ต้องการกี่ชิ้นคะ`
      : `I found ${name} (SKU ${sku}). How many pieces would you like?`;
    return { answer, lookupQuery: productQuery, result };
  }
  if (Array.isArray(result?.products) && result.products.length > 1) {
    const choices = result.products.slice(0, 3).map((p, i) => `${i + 1}. ${clean(lang === "th" ? p.name_th || p.name_en : p.name_en || p.name_th)}`).join("\n");
    const answer = lang === "th" ? `พบหลายรายการค่ะ กรุณาเลือกสินค้าที่ต้องการ\n${choices}` : `I found several items. Please choose one:\n${choices}`;
    return { answer, lookupQuery: productQuery, result };
  }
  const root = productModelSearchRoot(productQuery);
  if (root) {
    const familyResult = await lookup(root);
    if (familyResult?.selection_required) {
      const model = extractModelCodes(productQuery)[0];
      const prefix = lang === "th"
        ? `ยังยืนยันรุ่น ${model} กับชื่อรุ่นในระบบไม่ได้ค่ะ `
        : `I cannot confirm that ${model} is the same catalog model. `;
      return { answer: prefix + pendingProductQuestion(familyResult, lang), lookupQuery: root, result: familyResult };
    }
  }
  return { answer: lang === "th"
    ? "รบกวนระบุรุ่น ขนาด และเบอร์ความละเอียดที่ต้องการอีกครั้งนะคะ เอยจะตรวจสินค้าให้ค่ะ"
    : "Please confirm the model, size, and grit so I can check the product.",
    lookupQuery: productQuery, result };
}
