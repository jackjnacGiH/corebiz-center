import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getProductBySku,
  getAllSkus,
  imagesOf,
  answerSummary,
  featuresOf,
  specRows,
  faqOf,
} from "@/lib/products";
import {
  getOrg,
  ld,
  productLd,
  faqLd,
  breadcrumbLd,
  productUrl,
  categoryUrl,
  groupUrl,
  SHOP,
} from "@/lib/seo";
import { effectivePrice, formatTHB } from "@/lib/format";
import { Breadcrumb, StockBadge, CtaButtons } from "@/components/ui";

export const revalidate = 3600;
export const dynamicParams = true;

const BRAND = "#1696F4";

export async function generateStaticParams() {
  const skus = await getAllSkus();
  return skus.map((sku) => ({ sku }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku } = await params;
  const p = await getProductBySku(decodeURIComponent(sku));
  if (!p) return { title: "ไม่พบสินค้า" };
  const org = await getOrg();
  const desc = answerSummary(p, org.business_name).slice(0, 155);
  const title = `${p.name_th}${p.brand ? ` (${p.brand})` : ""} ราคา ${formatTHB(effectivePrice(p))}`;
  const imgs = imagesOf(p);
  return {
    title,
    description: desc,
    alternates: { canonical: `/shop/p/${encodeURIComponent(p.sku)}` },
    openGraph: {
      title,
      description: desc,
      url: productUrl(p.sku),
      type: "website",
      images: imgs.slice(0, 1),
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const p = await getProductBySku(decodeURIComponent(sku));
  if (!p) notFound();
  const org = await getOrg();

  const imgs = imagesOf(p);
  const summary = answerSummary(p, org.business_name);
  const features = featuresOf(p);
  const specs = specRows(p);
  const faqs = faqOf(p, org);

  // Prefer the product group for the breadcrumb (matches the shop's group-first
  // navigation), falling back to the category.
  const parent =
    p.group_id && p.group_name
      ? { name: p.group_name, href: `/g/${p.group_id}`, url: groupUrl(p.group_id) }
      : p.category_slug && p.category_name_th
        ? { name: p.category_name_th, href: `/c/${p.category_slug}`, url: categoryUrl(p.category_slug) }
        : null;

  const crumbItems = [
    { name: "หน้าแรก", href: "/" },
    ...(parent ? [{ name: parent.name, href: parent.href }] : []),
    { name: p.name_th },
  ];
  const crumbLdItems = [
    { name: "หน้าแรก", url: SHOP },
    ...(parent ? [{ name: parent.name, url: parent.url }] : []),
    { name: p.name_th, url: productUrl(p.sku) },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(productLd(p, org))} />
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(faqLd(faqs))} />
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(breadcrumbLd(crumbLdItems))} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={crumbItems} />

        <div className="lg:grid lg:grid-cols-2 lg:gap-x-12 xl:gap-x-16">
          {/* Images */}
          <div className="flex flex-col gap-4">
            <div className="aspect-square bg-white rounded-2xl border border-neutral-200 overflow-hidden flex items-center justify-center relative">
              {imgs[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgs[0]} alt={p.name_th} className="object-contain w-full h-full p-8" />
              ) : (
                <span className="text-neutral-300">ไม่มีรูปสินค้า</span>
              )}
              <span className="absolute top-4 left-4">
                <StockBadge inStock={p.in_stock} />
              </span>
            </div>
            {imgs.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {imgs.slice(0, 4).map((src, i) => (
                  <div
                    key={i}
                    className="aspect-square bg-white rounded-lg border border-neutral-200 p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`${p.name_th} รูปที่ ${i + 1}`} className="w-full h-full object-contain" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="mt-10 lg:mt-0">
            <div className="text-xs text-neutral-400 font-mono mb-2">SKU: {p.sku}</div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
              {p.name_th}
            </h1>
            {p.name_en && <p className="mt-1 text-sm text-neutral-500">{p.name_en}</p>}

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-3xl font-extrabold" style={{ color: BRAND }}>
                {formatTHB(effectivePrice(p))}
              </span>
              {effectivePrice(p) < Number(p.price || 0) && (
                <span className="text-lg text-neutral-400 line-through">
                  {formatTHB(Number(p.price))}
                </span>
              )}
              {p.unit && <span className="text-sm text-neutral-400">/ {p.unit}</span>}
            </div>
            <p className="mt-1 text-xs text-neutral-400">ยังไม่รวมภาษีมูลค่าเพิ่ม 7%</p>

            {/* Answer-first (AEO) */}
            <div
              className="mt-6 border-l-4 pl-4 py-3 pr-4 rounded-r-lg"
              style={{ borderColor: BRAND, background: "rgba(22,150,244,0.06)" }}
            >
              <h2 className="text-sm font-bold text-neutral-900 mb-1">{p.name_th} คืออะไร?</h2>
              <p className="text-sm text-neutral-700 leading-relaxed">{summary}</p>
            </div>

            <div className="mt-8">
              <CtaButtons org={org} />
            </div>

            {features.length > 0 && (
              <div className="mt-10 border-t border-neutral-200 pt-8">
                <h2 className="text-lg font-bold text-neutral-900 mb-4">จุดเด่นที่สำคัญ (Key Features)</h2>
                <ul className="space-y-3 text-sm text-neutral-600">
                  {features.map((f, i) => (
                    <li key={i} className="flex gap-3">
                      <svg
                        className="h-5 w-5 flex-shrink-0"
                        style={{ color: BRAND }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Specs table (AEO: tables are highly extractable) */}
        <section className="mt-16">
          <h2 className="text-2xl font-bold text-neutral-900 mb-6">
            ข้อมูลจำเพาะ (Technical Specifications)
          </h2>
          <div className="overflow-hidden bg-white border border-neutral-200 rounded-xl">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <tbody className="divide-y divide-neutral-200">
                {specs.map(([k, v], i) => (
                  <tr key={i}>
                    <td className="py-3.5 px-6 font-medium text-neutral-900 bg-neutral-50 w-1/3 align-top">
                      {k}
                    </td>
                    <td className="py-3.5 px-6 text-neutral-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ (AEO: FAQPage schema) */}
        <section className="mt-16">
          <h2 className="text-2xl font-bold text-neutral-900 mb-6">คำถามที่พบบ่อย (FAQ)</h2>
          <div className="space-y-4">
            {faqs.map((f, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 bg-white p-5">
                <h3 className="font-semibold text-neutral-900">{f.q}</h3>
                <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
