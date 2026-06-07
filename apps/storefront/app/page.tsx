import type { Metadata } from "next";
import Link from "next/link";
import { getOrg, SITE } from "@/lib/seo";
import OpenChatButton from "@/components/OpenChatButton";

export const revalidate = 300;

const NAVY = "#0C3C63";
const BRAND = "#1696F4";

export const metadata: Metadata = {
  title: "ศูนย์รวมสินค้าอุตสาหกรรม ขัด ตัด เจียร · Tool · พลาสติกวิศวกรรม · CNC",
  description:
    "J NAC (Thailand) จำหน่ายสินค้าอุตสาหกรรม เครื่องมือ Tool พลาสติกวิศวกรรม และบริการงาน CNC ครบวงจร — งานกลึง กัด โมลด์ จิ๊ก ฟิกซ์เจอร์ ชิ้นส่วนเครื่องจักรและอะไหล่แต่งตามสั่ง",
  alternates: { canonical: "/shop" },
};

const FEATURES: [string, string, string][] = [
  ["⚙️", "คุณภาพระดับ Industrial Grade", "สินค้าทุกชิ้นออกแบบมาให้ทนแรงกดและรอบสูง (RPM) ไม่ฉีกขาดง่าย ปลอดภัยต่อช่างผู้ใช้งาน"],
  ["⏱️", "ขัดเร็ว ประหยัดเวลาทำงาน", "เม็ดทรายมีความคมสูง ช่วยลดเวลาในการขัด/ตัด เพิ่มปริมาณงานต่อชั่วโมงได้อย่างชัดเจน"],
  ["💡", "ให้คำปรึกษาเชิงเทคนิค (AIO)", "มีศูนย์ความรู้และผู้เชี่ยวชาญพร้อมแนะนำเครื่องมือให้ตรงกับเนื้อวัสดุของคุณ"],
  ["📦", "สต็อกพร้อมส่ง สำหรับโรงงาน", "สินค้าครบวงจร มีของพร้อมส่งทันที รองรับการสั่งซื้อจำนวนมากสำหรับสายการผลิต"],
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
    <>
      {/* Hero */}
      <section className="relative min-h-[78vh] flex items-center text-white overflow-hidden" style={{ backgroundColor: NAVY }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(12,60,99,0.95) 0%, rgba(12,60,99,0.62) 50%, rgba(0,0,0,0.15) 100%), url('/shop/hero.png')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
              ศูนย์รวมสินค้าอุตสาหกรรม
              <br />
              <span style={{ color: "#54B8FF" }}>ขัด ตัด เจียร</span>
              <br />
              Tool, พลาสติกวิศวกรรม และ CNC
            </h1>
            <p className="mt-5 text-base sm:text-lg text-white/85 font-light max-w-xl leading-relaxed">
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
            ทำไมโรงงานชั้นนำถึงเลือก J NAC?
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
    </>
  );
}
