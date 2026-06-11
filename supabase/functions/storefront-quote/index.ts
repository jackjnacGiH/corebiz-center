/**
 * storefront-quote v2 — public (anon) endpoint that turns a storefront cart
 * into a Quote (draft) in Order Management, so the existing quote → approve →
 * sales-order flow handles it. Prices are recomputed server-side from the DB
 * (never trust the client). Customer contact is stored in the quote notes.
 *
 * v2: logged-in members send their own JWT — the quote is then attached to
 * their linked CRM customer (verified or pending link; pending stays hidden
 * from the portal but staff see it under the right company), and a VERIFIED
 * member's tier discount (tier_benefits.discount_percent) is applied
 * automatically. Anonymous shoppers behave exactly as before.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ITEMS = 60;
const VAT_RATE = 0.07;

function effectivePrice(price: unknown, val: unknown, type: unknown): number {
  const base = Number(price ?? 0);
  const v = Number(val ?? 0);
  if (!v) return base;
  const off = type === "percent" ? (base * v) / 100 : v;
  return Math.max(0, base - off);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "รูปแบบคำขอไม่ถูกต้อง" }, 400); }

  const rawItems = Array.isArray(body.items) ? (body.items as Array<{ sku?: string; qty?: number }>) : [];
  const contact = (body.contact ?? {}) as { name?: string; phone?: string; email?: string; company?: string; note?: string };

  const name = String(contact.name ?? "").trim();
  const phone = String(contact.phone ?? "").trim();
  if (!name || !phone) return json({ ok: false, error: "กรุณากรอกชื่อและเบอร์โทรติดต่อ" }, 400);
  if (rawItems.length === 0) return json({ ok: false, error: "ตะกร้าว่างเปล่า" }, 400);
  if (rawItems.length > MAX_ITEMS) return json({ ok: false, error: "รายการสินค้ามากเกินไป" }, 400);

  // Collapse duplicate SKUs + clamp quantities.
  const wanted = new Map<string, number>();
  for (const it of rawItems) {
    const sku = String(it?.sku ?? "").trim();
    if (!sku) continue;
    const q = Math.max(1, Math.floor(Number(it?.qty) || 1));
    wanted.set(sku, (wanted.get(sku) ?? 0) + q);
  }
  const skus = [...wanted.keys()];
  if (skus.length === 0) return json({ ok: false, error: "ตะกร้าว่างเปล่า" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ── Member resolution (optional) ──────────────────────────────────────────
  // The storefront sends the logged-in user's JWT instead of the anon key.
  // Verified link → attach customer + tier discount. Pending link → attach
  // customer only (back office records it under the right company; the portal
  // keeps it hidden until Owner/Admin approve).
  let customerId: string | null = null;
  let tierLabel: string | null = null;
  let discountPct = 0;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const { data: u } = await admin.auth.getUser(token).catch(() => ({ data: null }));
    const uid = u?.user?.id;
    if (uid) {
      const { data: cc } = await admin
        .from("customer_contacts")
        .select("customer_id, verified")
        .eq("user_id", uid)
        .maybeSingle();
      let verified = false;
      if (cc) {
        customerId = cc.customer_id as string;
        verified = Boolean(cc.verified);
      } else {
        const { data: c } = await admin
          .from("customers").select("id").eq("user_id", uid).maybeSingle();
        if (c) { customerId = c.id as string; verified = true; }
      }
      if (customerId && verified) {
        const { data: cust } = await admin
          .from("customers").select("tier").eq("id", customerId).maybeSingle();
        if (cust?.tier) {
          const { data: ben } = await admin
            .from("tier_benefits")
            .select("label, discount_percent")
            .eq("tier", cust.tier)
            .maybeSingle();
          discountPct = Number(ben?.discount_percent ?? 0);
          tierLabel = (ben?.label as string | undefined) ?? null;
        }
      }
    }
  }

  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, sku, name_th, unit, price, discount_value, discount_type")
    .in("sku", skus)
    .eq("status", "active");
  if (pErr) return json({ ok: false, error: pErr.message }, 500);

  const rows: Array<Record<string, unknown>> = [];
  let subtotal = 0;
  for (const p of (products ?? []) as Array<Record<string, unknown>>) {
    const qty = wanted.get(String(p.sku)) ?? 0;
    if (qty <= 0) continue;
    const unitPrice = effectivePrice(p.price, p.discount_value, p.discount_type);
    const lineTotal = r2(unitPrice * qty);
    subtotal += lineTotal;
    rows.push({
      product_id: p.id, sku: p.sku, product_name: p.name_th,
      quantity: qty, unit_price: unitPrice, unit: p.unit ?? null, discount: 0, total: lineTotal,
    });
  }
  if (rows.length === 0) return json({ ok: false, error: "ไม่พบสินค้าที่เลือกในระบบ" }, 400);

  subtotal = r2(subtotal);
  // Verified member → tier discount applied up-front (staff still confirm the
  // final price before sending, as the storefront tells the customer).
  const discount = discountPct > 0 ? r2((subtotal * discountPct) / 100) : 0;
  const net = r2(subtotal - discount);
  const vat = r2(net * VAT_RATE);
  const total = r2(net + vat);

  const notes =
    "📥 คำขอใบเสนอราคาจากหน้าร้านออนไลน์ (www.jnac.online)\n" +
    `ชื่อผู้ติดต่อ: ${name}\n` +
    `โทร: ${phone}` +
    (contact.email ? `\nอีเมล: ${String(contact.email).trim()}` : "") +
    (contact.company ? `\nบริษัท/ร้าน: ${String(contact.company).trim()}` : "") +
    (customerId
      ? `\nสมาชิก: ✓ ผูกกับลูกค้าในระบบ${tierLabel ? ` (Tier ${tierLabel}${discountPct > 0 ? `, ส่วนลดสมาชิก ${discountPct}%` : ""})` : " (รอยืนยันตัวตน)"}`
      : "") +
    (contact.note ? `\nหมายเหตุ: ${String(contact.note).trim().slice(0, 500)}` : "");

  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const { data: quote, error: qErr } = await admin
    .from("quotes")
    .insert({ customer_id: customerId, status: "draft", subtotal, discount, vat, total, valid_until: validUntil, notes })
    .select("id, code")
    .single();
  if (qErr) return json({ ok: false, error: qErr.message }, 500);

  const { error: iErr } = await admin
    .from("quote_items")
    .insert(rows.map((r) => ({ ...r, quote_id: (quote as { id: string }).id })));
  if (iErr) return json({ ok: false, error: iErr.message }, 500);

  return json({ ok: true, code: (quote as { code: string }).code });
});
