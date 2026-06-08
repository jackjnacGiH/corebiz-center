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
  return ((data ?? []) as { sku: string }[]).map((r) => r.sku);
}

export async function getProductBySku(sku: string): Promise<SProduct | null> {
  const { data } = await supabase
    .from("storefront_products")
    .select(SELECT)
    .eq("sku", sku)
    .maybeSingle();
  return (data as SProduct | null) ?? null;
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
    const text = `${lead} — วัสดุงานขัดคุณภาพที่เหมาะสำหรับ${u} ช่วยให้งานเก็บผิวเรียบเนียน รวดเร็ว และได้มาตรฐาน`;
    return text.length > 300 ? text.slice(0, 300) + "…" : text;
  }
  const mats = (p.feature_tags ?? []).slice(0, 4).join(", ");
  return `${lead} เป็น${detectType(p.name_th)}คุณภาพสำหรับงานขัด เจียร ตัด และเก็บผิวชิ้นงาน${
    mats ? ` ${mats}` : ""
  } ช่วยให้ผิวงานเรียบเนียนและประหยัดเวลาทำงาน`;
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
      ? `${name} มีสต็อกพร้อมจัดส่ง สามารถสั่งซื้อและขอใบเสนอราคาได้ทันที.`
      : `${name} เป็นสินค้าสั่งผลิต/สั่งจอง ทีมงานจะตรวจสอบระยะเวลาผลิตและแจ้งกลับ ติดต่อเพื่อขอใบเสนอราคาและกำหนดส่ง.`,
  });
  // วิธีใช้งาน
  const usage = descriptionBullets(p).find(
    (b) => /เหมาะ|ใช้สำหรับ|สำหรับงาน|ขัด|ลบรอย|สร้างลาย|เก็บผิว/.test(b) && !SPECISH.test(b),
  );
  faqs.push({
    q: `${name} ใช้งานอย่างไร?`,
    a: `ติดตั้ง ${name} เข้ากับเครื่องมือที่รองรับขนาดนี้ (เช่น เครื่องเจียร/เครื่องขัดมือ) เลือกความเร็วรอบไม่เกินค่าที่กำหนดบนสินค้า แล้วเดินเครื่องขัดไปตามแนวชิ้นงานอย่างสม่ำเสมอ${
      usage ? ` ${usage.replace(/^เหมาะสำหรับ\s*/u, "เหมาะสำหรับ")}` : ""
    } ควรสวมอุปกรณ์เซฟตี้ (แว่นตา/ถุงมือ) ทุกครั้ง.`,
  });

  // ใช้กับวัสดุอะไร
  const mats = (p.feature_tags ?? []).filter(Boolean);
  const cat = p.category_name_th || p.group_name;
  if (mats.length || cat) {
    faqs.push({
      q: `${name} ใช้กับวัสดุหรืองานอะไรได้บ้าง?`,
      a: `เหมาะกับงาน${mats.length ? ` ${mats.join(", ")}` : "ขัด เจียร ตัด เก็บผิว"} ${
        cat ? `(กลุ่ม${cat}) ` : ""
      }ทั้งงานขัดลบรอย ลอกสนิม สร้างลาย และเก็บผิวชิ้นงานในอุตสาหกรรมทั่วไป.`,
    });
  }

  // ซื้อที่ไหน / ใกล้บ้าน / ส่งทั่วประเทศ
  faqs.push({
    q: `ซื้อ ${name} ได้ที่ไหน? มีร้านใกล้บ้านไหม?`,
    a: `${org.business_name} จัดส่งทั่วประเทศ สั่งซื้อออนไลน์ได้จากทุกที่ ไม่ว่าคุณจะอยู่จังหวัดใด เราจัดส่งถึงหน้าบ้านหรือหน้างานได้เลย${
      org.phone ? ` หรือสอบถามทีมงาน/ตัวแทนใกล้คุณได้ที่ โทร ${org.phone}` : ""
    } เพียงหยิบสินค้าใส่ตะกร้าแล้วส่งคำขอใบเสนอราคาผ่านเว็บไซต์.`,
  });

  // ราคาขายส่ง
  faqs.push({
    q: `${name} มีราคาขายส่งไหม?`,
    a: `มีราคาพิเศษสำหรับการสั่งซื้อจำนวนมาก/ขายส่ง — หยิบสินค้าใส่ตะกร้าแล้วส่งคำขอใบเสนอราคา ทีมงานจะเสนอราคาขายส่งที่ดีที่สุดให้ตามจำนวนที่ต้องการ.`,
  });

  return faqs;
}
