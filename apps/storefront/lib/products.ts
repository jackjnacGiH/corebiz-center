import { supabase } from "./supabase";
import { effectivePrice, formatTHB } from "./format";
import type { OrgInfo } from "./seo";

export interface SProduct {
  id: string;
  sku: string;
  name_th: string;
  name_en: string | null;
  description_th: string | null;
  description_en: string | null;
  brand: string | null;
  unit: string | null;
  price: number;
  discount_value: number | null;
  discount_type: string | null;
  weight_kg: number | null;
  images: string[] | null;
  spec: Record<string, unknown> | null;
  tags: string[] | null;
  feature_tags: string[] | null;
  is_featured: boolean;
  min_order_qty: number | null;
  category_slug: string | null;
  category_name_th: string | null;
  category_name_en: string | null;
  group_id: string | null;
  group_name: string | null;
  in_stock: boolean;
  stock_qty: number;
  updated_at: string | null;
}

export interface SCategory {
  slug: string;
  name_th: string;
  name_en: string | null;
}

export interface SGroup {
  id: string;
  name: string;
  cover_image: string | null;
  description: string | null;
}

const SELECT = "*";

export function normalizeSku(sku: string): string {
  return sku
    .normalize("NFKC")
    .replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g, "");
}

export async function getAllProducts(): Promise<SProduct[]> {
  const { data } = await supabase
    .from("storefront_products")
    .select(SELECT)
    .order("is_featured", { ascending: false })
    .order("name_th", { ascending: true });
  return (data ?? []) as unknown as SProduct[];
}

export async function getAllSkus(): Promise<string[]> {
  const { data } = await supabase.from("storefront_products").select("sku");
  return [
    ...new Set(
      ((data ?? []) as { sku: string }[])
        .map((r) => normalizeSku(r.sku))
        .filter(Boolean),
    ),
  ];
}

export async function getProductBySku(sku: string): Promise<SProduct | null> {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return null;

  const { data } = await supabase
    .from("storefront_products")
    .select(SELECT)
    .eq("sku", normalizedSku)
    .maybeSingle();
  if (data) return data as SProduct;

  // Legacy rows may contain one trailing whitespace character. Resolve those
  // rows while keeping the public URL canonical and leaving source data intact.
  for (const suffix of [" ", "\u00A0", "\t"]) {
    const { data: legacyRow } = await supabase
      .from("storefront_products")
      .select(SELECT)
      .eq("sku", `${normalizedSku}${suffix}`)
      .maybeSingle();
    if (legacyRow) return legacyRow as SProduct;
  }

  // Handle any older values with multiple or zero-width trailing characters.
  const candidates = await getAllProducts();
  return candidates.find((candidate) => normalizeSku(candidate.sku) === normalizedSku) ?? null;
}

export async function getCategories(): Promise<SCategory[]> {
  const { data } = await supabase
    .from("categories")
    .select("slug,name_th,name_en")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data ?? []) as SCategory[];
}

export async function getProductsByCategory(slug: string): Promise<SProduct[]> {
  const { data } = await supabase
    .from("storefront_products")
    .select(SELECT)
    .eq("category_slug", slug)
    .order("name_th", { ascending: true });
  return (data ?? []) as unknown as SProduct[];
}

/** Free-text product search (name TH/EN, SKU, brand, group, category, tags).
 *  Filters in-memory over the catalog (~hundreds of rows) — flexible matching,
 *  no PostgREST filter-injection risk. Multi-word: every word must match. */
export async function searchProducts(q: string): Promise<SProduct[]> {
  const term = (q || "").trim().toLowerCase();
  if (!term) return [];
  const words = term.split(/\s+/).filter(Boolean);
  const all = await getAllProducts();
  return all.filter((p) => {
    const hay = [
      p.name_th,
      p.name_en,
      p.sku,
      p.brand,
      p.group_name,
      p.category_name_th,
      ...(p.tags ?? []),
      ...(p.feature_tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export async function getGroups(): Promise<SGroup[]> {
  const { data } = await supabase
    .from("product_groups")
    .select("id,name,cover_image,description")
    .order("name", { ascending: true });
  return (data ?? []) as SGroup[];
}

export async function getGroupById(id: string): Promise<SGroup | null> {
  const { data } = await supabase
    .from("product_groups")
    .select("id,name,cover_image,description")
    .eq("id", id)
    .maybeSingle();
  return (data as SGroup | null) ?? null;
}

export async function getProductsByGroup(groupId: string): Promise<SProduct[]> {
  const { data } = await supabase
    .from("storefront_products")
    .select(SELECT)
    .eq("group_id", groupId)
    .order("name_th", { ascending: true });
  return (data ?? []) as unknown as SProduct[];
}

// ── Content helpers (AEO: answer-first, lists, tables, FAQ) ──────────────────

export function imagesOf(p: SProduct): string[] {
  return Array.isArray(p.images)
    ? (p.images.filter((x) => typeof x === "string") as string[])
    : [];
}

/** Detect the abrasive product type from the Thai name (factual category). */
function detectType(name: string): string {
  const n = name;
  if (/สก๊อตไบร์ท|ใยสังเคราะห์|non-?woven|แฮร์ไลน์/i.test(n)) return "วัสดุใยขัดสังเคราะห์ (สก๊อตไบร์ท)";
  if (/กระดาษทราย/i.test(n)) return "กระดาษทราย";
  if (/จานทราย|flap/i.test(n)) return "จานทรายซ้อน";
  if (/ล้อขัด|ล้อทราย/i.test(n)) return "ล้อขัด/ล้อทราย";
  if (/ใบตัด|cut/i.test(n)) return "ใบตัด";
  if (/ใบเจียร|หินเจียร|grinding/i.test(n)) return "ใบเจียร";
  return "วัสดุงานขัด/เจียร";
}

const SPECISH = /ขนาด|size|qty|box|cnt|rpm|speed|code|grain|backing|grit|^สี|color|ชนิด|type|รุ่น|จำนวน/i;

/** Clean the stored description into bullet lines (strip leading dashes/bullets;
 *  drop a line that just repeats the product name). This is the customer's real
 *  data — we only reformat it, never invent. */
export function descriptionBullets(p: SProduct): string[] {
  const out: string[] = [];
  for (let line of (p.description_th || "").split(/\r?\n/)) {
    line = line.replace(/^\s*[-•*–·]+\s*/u, "").trim();
    if (!line) continue;
    if (line === (p.name_th || "").trim()) continue;
    out.push(line);
  }
  return out;
}

/** "รายละเอียดสินค้า" bullets — the real description lines, or a factual
 *  fallback from the material tags when there's no description. */
export function detailBullets(p: SProduct): string[] {
  const b = descriptionBullets(p);
  if (b.length) return b;
  const out: string[] = [];
  const mats = (p.feature_tags ?? []).filter(Boolean);
  if (mats.length) out.push(`เหมาะสำหรับงาน ${mats.join(", ")}`);
  if (p.brand) out.push(`แบรนด์: ${p.brand}`);
  if (p.unit) out.push(`หน่วยจำหน่าย: ${p.unit}`);
  if (p.min_order_qty && p.min_order_qty > 1) out.push(`สั่งขั้นต่ำ: ${p.min_order_qty} ${p.unit || "ชิ้น"}`);
  return out;
}

/** Concise, marketing-flavoured "what is it / what problem it solves" —
 *  derived from the product's own usage line + type + materials (factual). */
export function productSummary(p: SProduct, orgName: string): string {
  const bullets = descriptionBullets(p);
  const usage = bullets.find((b) => /เหมาะ|ใช้สำหรับ|สำหรับงาน|ขัด|ลบรอย|สร้างลาย|เก็บผิว/.test(b) && !SPECISH.test(b));
  const brand = p.brand ? ` (${p.brand})` : "";
  const lead = `${p.name_th}${brand} จาก ${orgName}`;
  if (usage) {
    const u = usage.replace(/^เหมาะสำหรับ\s*/u, "").trim();
    const text = `${lead} — ข้อมูลสินค้าระบุการใช้งานสำหรับ ${u} ควรตรวจสอบขนาด เบอร์ ระบบยึด และข้อกำหนดบนฉลากหรือเอกสารผู้ผลิตก่อนใช้งาน`;
    return text.length > 300 ? text.slice(0, 300) + "…" : text;
  }
  const mats = (p.feature_tags ?? []).slice(0, 4).join(", ");
  return `${lead} เป็น${detectType(p.name_th)}${mats ? ` โดยรายการสินค้าระบุแท็กวัสดุ ${mats}` : ""} ควรยืนยันสเปกและความเข้ากันได้กับเครื่องมือก่อนสั่งซื้อ`;
}

/** Answer-first summary (≈40–60 words) — what the AI snippet should lift. */
export function answerSummary(p: SProduct, orgName: string): string {
  const desc = (p.description_th || "").trim();
  if (desc.length >= 40) return desc.length > 360 ? desc.slice(0, 360) + "…" : desc;
  const cat = p.category_name_th || p.group_name || "อุปกรณ์งานขัด/เจียร";
  const brand = p.brand ? `แบรนด์ ${p.brand} ` : "";
  const unit = p.unit || "ชิ้น";
  const stock = p.in_stock ? "มีสินค้าพร้อมส่ง" : "เป็นสินค้าสั่งผลิต";
  const moq = p.min_order_qty && p.min_order_qty > 1 ? ` สั่งขั้นต่ำ ${p.min_order_qty} ${unit}` : "";
  return `${p.name_th} ${brand}เป็น${cat}คุณภาพจาก ${orgName} เหมาะสำหรับงานขัด เจียร ตัด ลอกสนิม และเก็บผิวชิ้นงานในอุตสาหกรรม ราคา ${formatTHB(effectivePrice(p))} ต่อ ${unit} (ยังไม่รวม VAT 7%) ${stock}${moq}.`;
}

/** Auto-built SEO meta keywords for a product — from its own name/brand/
 *  category/group/type/tags + a few generic buying terms. No manual entry;
 *  new products get this automatically. (Google ignores meta keywords, but we
 *  emit it to match the classic 3-field SEO setup.) */
export function seoKeywords(p: SProduct): string {
  const raw = [
    p.name_th,
    p.name_en,
    p.brand,
    p.group_name,
    p.category_name_th,
    detectType(p.name_th),
    ...(p.feature_tags ?? []),
    ...(p.tags ?? []),
    p.sku,
    "JNAC",
    "ราคา",
    "ขายส่ง",
    "พร้อมส่ง",
  ]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= 15) break;
  }
  return out.join(", ");
}

/** Auto-built SEO keywords for a LISTING page (catalog / category / group) —
 *  aggregates the brands, product types, categories and group names of the
 *  products on that page, plus optional extra terms. */
export function keywordsFromProducts(products: SProduct[], extra: string[] = []): string {
  const brands = new Set<string>();
  const types = new Set<string>();
  const groups = new Set<string>();
  const cats = new Set<string>();
  for (const p of products) {
    if (p.brand) brands.add(p.brand);
    types.add(detectType(p.name_th));
    if (p.group_name) groups.add(p.group_name);
    if (p.category_name_th) cats.add(p.category_name_th);
  }
  const raw = [
    ...extra,
    ...cats,
    ...types,
    ...brands,
    ...Array.from(groups).slice(0, 5),
    "JNAC",
    "ราคา",
    "ขายส่ง",
    "พร้อมส่ง",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw.map((s) => String(s).trim()).filter(Boolean)) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= 18) break;
  }
  return out.join(", ");
}

export function featuresOf(p: SProduct): string[] {
  const out: string[] = [];
  if (p.brand) out.push(`แบรนด์: ${p.brand}`);
  if (p.category_name_th) out.push(`หมวดหมู่: ${p.category_name_th}`);
  for (const t of p.feature_tags ?? []) if (t && String(t).trim()) out.push(String(t));
  for (const t of p.tags ?? []) if (t && String(t).trim()) out.push(String(t));
  if (p.spec && typeof p.spec === "object" && !Array.isArray(p.spec)) {
    for (const [k, v] of Object.entries(p.spec)) {
      if (v != null && String(v).trim()) out.push(`${k}: ${v}`);
    }
  }
  if (p.unit) out.push(`หน่วยจำหน่าย: ${p.unit}`);
  if (p.min_order_qty && p.min_order_qty > 1)
    out.push(`สั่งขั้นต่ำ: ${p.min_order_qty} ${p.unit || "ชิ้น"}`);
  return Array.from(new Set(out)).slice(0, 8);
}

export function specRows(p: SProduct): [string, string][] {
  const rows: [string, string][] = [["รหัสสินค้า (SKU)", p.sku]];
  if (p.spec && typeof p.spec === "object" && !Array.isArray(p.spec)) {
    for (const [k, v] of Object.entries(p.spec))
      if (v != null && String(v).trim()) rows.push([k, String(v)]);
  }
  if (p.brand) rows.push(["แบรนด์", p.brand]);
  if (p.category_name_th) rows.push(["หมวดหมู่", p.category_name_th]);
  if (p.unit) rows.push(["หน่วยจำหน่าย", p.unit]);
  if (p.weight_kg) rows.push(["น้ำหนักต่อหน่วย", `${p.weight_kg} กก.`]);
  if (p.min_order_qty && p.min_order_qty > 1)
    rows.push(["จำนวนสั่งขั้นต่ำ", `${p.min_order_qty} ${p.unit || "ชิ้น"}`]);
  // de-dupe by key, keep first
  const seen = new Set<string>();
  return rows.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)));
}

export function faqOf(p: SProduct, org: OrgInfo): { q: string; a: string }[] {
  const unit = p.unit || "ชิ้น";
  const name = p.name_th;
  const faqs: { q: string; a: string }[] = [];
  faqs.push({
    q: `${name} ราคาเท่าไหร่?`,
    a: `ราคา ${formatTHB(effectivePrice(p))} ต่อ ${unit} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%)${
      p.min_order_qty && p.min_order_qty > 1 ? ` สั่งซื้อขั้นต่ำ ${p.min_order_qty} ${unit}` : ""
    } สอบถามราคาขายส่งหรือขอใบเสนอราคาได้กับทีมงาน ${org.business_name}.`,
  });
  faqs.push({
    q: `${name} มีพร้อมส่งหรือต้องสั่งผลิต?`,
    a: p.in_stock
      ? `สถานะที่แสดงในระบบของ ${name} คือพร้อมขาย โปรดส่งคำขอใบเสนอราคาเพื่อให้ทีมงานยืนยันจำนวนและกำหนดส่งอีกครั้ง.`
      : `สถานะที่แสดงในระบบของ ${name} คือสั่งผลิต/สั่งจอง ทีมงานจะตรวจสอบจำนวนและกำหนดส่งแล้วแจ้งกลับ.`,
  });
  // วิธีใช้งาน
  const usage = descriptionBullets(p).find(
    (b) => /เหมาะ|ใช้สำหรับ|สำหรับงาน|ขัด|ลบรอย|สร้างลาย|เก็บผิว/.test(b) && !SPECISH.test(b),
  );
  faqs.push({
    q: `${name} ใช้งานอย่างไร?`,
    a: `ตรวจสอบฉลากหรือเอกสารผู้ผลิตของ ${name} ให้ตรงกับชนิดเครื่องมือ ขนาด ระบบยึด วัสดุชิ้นงาน และความเร็วรอบที่อนุญาต${
      usage ? ` ข้อมูลรายการสินค้าระบุว่า ${usage.replace(/^เหมาะสำหรับ\s*/u, "เหมาะสำหรับ")}` : ""
    } ใช้ guard และ PPE ตามคู่มือเครื่องมือและข้อกำหนดความปลอดภัยของหน้างาน.`,
  });

  // ใช้กับวัสดุอะไร
  const mats = (p.feature_tags ?? []).filter(Boolean);
  const cat = p.category_name_th || p.group_name;
  if (mats.length || cat) {
    faqs.push({
      q: `${name} ใช้กับวัสดุหรืองานอะไรได้บ้าง?`,
      a: `${mats.length ? `รายการสินค้าระบุแท็กวัสดุ ${mats.join(", ")}` : `สินค้าอยู่ในกลุ่ม ${cat}`}. ควรตรวจสอบเอกสารของรุ่นจริงก่อนใช้ เพราะชื่อหมวดหรือแท็กไม่ยืนยันความเหมาะสมกับทุกกระบวนการ.`,
    });
  }

  // ซื้อที่ไหน / ใกล้บ้าน / ส่งทั่วประเทศ
  faqs.push({
    q: `ซื้อ ${name} ได้ที่ไหน? มีร้านใกล้บ้านไหม?`,
    a: `หยิบสินค้าใส่ตะกร้าแล้วส่งคำขอใบเสนอราคาผ่านเว็บไซต์ได้ ทีมงาน ${org.business_name} จะยืนยันราคา จำนวน และเงื่อนไขการจัดส่ง${org.phone ? ` หรือสอบถามได้ที่ โทร ${org.phone}` : ""}.`,
  });

  // ราคาขายส่ง
  faqs.push({
    q: `${name} มีราคาขายส่งไหม?`,
    a: `ระบุจำนวนที่ต้องการในคำขอใบเสนอราคา ทีมงานจะตรวจสอบราคาและเงื่อนไขตามจำนวนแล้วแจ้งกลับ.`,
  });

  return faqs;
}

/** Auto-composed long-form article (≥500 words) for the bottom of each product
 *  page — SEO + AEO. Built from the product's real data + category know-how;
 *  headings are answer-first so AI search overviews can lift them. */
export function productArticle(
  p: SProduct,
  org: OrgInfo,
): { h: string; body: string[] }[] {
  const name = p.name_th;
  const brand = p.brand ? `${p.brand} ` : "";
  const type = detectType(name);
  const unit = p.unit || "ชิ้น";
  const mats = (p.feature_tags ?? []).filter(Boolean);
  const matText = mats.length ? mats.join(", ") : "งานขัด เจียร ตัด และเก็บผิวชิ้นงาน";
  const usage = descriptionBullets(p).find(
    (b) => /เหมาะ|ใช้สำหรับ|สำหรับงาน|ขัด|ลอกสนิม|สร้างลาย|เก็บผิว/.test(b) && !SPECISH.test(b),
  );
  const price = formatTHB(effectivePrice(p));
  const cat = p.category_name_th || p.group_name || "วัสดุงานขัด/เจียร";
  const stockLine = p.in_stock
    ? `สถานะที่แสดงในระบบคือพร้อมขาย โดยทีมงานจะยืนยันจำนวนและกำหนดส่งอีกครั้ง`
    : `สถานะที่แสดงในระบบคือสั่งผลิต/สั่งจอง โดยทีมงานจะตรวจสอบจำนวนและกำหนดส่งแล้วแจ้งกลับ`;

  let howto: string;
  if (/กระดาษทราย|จานทราย/.test(type)) {
    howto = `เบอร์ (#) ใช้บอกระดับความหยาบของเม็ดขัด โดยทั่วไปเลขน้อยหยาบกว่าและเลขมากละเอียดกว่า ก่อนใช้ ${name} ให้ยืนยันเบอร์ ขนาด ระบบยึด วัสดุชิ้นงาน และข้อกำหนดของรุ่นจากฉลากหรือเอกสารผู้ผลิต แล้วทดลองในพื้นที่เล็กก่อนใช้กับงานจริง`;
  } else if (/ใบตัด/.test(type)) {
    howto = `ก่อนใช้ ${name} ให้ตรวจชนิดงาน วัสดุ ขนาดรูยึด เส้นผ่านศูนย์กลาง และ Max RPM บนฉลากให้ตรงกับเครื่องมือ ห้ามใช้เกินค่าที่ผู้ผลิตกำหนด และต้องใช้ guard กับ PPE ตามคู่มือเครื่องมือและข้อกำหนดของหน้างาน`;
  } else if (/ใบเจียร|หินเจียร/.test(type)) {
    howto = `ก่อนใช้ ${name} ให้ตรวจชนิดงาน วัสดุ ขนาด ระบบยึด และ Max RPM บนฉลากให้ตรงกับเครื่องเจียร ปฏิบัติตามมุมใช้งานและแรงกดที่ผู้ผลิตระบุ พร้อมใช้ guard และ PPE ตามข้อกำหนดความปลอดภัย`;
  } else if (/ใยขัด|สก๊อตไบร์ท/.test(type)) {
    howto = `ก่อนใช้ ${name} ให้ยืนยันเกรดความหยาบ รูปแบบสินค้า วัสดุชิ้นงาน ระบบยึด และความเร็วรอบจากฉลากหรือเอกสารผู้ผลิต ควรทดลองกับพื้นที่เล็กและตรวจผิวงานเป็นระยะ`;
  } else {
    howto = `ก่อนใช้ ${name} ให้ตรวจชนิดวัสดุ ขั้นตอนงาน ขนาด ระบบยึด และข้อจำกัดของเครื่องมือจากฉลากหรือเอกสารผู้ผลิต ไม่ควรเลือกจากชื่อสินค้าหรือหมวดหมู่เพียงอย่างเดียว`;
  }

  return [
    {
      h: `${name} คืออะไร และเหมาะกับงานแบบไหน`,
      body: [
        `${name} ${brand}เป็น${type}ในรายการสินค้าของ ${org.business_name}${usage ? ` โดยรายละเอียดสินค้าระบุว่า ${usage}` : ""}${mats.length ? ` และมีแท็กวัสดุ ${matText}` : ""} ข้อมูลดังกล่าวใช้ช่วยคัดตัวเลือกเบื้องต้นและควรตรวจสอบกับฉลากหรือเอกสารของรุ่นจริงก่อนใช้งาน`,
        `ราคาที่แสดงของ ${name} คือ ${price} ต่อ ${unit} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%) ${stockLine} สินค้าอยู่ในกลุ่ม ${cat}`,
      ],
    },
    {
      h: `เลือกและใช้งาน ${name} อย่างไรให้ได้ผลดีที่สุด`,
      body: [howto],
    },
    {
      h: `${name} ใช้กับวัสดุหรืองานอะไรได้บ้าง`,
      body: [
        `${mats.length ? `ข้อมูลรายการสินค้าระบุแท็กวัสดุ ${matText}` : `รายการนี้อยู่ในกลุ่ม ${cat}`} แต่แท็กและชื่อหมวดไม่ใช่การยืนยันว่าใช้ได้กับทุกชิ้นงาน ควรเทียบรุ่น ขนาด เบอร์ backing ระบบยึด และ Max RPM กับเอกสารผู้ผลิต หากข้อมูลไม่ครบสามารถส่งรายละเอียดเครื่องมือและวัสดุชิ้นงานให้ทีมงานช่วยตรวจตัวเลือก`,
      ],
    },
    {
      h: `ข้อควรระวังและความปลอดภัยในการใช้ ${name}`,
      body: [
        `ตรวจสภาพ ${name} และเครื่องมือก่อนใช้ทุกครั้ง ใช้ guard และ PPE ที่เหมาะกับความเสี่ยงของงาน ติดตั้งตามคู่มือ และห้ามใช้เกิน Max RPM หรือข้อจำกัดอื่นที่ระบุบนสินค้าและเครื่องมือ หากฉลากหรือข้อมูลสำคัญไม่ชัดเจนให้หยุดใช้และยืนยันกับผู้ผลิตหรือทีมงานก่อน`,
      ],
    },
    {
      h: `ทำไมต้องเลือก ${brand ? p.brand + " " : ""}จาก ${org.business_name}`,
      body: [
        `${org.business_name} แสดงชื่อสินค้า SKU ราคา หน่วยขาย สถานะ และข้อมูลสเปกที่มีอยู่ในระบบเพื่อช่วยตรวจสอบก่อนขอใบเสนอราคา สำหรับข้อมูลที่ยังไม่ครบ ทีมงานจะช่วยยืนยันรุ่น จำนวน และเงื่อนไขการจัดส่งก่อนสั่งซื้อ`,
      ],
    },
    {
      h: `สั่งซื้อ ${name} และขอใบเสนอราคาอย่างไร`,
      body: [
        `กด "หยิบใส่ตะกร้า" แล้วส่งคำขอใบเสนอราคาผ่านเว็บไซต์ พร้อมระบุจำนวนและรายละเอียดงานที่จำเป็น ทีมงาน ${org.business_name} จะติดต่อกลับเพื่อยืนยันราคา จำนวน และเงื่อนไขการจัดส่ง${org.phone ? ` หรือสอบถามได้ที่ โทร ${org.phone}` : ""}`,
      ],
    },
  ];
}

/** Pick the most common values of a key across products (for collection copy). */
function topValues(values: (string | null | undefined)[], limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const s = (v || "").trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map((e) => e[0]);
}

/**
 * Auto SEO/AEO article for a COLLECTION page (category or product group).
 * Composed from the real products inside the collection — types, brands,
 * materials, price range, stock — so it is factual and unique per page, and
 * regenerates automatically as the catalog changes. ~400+ words.
 */
export function collectionArticle(
  name: string,
  kind: "category" | "group",
  products: SProduct[],
  org: OrgInfo,
): { h: string; body: string[] }[] {
  const count = products.length;
  const kindWord = kind === "category" ? "หมวดหมู่" : "กลุ่มสินค้า";
  const types = topValues(products.map((p) => detectType(p.name_th)), 4);
  const brands = topValues(products.map((p) => p.brand), 5);
  const mats = topValues(products.flatMap((p) => p.feature_tags ?? []), 6);
  const inStock = products.filter((p) => p.in_stock).length;
  const prices = products.map((p) => effectivePrice(p)).filter((n) => n > 0);
  const lo = prices.length ? formatTHB(Math.min(...prices)) : "";
  const hi = prices.length ? formatTHB(Math.max(...prices)) : "";
  const typeText = types.length ? types.join(" · ") : "วัสดุงานขัด เจียร ตัด";
  const brandText = brands.length ? brands.join(", ") : "รายการที่ยังไม่ระบุแบรนด์";
  const matText = mats.length ? mats.join(", ") : "รายการที่ยังไม่ระบุแท็กวัสดุ";

  // type-aware selection guidance for the collection
  let howto: string;
  if (types.some((t) => /กระดาษทราย|จานทราย/.test(t))) {
    howto = `เปรียบเทียบเบอร์ความหยาบ (#) ขนาด รูปแบบ backing ระบบยึด และวัสดุชิ้นงานก่อนเลือก โดยทั่วไปเลขเบอร์น้อยหยาบกว่าและเลขมากละเอียดกว่า แต่ต้องยืนยันช่วงเบอร์และการใช้งานจากข้อมูลของรุ่นจริง`;
  } else if (types.some((t) => /ใบตัด/.test(t))) {
    howto = `ตรวจชนิดวัสดุ ขนาดเส้นผ่านศูนย์กลาง ความหนา รูยึด และ Max RPM ของใบตัดให้ตรงกับเครื่องมือและงานจริง โดยยึดฉลากหรือเอกสารผู้ผลิตเป็นหลัก`;
  } else if (types.some((t) => /ใบเจียร|หินเจียร/.test(t))) {
    howto = `ตรวจชนิดวัสดุ ขนาด รูยึด รูปแบบใบ และ Max RPM ของใบเจียรหรือหินเจียรให้ตรงกับเครื่องมือ พร้อมยืนยันมุมและวิธีใช้จากฉลากหรือเอกสารผู้ผลิต`;
  } else if (types.some((t) => /ใยขัด|สก๊อตไบร์ท/.test(t))) {
    howto = `เปรียบเทียบเกรดความหยาบ รูปแบบสินค้า ขนาด ระบบยึด วัสดุชิ้นงาน และความเร็วรอบจากข้อมูลของรุ่นจริง ไม่ควรเลือกจากสีหรือชื่อกลุ่มเพียงอย่างเดียว`;
  } else {
    howto = `การเลือกสินค้าใน${kindWord} ${name} ควรเทียบชนิดวัสดุ ขั้นตอนงาน ขนาด ระบบยึด และข้อจำกัดของเครื่องมือกับฉลากหรือเอกสารผู้ผลิตของรุ่นจริง`;
  }

  return [
    {
      h: `${name} — รวมสินค้าอะไรบ้าง`,
      body: [
        `${name} เป็น${kindWord}งานขัด เจียร ตัด ของ ${org.business_name} ที่รวบรวมไว้ ${count} รายการ ครอบคลุม ${typeText} จากแบรนด์ ${brandText} เหมาะสำหรับช่างมืออาชีพ โรงงานอุตสาหกรรม และงานซ่อมบำรุง ${
          inStock > 0 ? `ระบบแสดงสถานะพร้อมขาย ${inStock} รายการ ` : ""
        }${lo && hi ? `ราคาที่แสดงอยู่ในช่วง ${lo}–${hi} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%) ` : ""}สถานะ ราคา และกำหนดส่งต้องยืนยันในใบเสนอราคาอีกครั้ง`,
      ],
    },
    {
      h: `วิธีเลือก ${name} ให้เหมาะกับงาน`,
      body: [howto],
    },
    {
      h: `${name} ใช้กับงานและวัสดุอะไรได้บ้าง`,
      body: [
        `แท็กวัสดุที่พบในรายการของ ${name} ได้แก่ ${matText} ข้อมูลนี้ใช้สำหรับคัดกรองเบื้องต้นเท่านั้น เพราะสินค้าแต่ละรุ่นอาจรองรับวัสดุ เครื่องมือ และเงื่อนไขต่างกัน ควรตรวจรายละเอียดของรุ่นจริงหรือส่งข้อมูลชิ้นงานให้ทีมงานช่วยตรวจตัวเลือก`,
      ],
    },
    {
      h: `ทำไมต้องเลือก ${name} กับ ${org.business_name}`,
      body: [
        `${org.business_name} แสดงรายการสินค้า SKU ราคา หน่วยขาย สถานะ และข้อมูลสเปกที่มีอยู่ในระบบ เพื่อให้เปรียบเทียบก่อนส่งคำขอใบเสนอราคา หากข้อมูลรุ่นใดยังไม่ครบ ทีมงานจะช่วยตรวจรายละเอียด จำนวน และเงื่อนไขการจัดส่งก่อนยืนยันคำสั่งซื้อ`,
      ],
    },
    {
      h: `สั่งซื้อและขอใบเสนอราคา ${name}`,
      body: [
        `เลือกสินค้าที่ต้องการใน ${name} กด "หยิบใส่ตะกร้า" แล้วส่งคำขอใบเสนอราคาผ่านเว็บไซต์ได้ทันที ทีมงาน ${org.business_name} จะติดต่อกลับเพื่อยืนยันราคา จำนวน และการจัดส่ง รองรับทั้งลูกค้าปลีกและลูกค้าโครงการ/โรงงานที่ต้องการสั่งซื้อจำนวนมาก${org.phone ? ` สอบถามเพิ่มเติม โทร ${org.phone}` : ""}`,
      ],
    },
  ];
}
