import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCategories, getProductsByCategory } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP, categoryUrl } from "@/lib/seo";
import { ProductCard, Breadcrumb } from "@/components/ui";

export const revalidate = 3600;
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
    alternates: { canonical: `/shop/c/${encodeURIComponent(slug)}` },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cats = await getCategories();
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) notFound();
  const [products, org] = await Promise.all([getProductsByCategory(slug), getOrg()]);

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
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
        {products.length === 0 && (
          <p className="mt-10 text-center text-neutral-400">ยังไม่มีสินค้าในหมวดนี้</p>
        )}
      </main>
    </>
  );
}
