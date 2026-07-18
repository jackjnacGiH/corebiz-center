import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui";
import { COMPARISONS } from "@/lib/comparisons";
import { breadcrumbLd, ld, SHOP } from "@/lib/seo";

export const metadata: Metadata = {
  title: "เปรียบเทียบวัสดุขัดและเลือกสินค้าให้ตรงงาน",
  description:
    "คู่มือเปรียบเทียบ Fiber Disc, Flap Disc, กระดาษทรายน้ำ-แห้ง, PSA, Hook & Loop และเม็ดขัด Aluminum Oxide, Zirconia, Ceramic สำหรับงานอุตสาหกรรม",
  alternates: { canonical: "/compare" },
  openGraph: {
    type: "website",
    url: "/compare",
    title: "เปรียบเทียบวัสดุขัดและเลือกสินค้า | JNAC",
    description: "คำตอบแบบ Answer-first และตารางเปรียบเทียบ ช่วยเลือกวัสดุขัดให้ตรงกับชิ้นงาน เครื่องมือ และขั้นตอนผลิต",
  },
  twitter: { card: "summary_large_image" },
};

export default function ComparisonHubPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(
          breadcrumbLd([
            { name: "หน้าแรก", url: SHOP },
            { name: "เปรียบเทียบและเลือกสินค้า", url: `${SHOP}/compare` },
          ]),
        )}
      />
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: "เปรียบเทียบและเลือกสินค้า" }]} />
        <div className="max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-wide text-[#0879BD]">Comparison Hub</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#0C3C63] sm:text-4xl">
            เปรียบเทียบวัสดุขัดและเลือกสินค้าให้ตรงงาน
          </h1>
          <p className="mt-4 text-base leading-relaxed text-neutral-700 sm:text-lg">
            เริ่มจากวัสดุชิ้นงาน เป้าหมายการขัด เครื่องมือ และความปลอดภัย แล้วใช้ตารางด้านล่างช่วยคัดประเภทสินค้า
            ข้อมูลเป็นหลักการทั่วไป ต้องยืนยันขนาด เบอร์ backing และ Max RPM จากฉลากหรือ datasheet ของรุ่นจริงก่อนใช้
          </p>
        </div>

        <section className="mt-10 grid gap-5 md:grid-cols-2" aria-label="คู่มือเปรียบเทียบทั้งหมด">
          {COMPARISONS.map((guide, index) => (
            <article key={guide.slug} className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-bold text-[#0879BD]">คู่มือ {index + 1}</div>
              <h2 className="mt-2 text-xl font-bold leading-snug text-[#0C3C63]">{guide.title}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-neutral-600">{guide.answer}</p>
              <Link
                href={`/compare/${guide.slug}`}
                className="mt-5 inline-flex min-h-11 items-center self-start rounded-lg bg-[#0879BD] px-5 py-3 font-semibold text-white transition hover:bg-[#06669f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0879BD]"
              >
                อ่านตารางเปรียบเทียบ →
              </Link>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-2xl bg-[#0C3C63] p-6 text-white sm:p-8">
          <h2 className="text-2xl font-bold">หลักเลือกวัสดุขัดแบบสั้น</h2>
          <ol className="mt-4 grid gap-3 text-white/90 sm:grid-cols-2">
            <li>1. ระบุวัสดุชิ้นงานและผิวที่ต้องการ</li>
            <li>2. แยกขั้นตอนลบเนื้อ ขัดรอย หรือเก็บผิว</li>
            <li>3. ตรวจขนาด ระบบยึด และรอบของเครื่อง</li>
            <li>4. ยืนยัน PPE, guard และ Max RPM ก่อนใช้งาน</li>
          </ol>
        </section>
      </main>
    </>
  );
}
