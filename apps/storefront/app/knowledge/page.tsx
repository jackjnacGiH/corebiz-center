import type { Metadata } from "next";
import Link from "next/link";
import { getOrg, ld, faqLd, SHOP, breadcrumbLd } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui";
import OpenChatButton from "@/components/OpenChatButton";

export const revalidate = 3600;

const NAVY = "#0C3C63";
const BRAND = "#1696F4";

export const metadata: Metadata = {
  title: "ศูนย์ความรู้ (AIO) — เลือกใช้วัสดุงานขัด ตัด เจียร ให้ถูกงาน | JNAC",
  description:
    "ศูนย์ความรู้ JNAC: วิธีเลือกเบอร์กระดาษทราย/จานทราย, ขัดสแตนเลส, ความเร็วรอบ (RPM) ที่ปลอดภัย, งานไม้/โลหะ และคำถามที่พบบ่อย พร้อมผู้ช่วย AI ‘เอย’ ตอบทันที",
  alternates: { canonical: "/shop/knowledge" },
};

const KB: { q: string; a: string }[] = [
  {
    q: "เลือกเบอร์ (#) ของกระดาษทราย/จานทรายอย่างไร?",
    a: "ตัวเลขหลัง # คือความละเอียดของเม็ดทราย — เบอร์ยิ่งน้อย (เช่น #40–#80) ยิ่งหยาบ ลอก/ขัดออกเร็ว เหมาะลบครีบหรือลอกผิวเก่า ส่วนเบอร์ยิ่งมาก (เช่น #240–#600) ยิ่งละเอียด เหมาะเก็บผิวให้เนียนก่อนทำสี/ขัดเงา โดยทั่วไปไล่จากเบอร์หยาบไปเบอร์ละเอียดทีละสเต็ป",
  },
  {
    q: "ขัดสแตนเลสควรใช้อะไร และต้องระวังอะไร?",
    a: "งานสแตนเลสนิยมใช้ใยขัดสังเคราะห์ (สก๊อตไบร์ท) และจานทราย/ล้อขัดสำหรับสร้างลายเส้นแฮร์ไลน์ ควรคุมความร้อนไม่ให้ชิ้นงานไหม้ (อย่ากดแรง/รอบสูงเกิน) และเลือกวัสดุที่ไม่ปนเปื้อนเหล็กเพื่อกันสนิม",
  },
  {
    q: "ความเร็วรอบสูงสุด (Max Speed / RPM) สำคัญอย่างไร?",
    a: "ทุกสินค้ามีค่ารอบสูงสุดกำกับไว้ — ห้ามใช้เกินค่าที่ระบุเพื่อความปลอดภัย เพราะการใช้รอบเกินกำหนดอาจทำให้จาน/ล้อแตกหรือฉีกขาดได้ ตรวจสอบ RPM ของเครื่องมือให้สัมพันธ์กับสินค้าเสมอ",
  },
  {
    q: "งานไม้กับงานโลหะ ใช้วัสดุขัดต่างกันไหม?",
    a: "ต่างกันที่ชนิดเม็ดทราย (Grain) และโครงสร้าง — งานโลหะ/สเตนเลสมักใช้ Aluminium Oxide/Zirconia ที่ทนความร้อน ส่วนงานไม้/สี ใช้เม็ดทรายที่ตัดเนื้อนุ่มและไม่อุดตันง่าย หากไม่แน่ใจ สอบถามทีมงานเพื่อเลือกให้ตรงเนื้อวัสดุ",
  },
  {
    q: "เลือกเครื่องมือ (Tool) และพลาสติกวิศวกรรมอย่างไร?",
    a: "เลือกตามลักษณะงาน วัสดุชิ้นงาน และสภาพการใช้งาน (แรง/ความร้อน/การเสียดสี) ทีมงาน JNAC มีผู้เชี่ยวชาญช่วยแนะนำสเปกให้เหมาะกับสายการผลิตและงบประมาณของคุณ",
  },
  {
    q: "สั่งซื้อและขอใบเสนอราคาอย่างไร?",
    a: "เลือกสินค้าจากหน้าแคตตาล็อก หยิบใส่ตะกร้า แล้วส่งคำขอใบเสนอราคาพร้อมข้อมูลติดต่อ ทีมงานจะติดต่อกลับเพื่อยืนยันราคาและการจัดส่ง (จัดส่งทั่วประเทศ และมีราคาขายส่งสำหรับจำนวนมาก)",
  },
];

export default async function Knowledge() {
  const org = await getOrg();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(faqLd(KB))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(breadcrumbLd([{ name: "หน้าแรก", url: SHOP }, { name: "ศูนย์ความรู้ (AIO)", url: `${SHOP}/knowledge` }]))}
      />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: "ศูนย์ความรู้ (AIO)" }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold" style={{ color: NAVY }}>ศูนย์ความรู้ (AIO)</h1>
        <p className="mt-3 text-neutral-600 leading-relaxed">
          คลังความรู้สำหรับเลือกใช้วัสดุงานขัด ตัด เจียร เครื่องมือ และพลาสติกวิศวกรรมให้ถูกกับงาน
          มีคำถามเพิ่มเติม ถามผู้ช่วย AI “เอย” ของ {org.business_name} ได้ทันที
        </p>

        {/* Ask the AI */}
        <div className="mt-6 rounded-2xl p-5 sm:p-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ background: NAVY }}>
          <div>
            <div className="font-bold text-lg">ถามผู้ช่วย AI “เอย”</div>
            <p className="text-sm text-white/80 mt-1">สอบถามสินค้า การเลือกใช้ ราคา และสต็อก ได้ตลอด 24 ชม.</p>
          </div>
          <OpenChatButton className="text-center rounded-full px-7 py-3 font-semibold text-white flex-shrink-0" style={{ background: BRAND }}>
            เริ่มแชทกับเอย
          </OpenChatButton>
        </div>
        <p className="mt-2 text-xs text-neutral-400">หรือกดปุ่มแชทมุมขวาล่างของหน้าจอได้ทุกหน้า</p>

        {/* Knowledge / FAQ */}
        <h2 className="mt-10 text-xl font-bold" style={{ color: NAVY }}>ความรู้ &amp; คำถามที่พบบ่อย</h2>
        <div className="mt-4 space-y-3">
          {KB.map((f, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 bg-white p-5">
              <h3 className="font-semibold" style={{ color: NAVY }}>{f.q}</h3>
              <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
