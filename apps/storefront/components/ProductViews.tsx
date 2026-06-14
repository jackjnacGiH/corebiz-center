"use client";

import { useEffect, useState, type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import type { SProduct } from "@/lib/products";
import { effectivePrice, formatTHB } from "@/lib/format";
import { useCart } from "@/components/cart/CartProvider";

/**
 * Customer-facing product list with 4 view modes (การ์ด / กระชับ / รายการ / ตาราง),
 * mirroring the admin's Grid/Compact/List/Table toggle. The chosen view is
 * remembered in localStorage so it sticks across pages and visits.
 *
 * Self-contained on purpose: only imports pure helpers (lib/format) and the
 * cart hook, so it stays on the client side without dragging server code in.
 */

const BRAND = "#1696F4";
type View = "grid" | "compact" | "list" | "table";
const VIEWS: View[] = ["grid", "compact", "list", "table"];
const STORAGE_KEY = "jnac:productView";

const img1 = (p: SProduct): string | null => (p.images && p.images.length ? p.images[0] : null);
const href = (p: SProduct) => `/p/${encodeURIComponent(p.sku)}`;

function Stock({ inStock }: { inStock: boolean }) {
  return inStock ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
      ● พร้อมส่ง
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      ✦ สั่งผลิต
    </span>
  );
}

function PriceTag({ p, className = "" }: { p: SProduct; className?: string }) {
  const eff = effectivePrice(p);
  const off = eff < Number(p.price || 0);
  return (
    <div className={`flex items-baseline gap-1.5 ${className}`}>
      <span className="font-extrabold" style={{ color: BRAND }}>{formatTHB(eff)}</span>
      {off && <span className="text-xs text-neutral-400 line-through">{formatTHB(Number(p.price))}</span>}
      {p.unit && <span className="text-[11px] text-neutral-400">/ {p.unit}</span>}
    </div>
  );
}

const PLUS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
  </svg>
);
const CHECK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function AddBtn({ p, variant }: { p: SProduct; variant: "overlay" | "mini" | "full" }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    add({ sku: p.sku, name: p.name_th, price: effectivePrice(p), unit: p.unit, image: img1(p), moq: p.min_order_qty ?? 1 });
    setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  };
  const bg = { background: added ? "#16a34a" : BRAND };
  if (variant === "full") {
    return (
      <button type="button" onClick={onClick} style={bg}
        className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white whitespace-nowrap hover:brightness-110 active:scale-95 transition">
        {added ? CHECK : PLUS}<span>{added ? "เพิ่มแล้ว" : "ใส่ตะกร้า"}</span>
      </button>
    );
  }
  const pos = variant === "overlay" ? "absolute top-1.5 right-1.5 z-10 shadow-md" : "";
  return (
    <button type="button" onClick={onClick} aria-label={`หยิบ ${p.name_th} ใส่ตะกร้า`} title="หยิบใส่ตะกร้าใบเสนอราคา" style={bg}
      className={`grid place-items-center h-8 w-8 rounded-full text-white hover:scale-110 active:scale-95 transition ${pos}`}>
      {added ? CHECK : PLUS}
    </button>
  );
}

// ── individual views ──────────────────────────────────────────────────────
function GridCard({ p }: { p: SProduct }) {
  const img = img1(p);
  return (
    <div className="group relative rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition">
      <Link href={href(p)} className="block">
        <div className="aspect-square bg-neutral-50 grid place-items-center overflow-hidden">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={p.name_th} loading="lazy" className="w-full h-full object-contain p-3 group-hover:scale-105 transition duration-300" />
          ) : (
            <span className="text-neutral-300 text-sm">ไม่มีรูป</span>
          )}
        </div>
        <div className="p-3 space-y-1.5">
          <div className="text-[11px] text-neutral-400 font-mono">{p.sku}</div>
          <h3 className="text-xs sm:text-sm text-neutral-800 leading-snug line-clamp-2 min-h-[2.25rem] sm:min-h-[2.5rem]">{p.name_th}</h3>
          <PriceTag p={p} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Stock inStock={p.in_stock} />
            {p.in_stock && p.stock_qty > 0 && (
              <span className="text-[11px] text-neutral-500">พร้อมขาย {p.stock_qty.toLocaleString("en-US")} {p.unit ?? "ชิ้น"}</span>
            )}
          </div>
        </div>
      </Link>
      <AddBtn p={p} variant="overlay" />
    </div>
  );
}

function GridView({ products }: { products: SProduct[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {products.map((p) => <GridCard key={p.id} p={p} />)}
    </div>
  );
}

function CompactView({ products }: { products: SProduct[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
      {products.map((p) => {
        const img = img1(p);
        return (
          <div key={p.id} className="group relative rounded-lg border border-neutral-200 bg-white overflow-hidden hover:shadow-sm transition">
            <Link href={href(p)} className="block">
              <div className="aspect-square bg-neutral-50 grid place-items-center overflow-hidden">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={p.name_th} loading="lazy" className="w-full h-full object-contain p-2" />
                ) : (
                  <span className="text-neutral-300 text-xs">—</span>
                )}
              </div>
              <div className="p-1.5 space-y-0.5">
                <h3 className="text-[11px] text-neutral-800 leading-tight line-clamp-2 min-h-[1.9rem]">{p.name_th}</h3>
                <div className="text-xs font-extrabold" style={{ color: BRAND }}>{formatTHB(effectivePrice(p))}</div>
              </div>
            </Link>
            <AddBtn p={p} variant="overlay" />
          </div>
        );
      })}
    </div>
  );
}

function ListView({ products }: { products: SProduct[] }) {
  return (
    <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {products.map((p) => {
        const img = img1(p);
        return (
          <div key={p.id} className="flex items-center gap-3 p-3 hover:bg-neutral-50">
            <Link href={href(p)} className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 rounded-lg bg-neutral-50 grid place-items-center overflow-hidden">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={p.name_th} loading="lazy" className="w-full h-full object-contain p-1.5" />
                ) : (
                  <span className="text-neutral-300 text-xs">—</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-neutral-400 font-mono">{p.sku}</div>
                <h3 className="text-sm text-neutral-800 leading-snug line-clamp-2">{p.name_th}</h3>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <Stock inStock={p.in_stock} />
                  {p.in_stock && p.stock_qty > 0 && (
                    <span className="text-[11px] text-neutral-500">พร้อมขาย {p.stock_qty.toLocaleString("en-US")} {p.unit ?? "ชิ้น"}</span>
                  )}
                </div>
              </div>
              <div className="hidden sm:block flex-shrink-0"><PriceTag p={p} className="justify-end" /></div>
            </Link>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div className="sm:hidden"><PriceTag p={p} className="justify-end" /></div>
              <AddBtn p={p} variant="full" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ products }: { products: SProduct[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-50 text-neutral-500 text-xs">
          <tr>
            <th className="text-left font-semibold px-3 py-2.5 w-14">รูป</th>
            <th className="text-left font-semibold px-3 py-2.5">สินค้า / SKU</th>
            <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">สถานะ</th>
            <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">ราคา</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {products.map((p) => {
            const img = img1(p);
            return (
              <tr key={p.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <Link href={href(p)} className="block w-10 h-10 rounded bg-neutral-50 grid place-items-center overflow-hidden">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={p.name_th} loading="lazy" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-neutral-300 text-[10px]">—</span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={href(p)} className="block">
                    <div className="text-[11px] text-neutral-400 font-mono">{p.sku}</div>
                    <div className="text-neutral-800 leading-snug line-clamp-2 max-w-md">{p.name_th}</div>
                  </Link>
                </td>
                <td className="px-3 py-2 align-middle"><Stock inStock={p.in_stock} /></td>
                <td className="px-3 py-2 text-right align-middle"><PriceTag p={p} className="justify-end" /></td>
                <td className="px-3 py-2 text-right align-middle"><AddBtn p={p} variant="mini" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── toggle icons + labels ─────────────────────────────────────────────────
const ICONS: Record<View, ReactNode> = {
  grid: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  compact: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="3" width="5" height="5" rx="1" /><rect x="17" y="3" width="4" height="5" rx="1" />
      <rect x="3" y="10" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><rect x="17" y="10" width="4" height="5" rx="1" />
      <rect x="3" y="17" width="5" height="4" rx="1" /><rect x="10" y="17" width="5" height="4" rx="1" /><rect x="17" y="17" width="4" height="4" rx="1" />
    </svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="5" height="5" rx="1" /><rect x="3" y="15" width="5" height="5" rx="1" />
      <line x1="11" y1="6" x2="21" y2="6" /><line x1="11" y1="10" x2="18" y2="10" />
      <line x1="11" y1="17" x2="21" y2="17" /><line x1="11" y1="21" x2="18" y2="21" />
    </svg>
  ),
  table: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="9" y1="9" x2="9" y2="20" />
    </svg>
  ),
};
const LABELS: Record<View, string> = { grid: "การ์ด", compact: "กระชับ", list: "รายการ", table: "ตาราง" };

export default function ProductViews({ products }: { products: SProduct[] }) {
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && (VIEWS as string[]).includes(v)) setView(v as View);
    } catch { /* ignore */ }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-neutral-200 bg-white p-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => choose(v)}
              aria-pressed={view === v}
              title={LABELS[v]}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                view === v ? "text-white" : "text-neutral-500 hover:bg-neutral-100"
              }`}
              style={view === v ? { background: BRAND } : undefined}
            >
              {ICONS[v]}
              <span className="hidden sm:inline">{LABELS[v]}</span>
            </button>
          ))}
        </div>
      </div>

      {view === "grid" && <GridView products={products} />}
      {view === "compact" && <CompactView products={products} />}
      {view === "list" && <ListView products={products} />}
      {view === "table" && <TableView products={products} />}
    </div>
  );
}
