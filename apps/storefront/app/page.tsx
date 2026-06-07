import type { Metadata } from "next";
import Link from "next/link";
import { getAllProducts, getCategories, getGroups, imagesOf } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP } from "@/lib/seo";
import { effectivePrice } from "@/lib/format";
import { ProductCard, GroupCard } from "@/components/ui";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "วัสดุงานขัด เจียร ตัด ขัดเงา – แคตตาล็อกสินค้า JNAC",
  description:
    "แคตตาล็อกสินค้า JNAC: งานขัด ตัด เจียร, เครื่องมือช่าง (Tools) และพลาสติกวิศวกรรม พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — สอบถามหรือขอใบเสนอราคาได้ทันที",
  alternates: { canonical: "/shop" },
};

export default async function Home() {
  const [groups, products, categories, org] = await Promise.all([
    getGroups(),
    getAllProducts(),
    getCategories(),
    getOrg(),
  ]);

  // Count active products per group + pick a cover fallback from the first
  // product image when the group has no cover_image set.
  const counts = new Map<string, number>();
  const coverFallback = new Map<string, string>();
  const priceMin = new Map<string, number>();
  const priceMax = new Map<string, number>();
  const anyStock = new Map<string, boolean>();
  for (const p of products) {
    if (!p.group_id) continue;
    counts.set(p.group_id, (counts.get(p.group_id) ?? 0) + 1);
    if (!coverFallback.has(p.group_id)) {
      const img = imagesOf(p)[0];
      if (img) coverFallback.set(p.group_id, img);
    }
    const eff = effectivePrice(p);
    priceMin.set(p.group_id, Math.min(priceMin.get(p.group_id) ?? Infinity, eff));
    priceMax.set(p.group_id, Math.max(priceMax.get(p.group_id) ?? -Infinity, eff));
    anyStock.set(p.group_id, (anyStock.get(p.group_id) ?? false) || p.in_stock);
  }
  const visibleGroups = groups.filter((g) => (counts.get(g.id) ?? 0) > 0);
  const ungrouped = products.filter((p) => !p.group_id);

  // Merge group cards + standalone product cards into one list, sorted by Thai
  // name — a card is either a whole group (drills in) or a single product.
  const entries: { key: string; sort: string; el: React.ReactNode }[] = [
    ...visibleGroups.map((g) => ({
      key: `g-${g.id}`,
      sort: g.name,
      el: (
        <GroupCard
          key={`g-${g.id}`}
          id={g.id}
          name={g.name}
          cover={g.cover_image || coverFallback.get(g.id) || null}
          count={counts.get(g.id) ?? 0}
          priceMin={priceMin.get(g.id) ?? null}
          priceMax={priceMax.get(g.id) ?? null}
          inStock={anyStock.get(g.id) ?? false}
        />
      ),
    })),
    ...ungrouped.map((p) => ({
      key: `p-${p.id}`,
      sort: p.name_th,
      el: <ProductCard key={`p-${p.id}`} p={p} />,
    })),
  ];
  entries.sort((a, b) => a.sort.localeCompare(b.sort, "th"));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(itemListLd(products))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(breadcrumbLd([{ name: "หน้าแรก", url: SHOP }]))}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Hero — Answer-First (AEO) */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-10">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-neutral-900">
            วัสดุงานขัด ตัด เจียร · เครื่องมือช่าง · พลาสติกวิศวกรรม โดย {org.business_name}
          </h1>
          <p className="mt-4 max-w-3xl text-neutral-600 leading-relaxed">
            {org.business_name} (JNAC) ผู้จำหน่ายวัสดุและอุปกรณ์อุตสาหกรรมครบวงจร ครอบคลุม 3 กลุ่มหลัก:
            งานขัด ตัด เจียร (กระดาษทราย จานทราย ล้อขัด ใบตัด ใบเจียร), เครื่องมือช่าง (Tools) และพลาสติกวิศวกรรม
            จาก {products.length}+ รายการสินค้า — เลือกดูตามกลุ่มสินค้า เช็กราคาและสถานะพร้อมส่ง/สั่งผลิต และขอใบเสนอราคากับทีมงานได้ทันที
          </p>
        </section>

        {/* Category quick filter */}
        {categories.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-3">หมวดหมู่</h2>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/c/${c.slug}`}
                  className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:border-[#1696F4] hover:text-[#1696F4] transition"
                >
                  {c.name_th}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* One merged catalog grid: group cards + standalone product cards,
            sorted alphabetically — like the admin Industrial Product Catalog. */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-neutral-900 mb-4">
            สินค้าทั้งหมด{" "}
            <span className="text-sm font-normal text-neutral-400">
              ({entries.length} รายการ)
            </span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {entries.map((e) => e.el)}
          </div>
        </section>
      </main>
    </>
  );
}
