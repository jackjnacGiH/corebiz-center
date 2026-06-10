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
    ? `ปัจจุบัน ${name} มีสต็อกพร้อมจัดส่ง สั่งซื้อและขอใบเสนอราคาได้ทันที`
    : `${name} เป็นสินค้าผลิต/สั่งจองตามคำสั่งซื้อ ทีมงานจะแจ้งระยะเวลาผลิตและการจัดส่งให้ทราบ`;

  let howto: string;
  if (/กระดาษทราย|จานทราย/.test(type)) {
    howto = `การเลือกเบอร์ (#) ของ ${name} มีผลโดยตรงต่อผลงาน — ตัวเลขหลังเครื่องหมาย # คือความละเอียดของเม็ดทราย เบอร์ยิ่งน้อย (เช่น #40–#80) เม็ดยิ่งหยาบ ขัดหรือลอกผิวออกได้เร็ว เหมาะกับงานลบครีบ ลอกสีเก่า หรือลอกสนิม ส่วนเบอร์ยิ่งมาก (เช่น #240–#600 ขึ้นไป) เม็ดยิ่งละเอียด เหมาะกับการเก็บผิวให้เรียบเนียนก่อนทำสีหรือขัดเงา เทคนิคที่ถูกต้องคือไล่จากเบอร์หยาบไปเบอร์ละเอียดทีละสเต็ป ไม่ข้ามเบอร์มากเกินไป เพื่อให้รอยขัดสม่ำเสมอ ประหยัดเวลา และยืดอายุการใช้งานของวัสดุขัด`;
  } else if (/ใบตัด/.test(type)) {
    howto = `การใช้ ${name} อย่างปลอดภัยต้องตรวจสอบความเร็วรอบสูงสุด (Max RPM) ที่ระบุบนใบตัดให้สัมพันธ์กับเครื่องมือเสมอ ห้ามใช้เกินค่าที่กำหนดเพราะอาจทำให้ใบแตกและเกิดอันตรายได้ ควรตัดในแนวตรง ไม่บิดหรืองัดใบ และปล่อยให้ความคมของใบทำงานแทนการกดแรง เพื่อให้รอยตัดเรียบ ลดความร้อนสะสม และยืดอายุการใช้งานของใบตัด`;
  } else if (/ใบเจียร|หินเจียร/.test(type)) {
    howto = `เมื่อใช้ ${name} ควรตรวจความเร็วรอบสูงสุดให้ตรงกับเครื่องเจียรก่อนทุกครั้ง และเจียรในมุมประมาณ 15–30 องศากับชิ้นงาน เคลื่อนเครื่องอย่างสม่ำเสมอ ไม่กดแรงจนเกิดความร้อนสะสมที่ทำให้ชิ้นงานไหม้หรือใบสึกเร็ว การควบคุมแรงกดและมุมที่เหมาะสมจะช่วยให้ลบรอยเชื่อมและเก็บผิวได้เรียบเนียนกว่า`;
  } else if (/ใยขัด|สก๊อตไบร์ท/.test(type)) {
    howto = `${name} เป็นวัสดุใยขัดสังเคราะห์ที่เหมาะกับงานสแตนเลสและการสร้างลายเส้น (แฮร์ไลน์) ควรควบคุมแรงกดและความเร็วรอบให้พอดีเพื่อไม่ให้ผิวไหม้หรือเปลี่ยนสี และเลือกความหยาบของใยให้เหมาะกับระดับผิวที่ต้องการ ตั้งแต่การลอกคราบและสนิม ไปจนถึงการปัดเงาขั้นสุดท้าย`;
  } else {
    howto = `การใช้ ${name} ให้ได้ผลดี ควรเลือกความหยาบ/รุ่นให้เหมาะกับเนื้อวัสดุและขั้นตอนงาน ควบคุมความเร็วรอบและแรงกดให้พอเหมาะ และเก็บผิวเป็นขั้นตอนเพื่อให้ได้ผิวงานเรียบเนียนสม่ำเสมอ`;
  }

  return [
    {
      h: `${name} คืออะไร และเหมาะกับงานแบบไหน`,
      body: [
        `${name} ${brand}เป็น${type}คุณภาพสำหรับงานอุตสาหกรรม จัดจำหน่ายโดย ${org.business_name} ${usage ? usage.replace(/^เหมาะสำหรับ\s*/u, "เหมาะสำหรับ") + " " : ""}ออกแบบมาเพื่อให้งาน${matText} ทำได้รวดเร็ว ผิวงานเรียบเนียน และได้มาตรฐานเดียวกันทุกชิ้น เหมาะทั้งกับช่างมืออาชีพ โรงงานอุตสาหกรรม และงานซ่อมบำรุงทั่วไป`,
        `ราคา ${name} อยู่ที่ ${price} ต่อ ${unit} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%) ${stockLine} จัดอยู่ในกลุ่มสินค้า ${cat} ของ ${org.business_name} ซึ่งรวบรวมวัสดุและอุปกรณ์งานขัด ตัด เจียร ไว้อย่างครบวงจร`,
      ],
    },
    {
      h: `เลือกและใช้งาน ${name} อย่างไรให้ได้ผลดีที่สุด`,
      body: [howto],
    },
    {
      h: `${name} ใช้กับวัสดุหรืองานอะไรได้บ้าง`,
      body: [
        `${name} เหมาะกับงาน ${matText} ครอบคลุมตั้งแต่การลบครีบ ลอกสนิม ลอกสีเก่า ขัดรอยเชื่อม สร้างลายผิว ไปจนถึงการเก็บผิวขั้นสุดท้ายก่อนทำสีหรือเคลือบผิว การเลือกใช้ให้ตรงกับชนิดวัสดุ เช่น เหล็ก สเตนเลส อะลูมิเนียม ไม้ หรือพลาสติก จะช่วยให้ได้ผลงานที่ดีและยืดอายุการใช้งานของวัสดุขัด หากไม่แน่ใจว่าควรใช้รุ่นหรือเบอร์ใด ทีมงาน ${org.business_name} มีผู้เชี่ยวชาญพร้อมให้คำแนะนำให้เหมาะกับเนื้อวัสดุและงบประมาณของคุณ`,
      ],
    },
    {
      h: `ข้อควรระวังและความปลอดภัยในการใช้ ${name}`,
      body: [
        `ทุกครั้งที่ใช้ ${name} ควรสวมอุปกรณ์ป้องกัน เช่น แว่นตานิรภัย ถุงมือ และหน้ากากกันฝุ่น ตรวจสอบสภาพวัสดุขัดก่อนใช้ว่าไม่มีรอยร้าวหรือชำรุด ติดตั้งเข้ากับเครื่องมือให้แน่นและตรงขนาด และที่สำคัญที่สุดคืออย่าใช้ความเร็วรอบเกินค่าสูงสุดที่ระบุไว้บนสินค้า เพื่อความปลอดภัยของผู้ใช้งานและคุณภาพของชิ้นงาน`,
      ],
    },
    {
      h: `ทำไมต้องเลือก ${brand ? p.brand + " " : ""}จาก ${org.business_name}`,
      body: [
        `${org.business_name} คัดสรร ${name} ${brand ? "ของแท้จากแบรนด์ " + p.brand + " " : ""}ที่ผลิตได้มาตรฐานอุตสาหกรรม ทนแรงกดและรอบสูง ใช้งานได้ยาวนานและคุ้มค่า เรามีสินค้าครบวงจรสำหรับงานขัด ตัด เจียร พร้อมสต็อกรองรับโรงงานและงานผลิตจำนวนมาก สั่งซื้อได้ทั้งปลีกและส่ง พร้อมบริการให้คำปรึกษาเชิงเทคนิคเพื่อช่วยเลือกสินค้าให้ตรงกับงานของคุณ`,
      ],
    },
    {
      h: `สั่งซื้อ ${name} และขอใบเสนอราคาอย่างไร`,
      body: [
        `สั่งซื้อ ${name} ได้ง่าย ๆ เพียงกด "หยิบใส่ตะกร้า" แล้วส่งคำขอใบเสนอราคาผ่านเว็บไซต์ ทีมงาน ${org.business_name} จะติดต่อกลับเพื่อยืนยันราคา จำนวน และการจัดส่ง เรามีราคาพิเศษสำหรับการสั่งซื้อจำนวนมาก (ขายส่ง) และจัดส่งทั่วประเทศ ไม่ว่าคุณจะอยู่จังหวัดใดก็สั่งซื้อออนไลน์และรับสินค้าถึงหน้าบ้านหรือหน้างานได้${org.phone ? ` หรือสอบถามทีมงานได้ที่ โทร ${org.phone}` : ""}`,
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
  const brandText = brands.length ? brands.join(", ") : "หลากหลายแบรนด์ชั้นนำ";
  const matText = mats.length ? mats.join(", ") : "เหล็ก สเตนเลส อะลูมิเนียม ไม้ และพลาสติก";

  // type-aware selection guidance for the collection
  let howto: string;
  if (types.some((t) => /กระดาษทราย|จานทราย/.test(t))) {
    howto = `หัวใจของการเลือกสินค้าใน${kindWord} ${name} คือการเลือก "เบอร์ความหยาบ (#)" ให้ตรงกับขั้นตอนงาน — เบอร์น้อย (#40–#80) เม็ดหยาบ ขัด/ลอกผิวได้เร็ว เหมาะกับงานลบครีบ ลอกสีและสนิม ส่วนเบอร์มาก (#240 ขึ้นไป) เม็ดละเอียด เหมาะกับการเก็บผิวให้เรียบก่อนทำสีหรือขัดเงา แนะนำให้ไล่จากหยาบไปละเอียดทีละสเต็ปเพื่อรอยขัดที่สม่ำเสมอและประหยัดวัสดุ`;
  } else if (types.some((t) => /ใบตัด/.test(t))) {
    howto = `เมื่อเลือกใบตัดใน${kindWord} ${name} ให้ดูความหนาและขนาดเส้นผ่านศูนย์กลางให้เหมาะกับเครื่องและชิ้นงาน ใบบางตัดเร็วและสูญเสียเนื้อวัสดุน้อย เหมาะกับงานละเอียด ส่วนใบหนาทนทานกว่าเหมาะกับงานหนัก และต้องตรวจสอบความเร็วรอบสูงสุด (Max RPM) ให้สัมพันธ์กับเครื่องมือทุกครั้งเพื่อความปลอดภัย`;
  } else if (types.some((t) => /ใบเจียร|หินเจียร/.test(t))) {
    howto = `การเลือกใบเจียร/หินเจียรใน${kindWord} ${name} ควรพิจารณาชนิดวัสดุที่จะเจียร (เหล็ก สเตนเลส หรืออื่น ๆ) ความหนา และความเร็วรอบที่รองรับ เพื่อให้ลบรอยเชื่อมและเก็บผิวได้เรียบเนียนโดยไม่เกิดความร้อนสะสมที่ทำให้ชิ้นงานไหม้`;
  } else if (types.some((t) => /ใยขัด|สก๊อตไบร์ท/.test(t))) {
    howto = `วัสดุใยขัดสังเคราะห์ (สก๊อตไบร์ท) ใน${kindWord} ${name} เลือกตามระดับความหยาบของใย — หยาบสำหรับลอกคราบและสนิม ละเอียดสำหรับสร้างลายเส้น (แฮร์ไลน์) และปัดเงาสแตนเลส ควรคุมแรงกดและความเร็วให้พอดีเพื่อไม่ให้ผิวไหม้หรือเปลี่ยนสี`;
  } else {
    howto = `การเลือกสินค้าใน${kindWord} ${name} ควรพิจารณาชนิดวัสดุของชิ้นงาน ขั้นตอนงาน (ลอก/ขัดหยาบ หรือเก็บผิวละเอียด) และความเร็วรอบของเครื่องมือ เพื่อให้ได้ผลงานเรียบเนียน ปลอดภัย และคุ้มค่าที่สุด`;
  }

  return [
    {
      h: `${name} — รวมสินค้าอะไรบ้าง`,
      body: [
        `${name} เป็น${kindWord}งานขัด เจียร ตัด ของ ${org.business_name} ที่รวบรวมไว้ ${count} รายการ ครอบคลุม ${typeText} จากแบรนด์ ${brandText} เหมาะสำหรับช่างมืออาชีพ โรงงานอุตสาหกรรม และงานซ่อมบำรุง ${
          inStock > 0 ? `ในจำนวนนี้มีสินค้าพร้อมส่งทันที ${inStock} รายการ ` : ""
        }${lo && hi ? `ช่วงราคาเริ่มต้นประมาณ ${lo}–${hi} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%) ` : ""}สั่งซื้อได้ทั้งปลีกและส่ง พร้อมขอใบเสนอราคาออนไลน์ได้ทันที`,
      ],
    },
    {
      h: `วิธีเลือก ${name} ให้เหมาะกับงาน`,
      body: [howto],
    },
    {
      h: `${name} ใช้กับงานและวัสดุอะไรได้บ้าง`,
      body: [
        `สินค้าใน ${name} เหมาะกับงานบนวัสดุหลากหลาย เช่น ${matText} ครอบคลุมตั้งแต่การลบครีบ ลอกสนิมและสีเก่า ขัดรอยเชื่อม สร้างลายผิว ไปจนถึงการเก็บผิวขั้นสุดท้ายก่อนทำสีหรือเคลือบผิว การเลือกชนิดและความหยาบให้ตรงกับเนื้อวัสดุจะช่วยให้ผลงานออกมาดีและยืดอายุการใช้งานของวัสดุขัด หากไม่แน่ใจว่าควรใช้รุ่นใด ทีมผู้เชี่ยวชาญของ ${org.business_name} ยินดีให้คำแนะนำให้เหมาะกับงานและงบประมาณของคุณ`,
      ],
    },
    {
      h: `ทำไมต้องเลือก ${name} กับ ${org.business_name}`,
      body: [
        `${org.business_name} คัดสรรสินค้าใน ${name} ที่ผลิตได้มาตรฐานอุตสาหกรรม ทนแรงกดและรอบสูง ใช้งานได้ยาวนานและคุ้มค่า เรามีสต็อกรองรับการสั่งซื้อจำนวนมากสำหรับโรงงานและงานผลิต พร้อมราคาขายส่ง บริการจัดส่งทั่วประเทศ และทีมงานที่ให้คำปรึกษาเชิงเทคนิคเพื่อช่วยเลือกสินค้าให้ตรงกับงานของคุณจริง ๆ`,
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
