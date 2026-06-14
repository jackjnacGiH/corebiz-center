import type { Metadata } from "next";
import Link from "next/link";
import { searchProducts } from "@/lib/products";
import { getOrg } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui";
import ProductViews from "@/components/ProductViews";
import SearchBox from "@/components/SearchBox";

export const metadata: Metadata = {
  title: "ค้นหาสินค้า",
  description: "ค้นหาสินค้างานขัด ตัด เจียร เครื่องมือ และพลาสติกวิศวกรรม ด้วยชื่อหรือรหัส SKU",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = (q || "").trim();
  const [results, org] = await Promise.all([
    query ? searchProducts(query) : Promise.resolve([]),
    getOrg(),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
      <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: "ค้นหา" }]} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
        ค้นหาสินค้า
      </h1>

      <div className="mt-5 max-w-xl">
        <SearchBox variant="page" initial={query} autoFocus />
      </div>

      {query ? (
        <>
          <p className="mt-6 text-sm text-neutral-500">
            ผลการค้นหา “{query}” — พบ <span className="font-semibold text-neutral-700">{results.length}</span> รายการ
          </p>

          {results.length > 0 ? (
            <div className="mt-5">
              <ProductViews products={results} />
            </div>
          ) : (
            <div className="mt-10 rounded-xl border border-neutral-200 bg-neutral-50 p-8 text-center">
              <p className="text-neutral-700 font-medium">
                ไม่พบสินค้าที่ตรงกับ “{query}”
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                ลองใช้คำค้นที่สั้นลง หรือสะกดต่างออกไป — หรือทักแชทเพื่อให้ทีมงาน {org.business_name} ช่วยค้นหาสินค้าที่ต้องการ
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Link
                  href="/products"
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition"
                  style={{ background: "#1696F4" }}
                >
                  ดูสินค้าทั้งหมด
                </Link>
                {org.phone && (
                  <a
                    href={`tel:${org.phone.replace(/\s+/g, "")}`}
                    className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
                  >
                    โทร {org.phone}
                  </a>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-6 text-neutral-400">
          พิมพ์ชื่อสินค้า หรือรหัส SKU แล้วกด Enter เพื่อค้นหา
        </p>
      )}
    </main>
  );
}
