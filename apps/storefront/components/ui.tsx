import Link from "next/link";
import type { SProduct } from "@/lib/products";
import { imagesOf } from "@/lib/products";
import { effectivePrice, formatTHB } from "@/lib/format";
import { SITE, type OrgInfo } from "@/lib/seo";
import CartButton from "@/components/cart/CartButton";
import CardAddButton from "@/components/cart/CardAddButton";
import AccountNavButton from "@/components/account/AccountNavButton";

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
          <h3 className="text-xs sm:text-sm text-neutral-800 leading-snug line-clamp-none sm:line-clamp-2 min-h-[2.25rem] sm:min-h-[2.5rem]">
            {p.name_th}
          </h3>
          <Price p={p} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <StockBadge inStock={p.in_stock} />
            {p.in_stock && p.stock_qty > 0 && (
              <span className="text-[11px] text-neutral-500">
                พร้อมขาย {p.stock_qty.toLocaleString("en-US")} {p.unit ?? "ชิ้น"}
              </span>
            )}
          </div>
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
        <h3 className="text-xs sm:text-sm text-neutral-800 leading-snug line-clamp-none sm:line-clamp-2 min-h-[2.25rem] sm:min-h-[2.5rem]">
          {name}
        </h3>
        {priceLabel && (
          <div className="font-extrabold text-sm" style={{ color: BRAND }}>
            {priceLabel}
          </div>
        )}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
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

// JNAC head-office pin on Google Maps (ที่ตั้งบริษัท — ใช้ทั้งปุ่มไอคอน
// และลิงก์ที่อยู่ใน footer).
export const MAP_URL = "https://goo.gl/maps/yBSsrexnAi42";

// JNAC social channels. LINE ID @jnac is confirmed (footer contact);
// the rest use the jnac handle — update here if a channel's URL differs.
type Social = { name: string; href: string; label: string; icon: React.ReactNode };
const SOCIALS: Social[] = [
  {
    name: "Google Maps",
    label: "ดูแผนที่ / เส้นทางมาบริษัท (Google Maps)",
    href: MAP_URL,
    icon: (
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    ),
  },
  {
    name: "Line",
    label: "เพิ่มเพื่อนใน LINE @jnac",
    href: "https://line.me/R/ti/p/@jnac",
    icon: (
      <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.27 8.846 10.035 9.608.391.084.923.258 1.058.592.121.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.647 1.281-.54 6.911-4.069 9.428-6.967h-.001c1.739-1.907 2.572-3.843 2.572-5.994l-.001-.001zm-18.988-2.595c.129 0 .234.105.234.234v4.153h2.287c.129 0 .233.104.233.233v.842c0 .129-.104.234-.233.234h-3.363c-.063 0-.119-.025-.161-.065l-.001-.001-.002-.002-.001-.001-.002-.002c-.04-.042-.065-.099-.065-.161v-5.229c0-.129.104-.234.234-.234h.84l.001-.001zm14.992 0c.129 0 .233.105.233.234v.842c0 .129-.104.234-.233.234h-2.287v.883h2.287c.129 0 .233.105.233.234v.842c0 .129-.104.234-.233.234h-2.287v.884h2.287c.129 0 .233.104.233.233v.842c0 .129-.104.234-.233.234h-3.363c-.062 0-.119-.025-.161-.065l-.002-.002-.001-.002-.002-.001-.001-.002c-.04-.042-.065-.098-.065-.161v-5.229c0-.062.025-.119.065-.161l.002-.002.001-.002.002-.001.002-.002c.042-.04.098-.064.16-.064h3.363l.001-.001zm-10.064 0c.129 0 .234.105.234.234v5.229c0 .129-.105.234-.234.234h-.84c-.13 0-.234-.105-.234-.234v-5.229c0-.129.104-.234.234-.234h.84zm2.085 0c.018 0 .036.002.054.006l.012.004.014.004.018.008.013.006.012.007.013.008.011.009.013.011.011.012.012.014.005.007 2.392 3.231v-3.103c0-.129.104-.234.234-.234h.84c.129 0 .234.105.234.234v5.229c0 .129-.105.234-.234.234h-.84l-.06-.008-.013-.004-.013-.004-.013-.006-.013-.006-.012-.007-.029-.022-.011-.011-.012-.013-2.392-3.23v3.103c0 .129-.104.234-.234.234h-.84c-.129 0-.234-.105-.234-.234v-5.229c0-.129.105-.234.234-.234h.838z" />
    ),
  },
  {
    name: "Facebook",
    label: "Facebook ของ JNAC",
    href: "https://www.facebook.com/jnacthailand",
    icon: (
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    ),
  },
  {
    name: "TikTok",
    label: "TikTok ของ JNAC",
    href: "https://www.tiktok.com/@jnac",
    icon: (
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    ),
  },
  {
    name: "YouTube",
    label: "YouTube ของ JNAC",
    href: "https://www.youtube.com/@jnac",
    icon: (
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    ),
  },
  {
    name: "Instagram",
    label: "Instagram ของ JNAC",
    href: "https://www.instagram.com/jnac",
    icon: (
      <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.441 1.441 0 0 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
    ),
  },
  {
    name: "Twitter",
    label: "Twitter / X ของ JNAC",
    href: "https://x.com/jnac",
    icon: (
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    ),
  },
];

export function SocialLinks() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2.5">
      {SOCIALS.map((s) => (
        <a
          key={s.name}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          title={s.name}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/80 transition hover:scale-110 hover:bg-[#1696F4] hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            {s.icon}
          </svg>
        </a>
      ))}
    </div>
  );
}

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
          {/* เข้าสู่ระบบ ↔ บัญชีของฉัน (swaps with the customer's session). */}
          <AccountNavButton />
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
            <SocialLinks />
          </div>
          <div>
            <h3 className={underline}>ติดต่อเรา</h3>
            <ul className="space-y-2 text-sm text-white/75">
              <li>📞 โทร: 02-101-5587, 08-0016-1700</li>
              <li>📱 Line ID: @jnac</li>
              <li>📧 อีเมล: info@jnac.co.th, jnac.co.th@gmail.com</li>
              {org.address && <li>🏢 {org.address}</li>}
              <li>
                <a
                  href={MAP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-white/90 hover:bg-[#1696F4] hover:border-[#1696F4] hover:text-white transition"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
                  </svg>
                  ดูแผนที่ (Google Maps)
                </a>
              </li>
            </ul>
            <div className="mt-4 inline-block rounded bg-white p-[3px] shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/line-qr.jpg"
                alt="QR เพิ่มเพื่อน LINE @jnac ของ JNAC"
                width={62}
                height={59}
                loading="lazy"
                className="block h-[59px] w-[62px] object-contain"
              />
            </div>
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
