import {
  getSupabaseAdminClient,
  getSupabaseServerClient,
} from "@/lib/supabase/server";
import { readLocalPriceRules, readLocalProducts } from "@/lib/local-data";
import type { PriceRule, ProductRecord } from "@/lib/types";

function terms(query: string) {
  return query
    .toLowerCase()
    .replace(/"/g, "นิ้ว")
    .split(/[^0-9a-z\u0e00-\u0e7f#]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function scoreText(queryTerms: string[], text: string) {
  const target = text.toLowerCase().replace(/"/g, "นิ้ว");
  return queryTerms.reduce((score, term) => {
    if (target.includes(term)) return score + (term.startsWith("#") ? 12 : 4);
    return score;
  }, 0);
}

function productScore(queryTerms: string[], product: ProductRecord) {
  return (
    scoreText(queryTerms, product.product_code) * 3 +
    scoreText(queryTerms, product.name) * 4 +
    scoreText(queryTerms, product.category) * 2 +
    scoreText(queryTerms, product.description)
  );
}

function ruleScore(queryTerms: string[], rule: PriceRule) {
  return (
    scoreText(queryTerms, rule.name) * 5 +
    scoreText(queryTerms, rule.base_name) * 4 +
    scoreText(queryTerms, rule.grits.map((grit) => `#${grit}`).join(" ")) * 5 +
    scoreText(queryTerms, rule.detail)
  );
}

async function dbProducts(query: string): Promise<ProductRecord[] | null> {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseServerClient());
  if (!supabase) return null;

  const safe = query.replace(/[%_]/g, "");
  const { data, error } = await supabase
    .from("products_current")
    .select("*")
    .or(
      `product_code.ilike.%${safe}%,name.ilike.%${safe}%,category.ilike.%${safe}%,description.ilike.%${safe}%`,
    )
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: `jnac_product_${row.product_code}`,
    type: "product" as const,
    product_code: row.product_code ?? "",
    name: row.name ?? "",
    category: row.category ?? "",
    description: row.description ?? "",
    unit: row.unit ?? "",
    price: row.price,
    inventory_price: row.inventory_price,
    price_source: row.price_source ?? "",
    price_rule_id: row.price_rule_id ?? "",
    price_rule_name: row.price_rule_name ?? "",
    price_rule_grits: row.price_rule_grits ?? [],
    stock: row.stock,
    min_stock: row.min_stock,
    availability: row.availability ?? "",
    shelf: row.shelf ?? "",
    row: row.row ?? "",
    flowaccount_qty: row.flowaccount_qty,
    embedding_text: row.embedding_text ?? "",
    answer_text: row.answer_text ?? "",
  })) satisfies ProductRecord[];
}

async function dbPriceRules(query: string): Promise<PriceRule[] | null> {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseServerClient());
  if (!supabase) return null;

  const safe = query.replace(/[%_]/g, "");
  const { data, error } = await supabase
    .from("product_price_rules")
    .select("*")
    .or(`name.ilike.%${safe}%,base_name.ilike.%${safe}%,detail.ilike.%${safe}%`)
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    type: "price_rule" as const,
    source_row: row.source_row ?? "",
    source_product_code: row.source_product_code ?? "",
    name: row.name ?? "",
    base_name: row.base_name ?? "",
    base_key: row.base_key ?? "",
    grits: row.grits ?? [],
    unit: row.unit ?? "",
    price: row.price,
    detail: row.detail ?? "",
    note: row.note ?? "",
    embedding_text: row.embedding_text ?? "",
    answer_text: row.answer_text ?? "",
    hash: row.rule_hash ?? "",
  })) satisfies PriceRule[];
}

export async function searchProducts(query: string, limit = 12) {
  const queryTerms = terms(query);
  const rows = (await dbProducts(query)) ?? (await readLocalProducts());
  return rows
    .map((product) => ({ product, score: productScore(queryTerms, product) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}

export async function searchPriceRules(query: string, limit = 8) {
  const queryTerms = terms(query);
  const rows = (await dbPriceRules(query)) ?? (await readLocalPriceRules());
  return rows
    .map((rule) => ({ rule, score: ruleScore(queryTerms, rule) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.rule);
}

export async function buildRetrievalContext(query: string) {
  const [products, priceRules] = await Promise.all([
    searchProducts(query, 10),
    searchPriceRules(query, 8),
  ]);

  const priceBlock = priceRules
    .map(
      (rule) =>
        `- ${rule.base_name} ${rule.grits.map((grit: string) => `#${grit}`).join(" ")}: ${rule.price.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท/${rule.unit || "หน่วย"} (rule ${rule.id})`,
    )
    .join("\n");
  const productBlock = products
    .map(
      (product) =>
        `- ${product.product_code} | ${product.name} | ราคา ${product.price ?? "ไม่ระบุ"} | คงเหลือ ${product.stock ?? "ไม่ระบุ"} ${product.unit} | ${product.category} | ${product.description}`,
    )
    .join("\n");

  return {
    products,
    priceRules,
    contextText: [
      priceBlock ? `กฎราคาจาก Sheet Product:\n${priceBlock}` : "",
      productBlock ? `ข้อมูลสินค้า/คงเหลือ:\n${productBlock}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
