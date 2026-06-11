import type { Metadata } from "next";
import Link from "next/link";
import { getOrg, ld, faqLd, SHOP, breadcrumbLd } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui";
import OpenChatButton from "@/components/OpenChatButton";

export const revalidate = 3600;

const NAVY = "#0C3C63";
const BRAND = "#1696F4";

export const metadata: Metadata = {
  title: "วิธีการสั่งซื้อ — สั่งซื้อ/ขอใบเสนอราคาออนไลน์กับ JNAC",
  description:
    "วิธีสั่งซื้อสินค้ากับ JNAC ผ่าน jnac.online ทำตาม 6 ขั้นตอน: เลือกสินค้า → หยิบใส่ตะกร้า → กรอกข้อมูลติดต่อ → ส่งคำขอใบเสนอราคา ทีมงานติดต่อกลับ พร้อมจัดส่งทั่วประเทศ",
  alternates: { canonical: "/how-to-order" },
};

const STEPS: [string, string][] = [
  ["เข้าเว็บไซต์ร้านค้า", "เปิด www.jnac.online ใช้งานได้ทั้งคอมพิวเตอร์ มือถือ และแท็บเล็ต โดยไม่ต้องสมัครสมาชิก"],
  ["เลือกดูสินค้า", "เลือกตามกลุ่มสินค้า/หมวดหมู่ หรือกดเข้าดูรายละเอียดสินค้า ซึ่งแสดงราคา สเปก และสถานะ (พร้อมส่ง/สั่งผลิต)"],
  ["หยิบใส่ตะกร้า", "กดปุ่ม “หยิบใส่ตะกร้า” ในหน้าสินค้า หรือกดปุ่ม “+” ที่การ์ดสินค้า เลือกได้ไม่จำกัดรายการ"],
  ["เปิดตะกร้าใบเสนอราคา", "กดปุ่ม “ตะกร้าใบเสนอราคา” มุมขวาบน ตรวจสอบรายการ ปรับจำนวน หรือลบสินค้าได้"],
  ["กรอกข้อมูลติดต่อ + ส่งคำขอ", "กรอกชื่อและเบอร์โทร (จำเป็น) แล้วกด “ส่งคำขอใบเสนอราคา” ระบบจะออกเลขที่เอกสารให้ทันที"],
  ["รอทีมงานติดต่อกลับ", "ทีมงาน JNAC จะติดต่อกลับเพื่อยืนยันราคา จำนวน สถานะสินค้า และนัดหมายการจัดส่ง/ชำระเงิน"],
];

const FAQS = [
  { q: "สั่งซื้อขั้นต่ำเท่าไหร่?", a: "ขึ้นอยู่กับสินค้าแต่ละรายการ (ดูได้ที่หน้าสินค้า) หากไม่แน่ใจ สอบถามทีมงานหรือระบุในหมายเหตุได้เลย" },
  { q: "มีราคาขายส่งไหม?", a: "มีครับ สำหรับการสั่งซื้อจำนวนมาก เพียงระบุจำนวนในคำขอใบเสนอราคา ทีมงานจะเสนอราคาพิเศษให้" },
  { q: "จัดส่งพื้นที่ไหนบ้าง?", a: "JNAC จัดส่งทั่วประเทศ ไม่ว่าคุณจะอยู่จังหวัดใด สามารถสั่งซื้อออนไลน์และจัดส่งถึงหน้าบ้านหรือหน้างานได้" },
  { q: "สินค้าที่ขึ้น “สั่งผลิต” สั่งได้ไหม?", a: "ได้ครับ เพียงหยิบใส่ตะกร้าและส่งคำขอ ทีมงานจะตรวจสอบและแจ้งระยะเวลาผลิตให้ทราบ" },
];

export default async function HowToOrder() {
  const org = await getOrg();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(faqLd(FAQS))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(breadcrumbLd([{ name: "หน้าแรก", url: SHOP }, { name: "วิธีการสั่งซื้อ", url: `${SHOP}/how-to-order` }]))}
      />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <Breadcrumb items={[{ name: "หน้าแรก", href: "/" }, { name: "วิธีการสั่งซื้อ" }]} />
        <h1 className="text-2xl sm:text-3xl font-extrabold" style={{ color: NAVY }}>วิธีการสั่งซื้อ</h1>
        <p className="mt-3 text-neutral-600 leading-relaxed">
          สั่งซื้อ / ขอใบเสนอราคาออนไลน์กับ {org.business_name} ได้ง่าย ๆ รองรับทั้งคอมพิวเตอร์ มือถือ และแท็บเล็ต พร้อมจัดส่งทั่วประเทศ
        </p>

        <ol className="mt-8 space-y-4">
          {STEPS.map(([t, d], i) => (
            <li key={i} className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-4">
              <span className="flex-shrink-0 grid place-items-center h-9 w-9 rounded-full text-white font-bold" style={{ background: BRAND }}>
                {i + 1}
              </span>
              <div>
                <div className="font-bold" style={{ color: NAVY }}>{t}</div>
                <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{d}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-xl p-4 text-sm" style={{ background: "#EAF4FE", borderLeft: `4px solid ${BRAND}`, color: NAVY }}>
          หมายเหตุ: เราจัดส่งทั่วประเทศ — สั่งซื้อได้จากทุกที่ และมีราคาพิเศษสำหรับการสั่งซื้อจำนวนมาก (ขายส่ง) เพียงระบุจำนวนในคำขอใบเสนอราคา
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/products" className="rounded-full px-7 py-3 font-semibold text-white shadow-md" style={{ background: BRAND }}>
            เริ่มเลือกสินค้า
          </Link>
          <OpenChatButton className="rounded-full px-7 py-3 font-semibold border-2" style={{ borderColor: NAVY, color: NAVY }}>
            แชทสอบถาม
          </OpenChatButton>
        </div>

        <h2 className="mt-12 text-xl font-bold" style={{ color: NAVY }}>คำถามที่พบบ่อย</h2>
        <div className="mt-4 space-y-3">
          {FAQS.map((f, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="font-semibold" style={{ color: NAVY }}>ถาม: {f.q}</div>
              <p className="mt-1.5 text-sm text-neutral-600 leading-relaxed">ตอบ: {f.a}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
