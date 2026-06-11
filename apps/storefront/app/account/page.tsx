"use client";

/**
 * Customer portal — "บัญชีของฉัน".
 *
 * Logged-in customers (linked to a CRM customer row via customers.user_id —
 * auto-linked by e-mail on first visit) see: their tier + benefits, company
 * profile, and quote / order history. All data flows through the narrow
 * security-definer RPCs from migration 0049 (safe columns, own rows only).
 */
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser, getPortalProfile, type PortalProfile } from "@/lib/supabase-browser";

const BRAND = "#1696F4";

const TIER_STYLE: Record<string, string> = {
  general: "bg-neutral-100 text-neutral-700 border-neutral-200",
  silver: "bg-slate-100 text-slate-700 border-slate-300",
  gold: "bg-amber-100 text-amber-800 border-amber-300",
  vip: "bg-violet-100 text-violet-800 border-violet-300",
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "รอดำเนินการ", cls: "bg-amber-50 text-amber-700" },
  processing: { label: "กำลังเตรียม", cls: "bg-blue-50 text-blue-700" },
  shipped: { label: "พร้อมส่ง", cls: "bg-sky-50 text-sky-700" },
  delivered: { label: "จัดส่งแล้ว", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "ยกเลิก", cls: "bg-rose-50 text-rose-600" },
  returned: { label: "คืนสินค้า", cls: "bg-neutral-100 text-neutral-600" },
};

const QUOTE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "ฉบับร่าง", cls: "bg-neutral-100 text-neutral-600" },
  sent: { label: "ส่งให้ลูกค้าแล้ว", cls: "bg-blue-50 text-blue-700" },
  accepted: { label: "ตอบรับแล้ว", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "ปฏิเสธ", cls: "bg-rose-50 text-rose-600" },
  expired: { label: "หมดอายุ", cls: "bg-neutral-100 text-neutral-500" },
  converted: { label: "เปิดเป็นออเดอร์แล้ว", cls: "bg-emerald-50 text-emerald-700" },
};

interface DocRow {
  id: string;
  code: string;
  status: string;
  total: number;
  created_at: string;
  payment_status?: string;
  valid_until?: string | null;
}
interface DocItem { sku: string; product_name: string; quantity: number; unit_price: number; total: number }

const baht = (n: unknown) =>
  "฿" + Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });

/** billing_address / shipping_address are jsonb — string or object. */
function formatAddress(a: unknown): string {
  if (!a) return "";
  if (typeof a === "string") return a;
  if (typeof a === "object") {
    const o = a as Record<string, unknown>;
    const keys = ["address", "line1", "street", "subdistrict", "district", "city", "province", "postcode", "postal_code", "zip"];
    const parts = keys.map((k) => o[k]).filter((v) => typeof v === "string" && v.trim());
    if (parts.length) return parts.join(" ");
    return Object.values(o).filter((v) => typeof v === "string" && (v as string).trim()).join(" ");
  }
  return "";
}

export default function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [orders, setOrders] = useState<DocRow[]>([]);
  const [quotes, setQuotes] = useState<DocRow[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const sb = supabaseBrowser();
      const { data: sess } = await sb.auth.getSession();
      if (!mounted) return;
      if (!sess.session) {
        setHasSession(false);
        setLoading(false);
        return;
      }
      setHasSession(true);
      setUserEmail(sess.session.user.email ?? null);
      const p = await getPortalProfile(true);
      if (!mounted) return;
      setProfile(p);
      if (p) {
        const [o, q] = await Promise.all([sb.rpc("my_orders"), sb.rpc("my_quotes")]);
        if (!mounted) return;
        setOrders(((o.data ?? []) as DocRow[]));
        setQuotes(((q.data ?? []) as DocRow[]));
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">บัญชีของฉัน</h1>

      {loading && <p className="mt-8 text-neutral-400">กำลังโหลดข้อมูล...</p>}

      {/* Not logged in */}
      {!loading && !hasSession && (
        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
          <p className="text-neutral-600">กรุณาเข้าสู่ระบบเพื่อดูข้อมูลบัญชี ราคาสมาชิก และประวัติการสั่งซื้อของคุณ</p>
          <a
            href="/center/login"
            className="mt-5 inline-block rounded-lg px-6 py-3 font-semibold text-white transition hover:opacity-90"
            style={{ background: BRAND }}
          >
            เข้าสู่ระบบ / สมัครสมาชิก
          </a>
        </div>
      )}

      {/* Logged in but not linked to a CRM customer */}
      {!loading && hasSession && !profile && (
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8">
          <h2 className="font-bold text-amber-900">ยังไม่พบข้อมูลลูกค้าที่ผูกกับบัญชีนี้</h2>
          <p className="mt-2 text-sm text-amber-800 leading-relaxed">
            อีเมลที่เข้าสู่ระบบ ({userEmail ?? "-"}) ยังไม่ตรงกับข้อมูลลูกค้าในระบบของเรา
            หากคุณเป็นลูกค้า JNAC อยู่แล้ว กรุณาติดต่อทีมงานเพื่อผูกบัญชี — โทร 02-101-5587
            หรือ LINE <b>@jnac</b> แจ้งอีเมลนี้ได้เลยครับ
          </p>
          <button onClick={signOut} className="mt-4 text-sm text-amber-700 underline underline-offset-2">
            ออกจากระบบ
          </button>
        </div>
      )}

      {!loading && profile && (
        <div className="mt-8 space-y-6">
          {/* ── Tier card ── */}
          <section className="rounded-2xl border border-neutral-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-neutral-900">{profile.name}</div>
                <div className="mt-0.5 text-xs text-neutral-400 font-mono">รหัสลูกค้า {profile.code}</div>
              </div>
              <span className={`rounded-full border px-4 py-1.5 text-sm font-bold ${TIER_STYLE[profile.tier] ?? TIER_STYLE.general}`}>
                ระดับสมาชิก: {profile.tier_label}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-xl bg-neutral-50 border border-neutral-100 p-3">
                <div className="text-[11px] text-neutral-500">ส่วนลดสมาชิก</div>
                <div className="text-xl font-extrabold" style={{ color: BRAND }}>
                  {Number(profile.discount_percent)}%
                </div>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-100 p-3">
                <div className="text-[11px] text-neutral-500">คะแนนสะสม</div>
                <div className="text-xl font-extrabold text-neutral-800">{profile.loyalty_points.toLocaleString("en-US")}</div>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-100 p-3">
                <div className="text-[11px] text-neutral-500">ตัวคูณคะแนน</div>
                <div className="text-xl font-extrabold text-neutral-800">×{Number(profile.point_multiplier)}</div>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-100 p-3">
                <div className="text-[11px] text-neutral-500">ยอดสั่งซื้อสะสม</div>
                <div className="text-xl font-extrabold text-neutral-800">{baht(profile.total_spent)}</div>
              </div>
            </div>
            {Number(profile.discount_percent) > 0 && (
              <p className="mt-3 text-xs text-neutral-500">
                💡 ส่วนลดสมาชิก {Number(profile.discount_percent)}% จะถูกนำไปคำนวณในใบเสนอราคาของคุณโดยทีมงาน
              </p>
            )}
          </section>

          {/* ── Company info ── */}
          <section className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 className="font-bold text-neutral-900 mb-4">ข้อมูลบริษัท / ผู้ติดต่อ</h2>
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div><dt className="text-neutral-400 text-xs">ชื่อ</dt><dd className="text-neutral-800 font-medium">{profile.name}</dd></div>
              {profile.tax_id && <div><dt className="text-neutral-400 text-xs">เลขประจำตัวผู้เสียภาษี</dt><dd className="text-neutral-800 font-medium font-mono">{profile.tax_id}</dd></div>}
              {profile.phone && <div><dt className="text-neutral-400 text-xs">โทรศัพท์</dt><dd className="text-neutral-800 font-medium">{profile.phone}</dd></div>}
              {profile.email && <div><dt className="text-neutral-400 text-xs">อีเมล</dt><dd className="text-neutral-800 font-medium">{profile.email}</dd></div>}
              {formatAddress(profile.billing_address) && (
                <div className="sm:col-span-2"><dt className="text-neutral-400 text-xs">ที่อยู่ออกใบกำกับ</dt><dd className="text-neutral-800">{formatAddress(profile.billing_address)}</dd></div>
              )}
              {formatAddress(profile.shipping_address) && (
                <div className="sm:col-span-2"><dt className="text-neutral-400 text-xs">ที่อยู่จัดส่ง</dt><dd className="text-neutral-800">{formatAddress(profile.shipping_address)}</dd></div>
              )}
            </dl>
            <p className="mt-4 text-xs text-neutral-400">ต้องการแก้ไขข้อมูล? ติดต่อทีมงาน โทร 02-101-5587 หรือ LINE @jnac</p>
          </section>

          <DocSection title="ใบเสนอราคาของฉัน" rows={quotes} statusMap={QUOTE_STATUS} rpcItems="my_quote_items" paramName="p_quote_id" />
          <DocSection title="ประวัติคำสั่งซื้อ" rows={orders} statusMap={ORDER_STATUS} rpcItems="my_order_items" paramName="p_order_id" showPayment />

          <div className="text-right">
            <button onClick={signOut} className="text-sm text-neutral-400 hover:text-neutral-600 underline underline-offset-2 transition">
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Expandable document history table (orders / quotes) ─────────────────────
function DocSection({
  title, rows, statusMap, rpcItems, paramName, showPayment,
}: {
  title: string;
  rows: DocRow[];
  statusMap: Record<string, { label: string; cls: string }>;
  rpcItems: string;
  paramName: string;
  showPayment?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, DocItem[]>>({});

  const toggle = useCallback(async (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    if (!items[id]) {
      const { data } = await supabaseBrowser().rpc(rpcItems, { [paramName]: id });
      setItems((m) => ({ ...m, [id]: (data ?? []) as DocItem[] }));
    }
  }, [items, rpcItems, paramName]);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <h2 className="font-bold text-neutral-900 px-6 pt-5 pb-3">
        {title} <span className="text-sm font-normal text-neutral-400">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-neutral-400">ยังไม่มีรายการ</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs">
              <tr>
                <th className="text-left font-medium px-6 py-2.5">เลขที่</th>
                <th className="text-left font-medium px-4 py-2.5">วันที่</th>
                <th className="text-left font-medium px-4 py-2.5">สถานะ</th>
                {showPayment && <th className="text-left font-medium px-4 py-2.5">ชำระเงิน</th>}
                <th className="text-right font-medium px-6 py-2.5">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => {
                const st = statusMap[r.status] ?? { label: r.status, cls: "bg-neutral-100 text-neutral-600" };
                const open = openId === r.id;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r} st={st} open={open} showPayment={showPayment}
                    items={items[r.id]}
                    onToggle={() => void toggle(r.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FragmentRow({
  r, st, open, showPayment, items, onToggle,
}: {
  r: DocRow;
  st: { label: string; cls: string };
  open: boolean;
  showPayment?: boolean;
  items?: DocItem[];
  onToggle: () => void;
}) {
  const cols = showPayment ? 5 : 4;
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-neutral-50 transition">
        <td className="px-6 py-3 font-mono font-semibold" style={{ color: BRAND }}>
          <span className="mr-1.5 inline-block text-neutral-300">{open ? "▾" : "▸"}</span>{r.code}
        </td>
        <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
        <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
        {showPayment && (
          <td className="px-4 py-3 text-xs text-neutral-500">{r.payment_status === "paid" ? "ชำระแล้ว" : r.payment_status === "partial" ? "ชำระบางส่วน" : "ยังไม่ชำระ"}</td>
        )}
        <td className="px-6 py-3 text-right font-bold tabular-nums text-neutral-800">{baht(r.total)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} className="bg-neutral-50/60 px-6 py-3">
            {!items ? (
              <span className="text-xs text-neutral-400">กำลังโหลดรายการ...</span>
            ) : items.length === 0 ? (
              <span className="text-xs text-neutral-400">ไม่มีรายการสินค้า</span>
            ) : (
              <ul className="space-y-1.5">
                {items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-3 text-xs">
                    <span className="text-neutral-700">
                      {it.product_name} <span className="text-neutral-400 font-mono">({it.sku})</span> × {it.quantity}
                    </span>
                    <span className="tabular-nums text-neutral-600 whitespace-nowrap">{baht(it.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
