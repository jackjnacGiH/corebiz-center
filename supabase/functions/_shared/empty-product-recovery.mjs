import { extractModelCodes, productMatchFacets } from "./product-selection.mjs";
import { productModelSearchRoot } from "./product-match-score.mjs";
import { mergeFacetOnlyProductQuery, pendingProductQuestion } from "./product-turn-context.mjs";
import { withVerifiedZeroStockLabel } from "./guided-product-selection.mjs";

const PRODUCT_WORD_RE = /กระดาษทราย|ผ้าทราย|จานทราย|ล้อทราย|สายพาน|ใบขัด|ใบตัด|ใบเจียร|แผ่นขัด|\b(?:sku|abrasive|sanding|product)\b/iu;
const SHORT_FOLLOW_UP_RE = /^(?:มี(?:ตัว)?ไหน|มี(?:สินค้า)?ไหม|มีมั้ย|มีหรือเปล่า|ยังมี|มีไหมครับ|มีไหมคะ|อันไหน|รุ่นไหน)(?:ครับ|ค่ะ|คะ|นะ)?[?.!\s]*$/iu;
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const FACET_RE = /^(?:#\s*\d+|(?:เบอร์|grit|ขนาด|ไซซ์|size)\s*#?\s*\d+|\d+(?:\.\d+)?\s*(?:"|นิ้ว|inch(?:es)?|mm|มม\.?))(?:\s+.*)?$/iu;
const GRIT_LIST_RE = /มีเบอร์(?:อะไร|ไหน)บ้าง|เบอร์(?:อะไร|ไหน)บ้าง|(?:which|what|available)\s+grits?/iu;
const BRAND_WORDS = ["DEERFOS", "MIRKA", "PACO", "SIA", "3M", "NORTON", "VSM", "KLINGSPOR", "U-TOOLS", "JNAC"];

/** Build a catalog query from product facts, excluding conversational filler. */
export function productFactQuery(value) {
  const text = clean(value);
  const models = extractModelCodes(text);
  if (models.length !== 1) return text;
  const facets = productMatchFacets(text);
  const type = /กระดาษทราย\s*กลม\s*สักหลาด|velcro\s*(?:sanding\s*)?disc/iu.exec(text)?.[0]
    || /กระดาษทราย\s*กลม\s*หลังกาว|adhesive\s*(?:sanding\s*)?disc/iu.exec(text)?.[0]
    || /กระดาษทราย\s*กลม|กระดาษทราย|ผ้าทราย\s*สายพาน|จานทราย|ล้อทราย/iu.exec(text)?.[0]
    || "";
  const brand = BRAND_WORDS.find((word) => new RegExp(`(?:^|[^A-Z0-9])${word}(?=$|[^A-Z0-9])`, "i").test(text)) ?? "";
  const backing = type && /สักหลาด|velcro|หลังกาว|adhesive/iu.test(type) ? [] : facets.backing;
  return [type, brand, models[0], ...facets.size, ...facets.grit, ...facets.holes, ...backing].filter(Boolean).join(" ");
}

function selectionAnswer(result, productQuery, lang) {
  const first = result?.products?.[0];
  const backing = first && productMatchFacets(first.name_th || first.name_en).backing;
  const onlyVelcro = backing?.includes("สักหลาด") && !result.missing_fields?.includes("backing");
  const grits = result?.available_values?.grit;
  const asksGritList = GRIT_LIST_RE.test(productQuery) && Array.isArray(grits)
    && grits.length > 0 && result.match_scan_complete === true;
  if (asksGritList) {
    const model = extractModelCodes(productQuery)[0];
    const size = productMatchFacets(productQuery).size[0] ?? "";
    const label = `${model}${size ? ` ${size}` : ""}`;
    return lang === "th"
      ? `พบ ${label}${onlyVelcro ? " แบบหลังสักหลาด" : ""} ในระบบค่ะ เบอร์ที่มี: ${grits.join(", ")}\nต้องการเบอร์ไหนคะ${onlyVelcro ? " หากต้องการหลังกาว แจ้งได้ค่ะ เอยจะค้นรุ่นที่ตรงให้" : ""}`
      : `I found ${label}${onlyVelcro ? " with Velcro backing" : ""}. Available grits: ${grits.join(", ")}. Which grit would you like?`;
  }
  const question = pendingProductQuestion(result, lang);
  if (onlyVelcro && !productMatchFacets(productQuery).backing.length) {
    return lang === "th"
      ? `รุ่นที่พบในระบบเป็นแบบหลังสักหลาดค่ะ หากต้องการหลังกาว แจ้งได้ค่ะ เอยจะค้นรุ่นอื่นให้\n${question}`
      : `The catalog model has Velcro backing. If you need adhesive backing, tell me and I will check another model.\n${question}`;
  }
  return question;
}

export function emptyAnswerProductQuery(query, history = []) {
  const current = clean(query);
  const merged = mergeFacetOnlyProductQuery(current, history);
  if (merged !== current && extractModelCodes(merged).length === 1) return merged;
  if (extractModelCodes(current).length || /\b\d{7,}\b/u.test(current) || PRODUCT_WORD_RE.test(current)) return current;
  if (!SHORT_FOLLOW_UP_RE.test(current) && !FACET_RE.test(current)) return null;
  const recent = history.slice(-5).reverse();
  for (const item of recent) {
    if (item.role !== "user") break;
    const text = clean(item.content);
    if (extractModelCodes(text).length || PRODUCT_WORD_RE.test(text)) {
      return FACET_RE.test(current) ? `${text} ${current}` : text;
    }
    if (!SHORT_FOLLOW_UP_RE.test(text) && !FACET_RE.test(text)) break;
  }
  return null;
}

/** Read-only recovery for an empty model turn. Never infers SKU or price. */
export async function recoverEmptyProductAnswer(query, history, lang, lookup) {
  const productQuery = emptyAnswerProductQuery(query, history);
  if (!productQuery) return { answer: null, lookupQuery: null, result: null };
  const structuredQuery = productFactQuery(productQuery);
  const result = await lookup(structuredQuery);
  if (result?.selection_required) {
    return { answer: selectionAnswer(result, query, lang), lookupQuery: structuredQuery, result };
  }
  if (Array.isArray(result?.products) && result.products.length === 1) {
    const p = result.products[0];
    const name = clean(lang === "th" ? p.name_th || p.name_en : p.name_en || p.name_th);
    const sku = clean(p.sku);
    const answer = lang === "th"
      ? `พบสินค้า ${name} รหัส ${sku} ค่ะ ต้องการกี่ชิ้นคะ`
      : `I found ${name} (SKU ${sku}). How many pieces would you like?`;
    return { answer: withVerifiedZeroStockLabel(answer, p, lang), lookupQuery: structuredQuery, result };
  }
  if (Array.isArray(result?.products) && result.products.length > 1) {
    const choices = result.products.slice(0, 3).map((p, i) => `${i + 1}. ${clean(lang === "th" ? p.name_th || p.name_en : p.name_en || p.name_th)}`).join("\n");
    const answer = lang === "th" ? `พบหลายรายการค่ะ กรุณาเลือกสินค้าที่ต้องการ\n${choices}` : `I found several items. Please choose one:\n${choices}`;
    return { answer, lookupQuery: structuredQuery, result };
  }
  const root = productModelSearchRoot(productQuery);
  if (root) {
    const rootQuery = structuredQuery.replace(/\b[A-Z]{2,6}\d+[A-Z0-9-]*\b/i, root);
    const familyResult = await lookup(rootQuery);
    if (familyResult?.selection_required) {
      const model = extractModelCodes(productQuery)[0];
      const prefix = model !== root && lang === "th"
        ? `ยังยืนยันรุ่น ${model} กับชื่อรุ่นในระบบไม่ได้ค่ะ `
        : model !== root ? `I cannot confirm that ${model} is the same catalog model. ` : "";
      return { answer: prefix + selectionAnswer(familyResult, query, lang), lookupQuery: rootQuery, result: familyResult };
    }
  }
  return { answer: lang === "th"
    ? "รบกวนระบุรุ่น ขนาด และเบอร์ความละเอียดที่ต้องการอีกครั้งนะคะ เอยจะตรวจสินค้าให้ค่ะ"
    : "Please confirm the model, size, and grit so I can check the product.",
    lookupQuery: structuredQuery, result };
}
