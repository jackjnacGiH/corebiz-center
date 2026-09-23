import { extractModelCodes, productMatchFacets } from "./product-selection.mjs";

export const PRODUCT_SUGGESTION_THRESHOLD = 80;
export const PRODUCT_MATCH_WEIGHTS = Object.freeze({ model: 30, type: 25, size: 20, grit: 15, brand: 10 });
const KNOWN_BRANDS = ["DEERFOS", "MIRKA", "PACO", "SIA", "3M", "NORTON", "VSM", "KLINGSPOR", "U-TOOLS", "JNAC"];
const modelParts = (code) => /^([A-Z]+\d+)([A-Z][A-Z0-9]*)?$/.exec(code);

// A shared numeric model root is retrieval evidence only, never an alias.
export function productModelSearchRoot(query) {
  const codes = extractModelCodes(query);
  return codes.length === 1 ? modelParts(codes[0])?.[1] ?? null : null;
}

function mentionsBrand(text, brand) {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i").test(text);
}

/** Fixed evidence points, not an AI probability. Missing facts earn zero. */
export function scoreProductCandidate(query, product, identity = {}) {
  const text = [product.name_th, product.name_en, product.brand].filter(Boolean).join(" ");
  const canonical = product.name_th || product.name_en || "";
  const requested = productMatchFacets(query);
  const available = productMatchFacets(canonical);
  const points = { model: 0, type: 0, size: 0, grit: 0, brand: 0 };
  const conflicts = [];
  const missing = [];
  for (const field of ["size", "grit", "holes", "backing"]) {
    if (!requested[field].length) { missing.push(field); continue; }
    if (!available[field].length) { conflicts.push(`${field}_unverified`); continue; }
    if (!requested[field].every((value) => available[field].includes(value))) conflicts.push(field);
    else if (field in points) points[field] = PRODUCT_MATCH_WEIGHTS[field];
  }
  const { requestedFamily, candidateFamily, requestedProductType, candidateProductType } = identity;
  if (requestedFamily && requestedFamily !== candidateFamily) conflicts.push("family");
  if (requestedProductType && requestedProductType !== candidateProductType) conflicts.push("type");
  if ((requestedProductType && requestedProductType === candidateProductType) ||
      (requestedFamily && requestedFamily === candidateFamily)) points.type = 25;
  else if (/กระดาษทราย|sand\s*paper|abrasive\s*paper/i.test(query) && candidateProductType === "sanding_disc") {
    // Generic paper does not establish disc/backing: partial type evidence.
    points.type = 20;
    missing.push("specific_type");
  } else missing.push("type");

  const requestedModels = extractModelCodes(query);
  const candidateModels = extractModelCodes(text);
  let modelRelation = "unknown";
  if (requestedModels.length > 1) conflicts.push("multiple_models");
  else if (requestedModels.length === 1) {
    if (candidateModels.includes(requestedModels[0])) { points.model = 30; modelRelation = "exact"; }
    else {
      const wanted = modelParts(requestedModels[0]);
      const suffixCandidate = candidateModels.some((code) => {
        const found = modelParts(code);
        return wanted && found && wanted[1] === found[1] && Boolean(wanted[2]) !== Boolean(found[2]);
      });
      if (suffixCandidate) { points.model = 15; modelRelation = "suffix_unconfirmed"; }
      else conflicts.push("model");
    }
  } else missing.push("model");

  const brand = String(product.brand ?? "").trim().toUpperCase();
  const requestedBrands = [...new Set([...KNOWN_BRANDS, brand].filter(Boolean))]
    .filter((value) => mentionsBrand(query, value));
  if (requestedBrands.some((value) => value !== brand)) conflicts.push("brand");
  if (brand && requestedBrands.includes(brand)) points.brand = 10;
  else missing.push("brand");
  const requestedSkus = String(query).match(/\b\d{7,}\b/g) ?? [];
  if (requestedSkus.some((sku) => sku !== String(product.sku))) conflicts.push("sku");
  const score = Object.values(points).reduce((sum, value) => sum + value, 0);
  return { score, points, conflicts, missing, model_relation: modelRelation,
    eligible: conflicts.length === 0 && score >= PRODUCT_SUGGESTION_THRESHOLD };
}

/** Always require a customer selection, even when only one suggestion passes. */
export function buildScoredProductSelection(query, candidates) {
  const seen = new Set();
  const selected = candidates.filter((candidate) => candidate.match?.eligible)
    .sort((a, b) => b.match.score - a.match.score || String(a.product.sku).localeCompare(String(b.product.sku)))
    .filter(({ product }) => { if (seen.has(product.sku)) return false; seen.add(product.sku); return true; })
    .slice(0, 3);
  if (!selected.length) return null;
  const safeLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const list = (lang) => selected.map(({ product }, index) =>
    `${index + 1}. ${safeLine(lang === "th" ? product.name_th || product.name_en : product.name_en || product.name_th)}`
  ).join("\n");
  const differs = selected.some(({ match }) => match.model_relation === "suffix_unconfirmed");
  const requestedModel = extractModelCodes(query).join(", ");
  const differenceTh = differs ? `รุ่นที่แจ้งคือ ${requestedModel} แต่ชื่อรุ่นในระบบต่างกัน จึงขอให้ยืนยันรายการก่อนนะคะ\n` : "";
  const differenceEn = differs ? `You requested ${requestedModel}; the catalog model differs, so please confirm the item first.\n` : "";
  return {
    query, count: 0, products: [], selection_required: true, confirmation_required: true,
    match_policy: "weighted_evidence_v1", score_threshold: PRODUCT_SUGGESTION_THRESHOLD,
    missing_fields: ["product_confirmation"],
    clarification_question_th: `พบสินค้าที่ข้อมูลใกล้เคียงกับที่แจ้งค่ะ\n${differenceTh}กรุณาเลือกสินค้าที่ต้องการค่ะ\n${list("th")}`,
    clarification_question_en: `I found matching candidates.\n${differenceEn}Please select the product you mean:\n${list("en")}`,
    clarification_candidates: selected.map(({ product, match }) => ({
      sku: product.sku, name_th: product.name_th, name_en: product.name_en, brand: product.brand,
      match_score: match.score, match_points: match.points, model_relation: match.model_relation,
      confirmation_required: true, safe_alternative: true,
    })),
  };
}
