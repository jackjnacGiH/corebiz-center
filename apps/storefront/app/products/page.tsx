import type { Metadata } from "next";
import Link from "next/link";
import { getAllProducts, getCategories, getGroups, imagesOf } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP } from "@/lib/seo";
import { effectivePrice } from "@/lib/format";
import { ProductCard, GroupCard, Breadcrumb } from "@/components/ui";
import SearchBox from "@/components/SearchBox";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "สินค้าทั้งหมด – แคตตาล็อก JNAC",
  description:
    "แคตตาล็อกสินค้า JNAC: งานขัด ตัด เจียร, เครื่องมือช่าง (Tools) และพลาสติกวิศวกรรม พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — หยิบใส่ตะกร้าแล้วขอใบเสนอราคาได้ทันที",
  alternates: { canonical: "/shop/products" },
};

export default async function ProductsCatalog() {
  const [groups, products, categories, org] = await Promise.all([
    getGroups(),
    getAllProducts(),
    getCategories(),
    getOrg(),
  ]);

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
        dangerouslySetInnerHTML={ld(
          breadcrumbLd([
            { name: "หน้าแรก", url: SHOP },
            { name: "สินค้าทั้งหมด", url: `${SHOP}/products` },
          ]),
        )}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: "สินค้าทั้งหมด" }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
          สินค้าทั้งหมด
        </h1>
        <p className="mt-2 text-neutral-600">
          {org.business_name} — งานขัด ตัด เจียร, เครื่องมือช่าง และพลาสติกวิศวกรรม
        </p>

        <div className="mt-6 max-w-xl">
          <SearchBox variant="page" />
        </div>

        {categories.length > 0 && (
          <section className="mt-6">
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

        <section className="mt-8">
          <h2 className="text-lg font-bold text-neutral-900 mb-4">
            รายการสินค้า{" "}
            <span className="text-sm font-normal text-neutral-400">({entries.length} รายการ)</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {entries.map((e) => e.el)}
          </div>
        </section>
      </main>
    </>
  );
}
