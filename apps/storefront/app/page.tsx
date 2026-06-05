import type { Metadata } from "next";
import Link from "next/link";
import { getAllProducts, getCategories } from "@/lib/products";
import { getOrg, ld, itemListLd, breadcrumbLd, SHOP } from "@/lib/seo";
import { ProductCard } from "@/components/ui";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "วัสดุงานขัด เจียร ตัด ขัดเงา – แคตตาล็อกสินค้า JNAC",
  description:
    "แคตตาล็อกสินค้า JNAC ครบทุกหมวด: กระดาษทราย จานทราย ล้อขัด ใบตัด เครื่องมือลม พร้อมราคา สเปก และสถานะพร้อมส่ง/สั่งผลิต — สอบถามหรือขอใบเสนอราคาได้ทันที",
  alternates: { canonical: "/shop" },
};

export default async function Home() {
  const [products, categories, org] = await Promise.all([
    getAllProducts(),
    getCategories(),
    getOrg(),
  ]);

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
            วัสดุและอุปกรณ์งานขัด เจียร ตัด ขัดเงา โดย {org.business_name}
          </h1>
          <p className="mt-4 max-w-3xl text-neutral-600 leading-relaxed">
            {org.business_name} (JNAC) คือผู้จำหน่ายวัสดุงานขัดและเครื่องมือลมสำหรับงานอุตสาหกรรมแบบครบวงจร
            ทั้งกระดาษทราย จานทราย ล้อขัดใยสังเคราะห์ ใบตัด และอุปกรณ์เซฟตี้ จาก {products.length}+ รายการสินค้า
            พร้อมราคาและสเปกที่ชัดเจน เลือกดูสินค้า เช็กสถานะพร้อมส่ง/สั่งผลิต และขอใบเสนอราคากับทีมงานได้ทันที
          </p>
        </section>

        {/* Categories */}
        {categories.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-3">เลือกตามหมวดหมู่</h2>
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

        {/* All products */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-neutral-900 mb-4">
            สินค้าทั้งหมด <span className="text-sm font-normal text-neutral-400">({products.length} รายการ)</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
