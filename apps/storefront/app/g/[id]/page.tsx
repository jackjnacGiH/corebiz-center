import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGroups, getGroupById, getProductsByGroup, keywordsFromProducts, collectionArticle } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP, groupUrl } from "@/lib/seo";
import CollectionArticle from "@/components/CollectionArticle";
import { Breadcrumb } from "@/components/ui";
import ProductViews from "@/components/ProductViews";
import SearchBox from "@/components/SearchBox";

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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: group.name }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
          {group.name}
        </h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          {group.description && group.description.trim()
            ? group.description
            : `รวมสินค้ากลุ่ม ${group.name} จาก ${org.business_name} ทั้งหมด ${products.length} รายการ เลือกดูราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต พร้อมขอใบเสนอราคาได้ทันที`}
        </p>
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
