import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getOrg, SITE } from "@/lib/seo";
import OpenChatButton from "@/components/OpenChatButton";

export const revalidate = 300;

const NAVY = "#0C3C63";
const BRAND = "#0879BD";

export const metadata: Metadata = {
  title: "ศูนย์รวมสินค้าอุตสาหกรรม ขัด ตัด เจียร · Tool · พลาสติกวิศวกรรม · CNC",
  description:
    "J NAC (Thailand) จำหน่ายสินค้าอุตสาหกรรม เครื่องมือ Tool พลาสติกวิศวกรรม และบริการงาน CNC ครบวงจร — งานกลึง กัด โมลด์ จิ๊ก ฟิกซ์เจอร์ ชิ้นส่วนเครื่องจักรและอะไหล่แต่งตามสั่ง",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "JNAC ศูนย์รวมสินค้าอุตสาหกรรม ขัด ตัด เจียร และ CNC",
    description:
      "สินค้าอุตสาหกรรม เครื่องมือ Tool พลาสติกวิศวกรรม และบริการ CNC จาก J NAC (Thailand) พร้อมข้อมูลช่วยเลือกสินค้าและขอใบเสนอราคา",
  },
};

const FEATURES: [string, string, string][] = [
  ["⚙️", "เลือกจากสเปกที่ตรงกับงาน", "ตรวจชนิดวัสดุ ขนาด เบอร์ ระบบยึด และความเร็วรอบจากข้อมูลสินค้าก่อนตัดสินใจ"],
  ["⏱️", "ลดการลองผิดประเภท", "ใช้หมวดสินค้าและคู่มือเปรียบเทียบช่วยแยกงานลบเนื้อ ขัดรอย และเก็บผิวให้ชัดเจน"],
  ["💡", "ข้อมูลและคำปรึกษาเชิงเทคนิค", "มีศูนย์ความรู้และช่องทางสอบถามเพื่อช่วยคัดตัวเลือกให้ตรงกับวัสดุชิ้นงานและเครื่องมือ"],
  ["📦", "ตรวจสถานะก่อนสั่งซื้อ", "ดูสถานะพร้อมขายหรือสั่งผลิตจากรายการสินค้า แล้วส่งคำขอใบเสนอราคาเพื่อยืนยันรายละเอียด"],
];

const CATS: { icon: string; color: string; title: string; desc: string; href: string; external?: boolean }[] = [
  { icon: "🔥", color: "#fca5a5", title: "ขัด ตัด เจียร", desc: "กระดาษทราย ใบตัด ใบเจียร ล้อทราย ใยขัด หินขัด ลูกขัด และวัสดุสิ้นเปลืองสำหรับงานอุตสาหกรรม", href: "/c/abrasives" },
  { icon: "⚙️", color: "#93c5fd", title: "เครื่องมือ Tool", desc: "เครื่องมือช่าง เครื่องมือโรงงาน อุปกรณ์ฮาร์ดแวร์ และ Tool สำหรับงานผลิต ซ่อมบำรุง และงานหน้างาน", href: "/c/tools" },
  { icon: "🛠️", color: "#fdba74", title: "พลาสติกวิศวกรรม", desc: "วัสดุพลาสติกวิศวกรรมสำหรับงานอุตสาหกรรม งานเครื่องจักร งานรับแรงเสียดทาน และชิ้นส่วนเฉพาะทาง", href: "/c/engineering-plastics" },
  { icon: "✨", color: "#86efac", title: "บริการงาน CNC ครบวงจร", desc: "รับผลิตงานกลึง กัด โมลด์ จิ๊ก ฟิกซ์เจอร์ ชิ้นส่วนเครื่องจักร และอะไหล่แต่งตามสั่ง", href: `${SITE}/widget`, external: true },
];

export default async function Home() {
  const org = await getOrg();

  return (
    <main id="main-content">
      {/* Hero */}
      <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden py-16 text-white sm:min-h-[680px] lg:min-h-[720px]" style={{ backgroundColor: NAVY }}>
        <Image
          src="/hero.png"
          alt="ภาพประกอบงานขัดและเจียรในโรงงานอุตสาหกรรม"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,31,53,0.97)_0%,rgba(12,60,99,0.86)_55%,rgba(0,0,0,0.35)_100%)]" />
        <span className="absolute bottom-3 right-3 z-10 rounded bg-black/60 px-2 py-1 text-xs text-white/90">
          ภาพประกอบ
        </span>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
              ศูนย์รวมสินค้าอุตสาหกรรม
              <br />
              <span style={{ color: "#54B8FF" }}>ขัด ตัด เจียร</span>
              <br />
              Tool, พลาสติกวิศวกรรม และ CNC
            </h1>
            <p className="mt-5 max-w-xl text-base font-light leading-relaxed text-white/90 sm:text-lg">
              {org.business_name} จำหน่ายสินค้าอุตสาหกรรม เครื่องมือ Tool พลาสติกวิศวกรรม และบริการงาน CNC ครบวงจร
              ตั้งแต่งานกลึง กัด โมลด์ จิ๊ก ฟิกซ์เจอร์ ไปจนถึงชิ้นส่วนเครื่องจักรและอะไหล่แต่งตามสั่ง
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href="/products"
                className="text-center rounded-full px-8 py-3.5 font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
                style={{ background: BRAND, boxShadow: "0 8px 24px rgba(22,150,244,0.4)" }}
              >
                ดูแคตตาล็อกสินค้า
              </Link>
              <OpenChatButton
                className="text-center rounded-full px-8 py-3.5 font-semibold border-2 border-white text-white hover:bg-white transition hover:text-[#0C3C63]"
              >
                ปรึกษาผู้เชี่ยวชาญ
              </OpenChatButton>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-14 sm:px-6 sm:py-16 lg:px-8" aria-labelledby="compare-heading">
        <div className="mx-auto max-w-5xl rounded-3xl border border-sky-100 bg-sky-50 p-6 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-wide text-[#06669F]">คู่มือเลือกสินค้า</p>
          <h2 id="compare-heading" className="mt-2 text-2xl font-extrabold text-[#0C3C63] sm:text-3xl">
            เปรียบเทียบวัสดุขัดก่อนเลือกซื้อ
          </h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-neutral-700">
            ดูความต่างของ Fiber Disc, Flap Disc, กระดาษทรายน้ำ-แห้ง, PSA, Hook &amp; Loop และชนิดเม็ดขัด
            แบบ Answer-first เพื่อเลือกให้เหมาะกับวัสดุชิ้นงานและขั้นตอนการผลิต
          </p>
          <Link
            href="/compare"
            className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#0879BD] px-6 py-3 font-semibold text-white transition hover:bg-[#06669f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0879BD]"
          >
            ดูคู่มือเปรียบเทียบทั้งหมด →
          </Link>
        </div>
      </section>

      {/* About + Features */}
      <section className="relative z-10 bg-white -mt-8 rounded-t-[28px] px-4 sm:px-6 lg:px-8 py-14 sm:py-16 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-center text-2xl sm:text-3xl font-extrabold" style={{ color: NAVY }}>
            เกี่ยวกับ {org.business_name}
          </h2>
          <p className="mt-4 text-center text-neutral-600 max-w-3xl mx-auto leading-loose">
            <strong>{org.business_name}</strong> เป็นผู้นำเข้าและจัดจำหน่ายสินค้าอุตสาหกรรมแบบครบวงจร ครอบคลุมงาน{" "}
            <strong>ขัด ตัด เจียร</strong> เครื่องมือ <strong>Tool</strong> พลาสติกวิศวกรรม และบริการงาน <strong>CNC</strong> ครบวงจร
            เช่น กลึง กัด โมลด์ จิ๊ก ฟิกซ์เจอร์ ชิ้นส่วนเครื่องจักร และอะไหล่แต่งตามสั่ง เพื่อช่วยให้โรงงานและช่างทำงานได้แม่นยำ
            ประหยัดเวลา และคุมมาตรฐานได้จริง
          </p>

          <h3 className="text-center mt-12 mb-8 text-xl sm:text-2xl font-bold" style={{ color: NAVY }}>
            เลือกสินค้าให้ตรงงานกับ JNAC
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(([icon, title, desc]) => (
              <div
                key={title}
                className="text-center p-6 sm:p-7 rounded-2xl bg-neutral-50 border-b-4 border-transparent hover:border-[#1696F4] hover:bg-white hover:shadow-xl hover:-translate-y-2 transition"
              >
                <div className="text-4xl mb-4">{icon}</div>
                <h4 className="font-bold mb-2" style={{ color: NAVY }}>{title}</h4>
                <p className="text-sm text-neutral-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product categories */}
      <section className="bg-neutral-50 px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-center text-2xl sm:text-3xl font-extrabold" style={{ color: NAVY }}>
            หมวดหมู่สินค้าหลัก
          </h2>
          <p className="mt-3 text-center text-neutral-600">
            ครอบคลุมสินค้าโรงงาน เครื่องมือ วัสดุวิศวกรรม และบริการผลิตชิ้นงานตามสั่ง
          </p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CATS.map((c) => {
              const inner = (
                <>
                  <div className="h-44 grid place-items-center text-5xl" style={{ backgroundColor: c.color }}>
                    {c.icon}
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-bold" style={{ color: NAVY }}>{c.title}</h3>
                    <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{c.desc}</p>
                    <span className="mt-4 inline-block font-semibold" style={{ color: BRAND }}>
                      ดูสินค้าทั้งหมด →
                    </span>
                  </div>
                </>
              );
              const cls =
                "block bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition";
              return c.external ? (
                <a key={c.title} href={c.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {inner}
                </a>
              ) : (
                <Link key={c.title} href={c.href} className={cls}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
