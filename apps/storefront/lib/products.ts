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
  group_name: string | null;
  in_stock: boolean;
}

export interface SCategory {
  slug: string;
  name_th: string;
  name_en: string | null;
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

// ── Content helpers (AEO: answer-first, lists, tables, FAQ) ──────────────────

export function imagesOf(p: SProduct): string[] {
  return Array.isArray(p.images)
    ? (p.images.filter((x) => typeof x === "string") as string[])
    : [];
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
  faqs.push({
    q: `สั่งซื้อ ${name} ได้ที่ไหน?`,
    a: `สั่งซื้อหรือขอใบเสนอราคากับ ${org.business_name}${org.phone ? ` โทร ${org.phone}` : ""}${
      org.email ? ` อีเมล ${org.email}` : ""
    } หรือแชทกับทีมงานผ่านเว็บไซต์ได้ทันที.`,
  });
  const cat = p.category_name_th || p.group_name;
  if (cat) {
    faqs.push({
      q: `${name} เหมาะกับงานประเภทใด?`,
      a: `${name} อยู่ในกลุ่ม${cat} เหมาะสำหรับงานขัด เจียร ตัด ลอกสนิม และเก็บผิวชิ้นงานโลหะ ไม้ สเตนเลส และงานอุตสาหกรรมทั่วไป.`,
    });
  }
  return faqs;
}
