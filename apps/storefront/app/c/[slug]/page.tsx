import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategories, getProductsByCategory, getGroups, imagesOf, keywordsFromProducts, collectionArticle } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP, categoryUrl } from "@/lib/seo";
import CollectionArticle from "@/components/CollectionArticle";
import { effectivePrice } from "@/lib/format";
import { ProductCard, GroupCard, Breadcrumb } from "@/components/ui";
import SearchBox from "@/components/SearchBox";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const cats = await getCategories();
  return cats.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cats = await getCategories();
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) return { title: "ไม่พบหมวดหมู่" };
  const products = await getProductsByCategory(slug);
  return {
    title: `${cat.name_th} – สินค้าทั้งหมด`,
    description: `รวมสินค้าหมวด ${cat.name_th} จาก JNAC ${products.length} รายการ พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — ขอใบเสนอราคาได้ทันที`,
    keywords: keywordsFromProducts(products, [cat.name_th, cat.name_en || ""]),
    alternates: { canonical: `/shop/c/${encodeURIComponent(slug)}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cats = await getCategories();
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) notFound();
  const [products, groups, org] = await Promise.all([
    getProductsByCategory(slug),
    getGroups(),
    getOrg(),
  ]);

  // Group-card merge (scoped to this category) — same UX as the catalog page.
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
            { name: cat.name_th, url: categoryUrl(slug) },
          ]),
        )}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: cat.name_th }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
          {cat.name_th}
        </h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          รวมสินค้าหมวด {cat.name_th} จาก {org.business_name} ทั้งหมด {products.length} รายการ
          เลือกดูราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต พร้อมขอใบเสนอราคาได้ทันที
        </p>
        <div className="mt-6 max-w-xl">
          <SearchBox variant="page" />
        </div>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {entries.map((e) => e.el)}
        </div>
        {products.length === 0 && (
          <p className="mt-10 text-center text-neutral-400">ยังไม่มีสินค้าในหมวดนี้</p>
        )}

        {products.length > 0 && (
          <CollectionArticle
            title={cat.name_th}
            article={collectionArticle(cat.name_th, "category", products, org)}
            url={categoryUrl(slug)}
            orgName={org.business_name}
            logoUrl={org.logo_url}
          />
        )}
      </main>
    </>
  );
}
