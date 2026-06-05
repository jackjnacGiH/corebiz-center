import Link from "next/link";
import type { SProduct } from "@/lib/products";
import { imagesOf } from "@/lib/products";
import { effectivePrice, formatTHB } from "@/lib/format";
import { SITE, type OrgInfo } from "@/lib/seo";

const BRAND = "#1696F4";

export function StockBadge({ inStock }: { inStock: boolean }) {
  return inStock ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
      ● พร้อมส่ง
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      ✦ สั่งผลิต
    </span>
  );
}

export function Price({ p }: { p: SProduct }) {
  const eff = effectivePrice(p);
  const discounted = eff < Number(p.price || 0);
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-extrabold" style={{ color: BRAND }}>
        {formatTHB(eff)}
      </span>
      {discounted && (
        <span className="text-sm text-neutral-400 line-through">{formatTHB(Number(p.price))}</span>
      )}
      {p.unit && <span className="text-xs text-neutral-400">/ {p.unit}</span>}
    </div>
  );
}

export function ProductCard({ p }: { p: SProduct }) {
  const img = imagesOf(p)[0];
  return (
    <Link
      href={`/p/${encodeURIComponent(p.sku)}`}
      className="group block rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition"
    >
      <div className="aspect-square bg-neutral-50 grid place-items-center overflow-hidden">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={p.name_th}
            loading="lazy"
            className="w-full h-full object-contain p-3 group-hover:scale-105 transition duration-300"
          />
        ) : (
          <span className="text-neutral-300 text-sm">ไม่มีรูป</span>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="text-[11px] text-neutral-400 font-mono">{p.sku}</div>
        <h3 className="text-sm text-neutral-800 leading-snug line-clamp-2 min-h-[2.5rem]">
          {p.name_th}
        </h3>
        <Price p={p} />
        <StockBadge inStock={p.in_stock} />
      </div>
    </Link>
  );
}

export function GroupCard({
  id,
  name,
  cover,
  count,
}: {
  id: string;
  name: string;
  cover: string | null;
  count: number;
}) {
  return (
    <Link
      href={`/g/${encodeURIComponent(id)}`}
      className="group block rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition"
    >
      <div className="aspect-[4/3] bg-neutral-50 grid place-items-center overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
        ) : (
          <span className="text-neutral-300 text-sm">{name}</span>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-neutral-800 leading-snug line-clamp-2 min-h-[2.5rem]">
          {name}
        </h3>
        <span
          className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ background: "rgba(22,150,244,0.1)", color: BRAND }}
        >
          {count} รายการ
        </span>
      </div>
    </Link>
  );
}

export function CtaButtons({ org, label }: { org: OrgInfo; label?: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <a
        href={`${SITE}/widget`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-[180px] text-center text-white rounded-lg py-3.5 px-8 font-semibold transition shadow-md"
        style={{ background: BRAND }}
      >
        {label ?? "ขอใบเสนอราคา / สอบถาม"}
      </a>
      {org.phone && (
        <a
          href={`tel:${org.phone.replace(/\s+/g, "")}`}
          className="rounded-lg border border-neutral-300 py-3.5 px-5 font-semibold text-neutral-700 hover:bg-neutral-50 transition"
        >
          โทร {org.phone}
        </a>
      )}
    </div>
  );
}

export function Breadcrumb({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav className="flex text-sm text-neutral-500 mb-6" aria-label="Breadcrumb">
      <ol className="inline-flex items-center gap-1.5 flex-wrap">
        {items.map((it, i) => (
          <li key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-neutral-300">/</span>}
            {it.href ? (
              <Link href={it.href} className="hover:underline" style={{ color: i === 0 ? undefined : undefined }}>
                {it.name}
              </Link>
            ) : (
              <span className="text-neutral-800 font-medium">{it.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Nav({ org }: { org: OrgInfo }) {
  return (
    <nav className="bg-white border-b border-neutral-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between h-16 items-center">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={org.business_name} className="w-8 h-8 object-contain flex-shrink-0" />
          ) : (
            <span
              className="w-8 h-8 rounded-md text-white grid place-items-center font-bold flex-shrink-0"
              style={{ background: BRAND }}
            >
              J
            </span>
          )}
          <span className="font-bold text-base sm:text-lg tracking-tight text-neutral-900 truncate">
            {org.business_name}
          </span>
        </Link>
        <div className="flex items-center gap-3 text-sm font-medium text-neutral-600 flex-shrink-0">
          <Link href="/" className="hidden sm:inline hover:text-neutral-900">
            สินค้าทั้งหมด
          </Link>
          <a
            href={`${SITE}/widget`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg transition"
            style={{ background: "rgba(22,150,244,0.1)", color: BRAND }}
          >
            แชทสอบถาม
          </a>
        </div>
      </div>
    </nav>
  );
}

export function Footer({ org }: { org: OrgInfo }) {
  return (
    <footer className="border-t border-neutral-200 bg-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-sm text-neutral-600 space-y-1.5">
        <div className="font-bold text-neutral-900 text-base">{org.business_name}</div>
        {org.address && <div>{org.address}</div>}
        {org.tax_id && <div>เลขประจำตัวผู้เสียภาษี {org.tax_id}</div>}
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
          {org.phone && <span>โทร {org.phone}</span>}
          {org.email && <span>อีเมล {org.email}</span>}
          {org.website && (
            <a href={org.website} className="hover:underline" style={{ color: BRAND }}>
              {org.website}
            </a>
          )}
        </div>
        <div className="text-xs text-neutral-400 pt-4">
          © {org.business_name} · จำหน่ายวัสดุและอุปกรณ์งานขัด เจียร ตัด ขัดเงา และเครื่องมือลม
        </div>
      </div>
    </footer>
  );
}
