import Link from "next/link";
import type { SProduct } from "@/lib/products";
import { imagesOf } from "@/lib/products";
import { effectivePrice, formatTHB } from "@/lib/format";
import { SITE, type OrgInfo } from "@/lib/seo";
import CartButton from "@/components/cart/CartButton";
import CardAddButton from "@/components/cart/CardAddButton";

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
    <div className="group relative rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition">
      <Link href={`/p/${encodeURIComponent(p.sku)}`} className="block">
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
      <CardAddButton
        sku={p.sku}
        name={p.name_th}
        price={effectivePrice(p)}
        unit={p.unit}
        image={img ?? null}
        moq={p.min_order_qty ?? 1}
      />
    </div>
  );
}

export function GroupCard({
  id,
  name,
  cover,
  count,
  priceMin,
  priceMax,
  inStock,
}: {
  id: string;
  name: string;
  cover: string | null;
  count: number;
  priceMin: number | null;
  priceMax: number | null;
  inStock: boolean;
}) {
  const priceLabel =
    priceMin == null || priceMax == null
      ? null
      : priceMin === priceMax
        ? formatTHB(priceMin)
        : `${formatTHB(priceMin)}-${formatTHB(priceMax)}`;
  return (
    <Link
      href={`/g/${encodeURIComponent(id)}`}
      className="group block rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition"
    >
      <div className="aspect-square bg-neutral-50 grid place-items-center overflow-hidden relative">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={name}
            loading="lazy"
            className="w-full h-full object-contain p-3 group-hover:scale-105 transition duration-300"
          />
        ) : (
          <span className="text-neutral-300 text-sm px-2 text-center">{name}</span>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-white/90 border border-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
          กลุ่ม
        </span>
      </div>
      <div className="p-3 space-y-1.5">
        <h3 className="text-sm font-semibold text-neutral-800 leading-snug line-clamp-2 min-h-[2.5rem]">
          {name}
        </h3>
        {priceLabel && (
          <div className="font-extrabold text-sm" style={{ color: BRAND }}>
            {priceLabel}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <StockBadge inStock={inStock} />
          <span className="text-[11px] text-neutral-400 whitespace-nowrap">{count} รายการ</span>
        </div>
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

const NAVY = "#0C3C63";

export function Nav({ org }: { org: OrgInfo }) {
  return (
    <nav className="sticky top-0 z-50 shadow-lg" style={{ background: NAVY }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between h-16 items-center">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={org.business_name} className="w-9 h-9 object-contain flex-shrink-0 brightness-0 invert" />
          ) : (
            <span className="w-9 h-9 rounded-md grid place-items-center font-bold flex-shrink-0 bg-white/15 text-white">J</span>
          )}
          <span className="font-bold text-sm sm:text-base tracking-tight text-white truncate">
            {org.business_name}
          </span>
        </Link>
        <div className="flex items-center gap-3 lg:gap-5 text-sm font-semibold flex-shrink-0">
          <Link href="/" className="hidden lg:inline text-white/80 hover:text-white transition">หน้าแรก</Link>
          <Link href="/products" className="hidden lg:inline text-white/80 hover:text-white transition">สินค้าทั้งหมด</Link>
          <Link href="/how-to-order" className="hidden lg:inline text-white/80 hover:text-white transition">วิธีการสั่งซื้อ</Link>
          <Link href="/knowledge" className="hidden lg:inline text-white/80 hover:text-white transition">ศูนย์ความรู้ (AIO)</Link>
          <a href="#contact" className="hidden lg:inline text-white/80 hover:text-white transition">ติดต่อเรา</a>
          <CartButton />
        </div>
      </div>
    </nav>
  );
}

export function Footer({ org }: { org: OrgInfo }) {
  const underline = "font-bold mb-3 inline-block relative after:absolute after:left-0 after:-bottom-1 after:w-10 after:h-0.5 after:bg-[#1696F4]";
  return (
    <footer id="contact" className="text-white mt-16" style={{ background: NAVY }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-8">
          <div>
            <div className="font-extrabold text-xl">{org.business_name}</div>
            <p className="mt-3 text-sm text-white/70 max-w-md leading-relaxed">
              ผู้นำเข้าและจัดจำหน่ายสินค้าอุตสาหกรรม เครื่องมือ Tool พลาสติกวิศวกรรม และบริการงาน CNC ครบวงจร
            </p>
          </div>
          <div>
            <h3 className={underline}>ติดต่อเรา</h3>
            <ul className="space-y-2 text-sm text-white/75">
              <li>📞 โทร: 02-101-5587, 08-0016-1700</li>
              <li>📱 Line ID: @jnac</li>
              <li>📧 อีเมล: info@jnac.co.th</li>
              {org.address && <li>🏢 {org.address}</li>}
            </ul>
          </div>
          <div>
            <h3 className={underline}>เมนูด่วน</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/products" className="text-white/75 hover:text-white transition">สินค้าทั้งหมด</Link></li>
              <li><Link href="/how-to-order" className="text-white/75 hover:text-white transition">วิธีการสั่งซื้อ</Link></li>
              <li><Link href="/knowledge" className="text-white/75 hover:text-white transition">ศูนย์ความรู้ (AIO)</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-white/10 text-center text-xs text-white/50">
          © {org.business_name} · จำหน่ายวัสดุงานขัด ตัด เจียร เครื่องมือ Tool และพลาสติกวิศวกรรม — Optimized for AIO &amp; Industrial Customers
        </div>
      </div>
    </footer>
  );
}
