import type { Metadata } from "next";
import { cache, cloneElement } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategories, getProductsByCategory, getGroups, imagesOf, keywordsFromProducts, collectionArticle } from "@/lib/products";
import { compactSeoTitle, getOrg, ld, itemListLd, breadcrumbLd, SHOP, categoryUrl } from "@/lib/seo";
import CollectionArticle from "@/components/CollectionArticle";
import { effectivePrice } from "@/lib/format";
import { ProductCard, GroupCard, Breadcrumb } from "@/components/ui";
import SearchBox from "@/components/SearchBox";

// searchParams pagination is request-specific, not an ISR fallback shell.
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const readCategories = cache(getCategories);
const readCategoryProducts = cache(getProductsByCategory);

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const page = pageNumber(query.page);
  const cats = await readCategories();
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) return { title: "ไม่พบหมวดหมู่" };
  const products = await readCategoryProducts(slug);
  return {
    title: compactSeoTitle(`${cat.name_th} – สินค้า${page > 1 ? ` หน้า ${page}` : ""}`),
    description: `รวมสินค้าหมวด ${cat.name_th} จาก JNAC ${products.length} รายการ พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — ขอใบเสนอราคาได้ทันที`,
    keywords: keywordsFromProducts(products, [cat.name_th, cat.name_en || ""]),
    alternates: { canonical: `/c/${encodeURIComponent(slug)}${page > 1 ? `?page=${page}` : ""}` },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const currentPage = pageNumber(query.page);
  const cats = await readCategories();
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) notFound();
  const [products, groups, org] = await Promise.all([
    readCategoryProducts(slug),
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

  const entries: { key: string; sort: string; el: React.ReactElement<{ priority?: boolean }> }[] = [
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
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  if (currentPage > pageCount) notFound();
  const visibleEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
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
          {visibleEntries.map((entry, index) => cloneElement(entry.el, { priority: index < 5 }))}
        </div>
        {pageCount > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label="หน้ารายการสินค้า">
            {currentPage > 1 ? (
              <Link
                href={`/c/${encodeURIComponent(slug)}${currentPage === 2 ? "" : `?page=${currentPage - 1}`}`}
                className="rounded-full border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:border-[#0879BD] hover:text-[#0879BD]"
              >
                ← หน้าก่อน
              </Link>
            ) : <span />}
            <span className="text-sm text-neutral-500">หน้า {currentPage} จาก {pageCount}</span>
            {currentPage < pageCount ? (
              <Link
                href={`/c/${encodeURIComponent(slug)}?page=${currentPage + 1}`}
                className="rounded-full border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:border-[#0879BD] hover:text-[#0879BD]"
              >
                หน้าถัดไป →
              </Link>
            ) : <span />}
          </nav>
        )}
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
