import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroups, getGroupById, getProductsByGroup, keywordsFromProducts, collectionArticle } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP, groupUrl } from "@/lib/seo";
import CollectionArticle from "@/components/CollectionArticle";
import { Breadcrumb } from "@/components/ui";
import ProductViews from "@/components/ProductViews";
import SearchBox from "@/components/SearchBox";
import { getGroupCrossSiteGuide } from "@/lib/crossSiteGuides";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const groups = await getGroups();
  return groups.map((g) => ({ id: g.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const group = await getGroupById(decodeURIComponent(id));
  if (!group) return { title: "ไม่พบกลุ่มสินค้า" };
  const products = await getProductsByGroup(group.id);
  const desc =
    (group.description && group.description.trim()) ||
    `รวมสินค้ากลุ่ม ${group.name} จาก JNAC ${products.length} รายการ พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — ขอใบเสนอราคาได้ทันที`;
  return {
    title: `${group.name} – สินค้าทั้งหมดในกลุ่ม`,
    description: desc.slice(0, 155),
    keywords: keywordsFromProducts(products, [group.name]),
    alternates: { canonical: `/g/${encodeURIComponent(group.id)}` },
  };
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await getGroupById(decodeURIComponent(id));
  if (!group) notFound();
  const [products, org] = await Promise.all([getProductsByGroup(group.id), getOrg()]);
  const crossSiteGuide = getGroupCrossSiteGuide(group.id);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(itemListLd(products))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(
          breadcrumbLd([
            { name: "หน้าแรก", url: SHOP },
            { name: group.name, url: groupUrl(group.id) },
          ]),
        )}
      />
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: group.name }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
          {group.name}
        </h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          {group.description && group.description.trim()
            ? group.description
            : `รวมสินค้ากลุ่ม ${group.name} จาก ${org.business_name} ทั้งหมด ${products.length} รายการ เลือกดูราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต พร้อมขอใบเสนอราคาได้ทันที`}
        </p>
        {crossSiteGuide && (
          <section
            className="mt-6 max-w-5xl rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm sm:p-6"
            aria-labelledby="cross-site-guide-title"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-wide text-[#0879BD]">
                  {crossSiteGuide.eyebrow}
                </p>
                <h2
                  id="cross-site-guide-title"
                  className="mt-2 text-xl font-bold leading-snug text-[#0C3C63] sm:text-2xl"
                >
                  {crossSiteGuide.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700 sm:text-base">
                  {crossSiteGuide.description}
                </p>
              </div>
              <Link
                href={crossSiteGuide.href}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0C3C63] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#082F4D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0879BD]"
              >
                {crossSiteGuide.cta}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </section>
        )}
        <div className="mt-6 max-w-xl">
          <SearchBox variant="page" />
        </div>
        {products.length > 0 && (
          <div className="mt-8">
            <ProductViews products={products} />
          </div>
        )}
        {products.length === 0 && (
          <p className="mt-10 text-center text-neutral-400">ยังไม่มีสินค้าในกลุ่มนี้</p>
        )}

        {products.length > 0 && (
          <CollectionArticle
            title={group.name}
            article={collectionArticle(group.name, "group", products, org)}
            url={groupUrl(group.id)}
            orgName={org.business_name}
            logoUrl={org.logo_url}
          />
        )}
      </main>
    </>
  );
}
