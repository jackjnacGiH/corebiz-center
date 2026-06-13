import { useMemo, useState } from 'react';
import { BookOpen, Search, ChevronRight } from 'lucide-react';

/**
 * คู่มือการใช้งาน CoreBiz Center — หน้าเอกสารในตัว (อ่านได้ทุก role)
 * เนื้อหาเก็บเป็นโครงสร้างข้อมูล แล้ว render เป็นสารบัญ + ช่องค้นหา + การ์ดเนื้อหา
 * แก้ไข/เพิ่มหัวข้อได้ที่ตัวแปร SECTIONS ด้านล่าง
 */

type Block =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'steps'; items: string[] }
  | { t: 'note'; text: string }
  | { t: 'warn'; text: string }
  | { t: 'h'; text: string };

interface Section {
  id: string;
  icon: string;
  title: string;
  audience?: string; // ใครใช้ได้ เช่น "Owner / Admin"
  blocks: Block[];
}

const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: '🏠',
    title: 'ภาพรวม & การเข้าสู่ระบบ',
    blocks: [
      { t: 'p', text: 'CoreBiz Center คือศูนย์จัดการการขายครบวงจรของ JNAC — รวมหน้าร้านออนไลน์, คลังสินค้า, คำสั่งซื้อ, ลูกค้า (CRM), แชททุกช่องทาง, การตลาด, ผู้ช่วย AI และระบบหลังบ้านไว้ที่เดียว' },
      { t: 'h', text: 'ที่อยู่เว็บ (URL)' },
      { t: 'ul', items: [
        'หน้าร้านลูกค้า: https://www.jnac.online',
        'หลังบ้าน (แอดมิน): https://www.jnac.online/center',
        'พอร์ทัลลูกค้า (บัญชีของฉัน): https://www.jnac.online/account',
      ] },
      { t: 'h', text: 'การเข้าสู่ระบบ' },
      { t: 'steps', items: [
        'เปิด /center → กรอกอีเมล + รหัสผ่าน หรือกดเข้าสู่ระบบด้วย Google / LINE',
        'พนักงาน (role staff ขึ้นไป) จะเข้าหลังบ้านได้ — ลูกค้าทั่วไปจะถูกพาไปหน้า "บัญชีของฉัน" อัตโนมัติ',
        'สลับภาษา ไทย/EN ได้ที่มุมขวาบน',
      ] },
      { t: 'note', text: 'เมนูบางอย่าง (AI Agent, จัดการผู้ใช้, ตั้งค่าระบบ, บันทึกการใช้งาน) เห็นเฉพาะ Owner และ Admin' },
    ],
  },
  {
    id: 'dashboard',
    icon: '📊',
    title: 'แดชบอร์ด (Dashboard)',
    blocks: [
      { t: 'p', text: 'หน้าแรกหลังล็อกอิน แสดงภาพรวมธุรกิจแบบเรียลไทม์' },
      { t: 'ul', items: [
        'การ์ด KPI: รายได้รวม, คำสั่งซื้อที่ใช้งาน, สินค้าใกล้หมด, ลูกค้าใหม่ (30 วัน)',
        'กราฟประสิทธิภาพการขายสะสมรายปี',
        'กิจกรรมล่าสุด: ออเดอร์/ความเคลื่อนไหวล่าสุด',
        'AI Workflow Assistant: ช่องพิมพ์เพื่อสั่งงานผ่าน n8n (ถ้าตั้งค่าไว้)',
      ] },
      { t: 'steps', items: ['กด "Reload" มุมขวาบนเพื่อรีเฟรชตัวเลขล่าสุด'] },
    ],
  },
  {
    id: 'ecommerce',
    icon: '🛒',
    title: 'รายการสินค้าขาย (E-Commerce)',
    blocks: [
      { t: 'p', text: 'จัดการสินค้าที่แสดงบนหน้าร้านออนไลน์' },
      { t: 'h', text: 'เพิ่ม/แก้ไขสินค้า' },
      { t: 'steps', items: [
        'กด "เพิ่มสินค้า" หรือคลิกสินค้าเดิมเพื่อแก้ไข',
        'กรอก: ชื่อ (ไทย/อังกฤษ), SKU, แบรนด์, หมวดหมู่/กลุ่ม, ราคา, ส่วนลด, หน่วย, จำนวนขั้นต่ำ (MOQ), น้ำหนัก',
        'อัปโหลดรูปสินค้า (ลากวาง/เลือกไฟล์) — รูปแรกเป็นรูปหลัก',
        'ตั้งสถานะ active = แสดงหน้าร้าน / inactive = ซ่อน',
        'บันทึก → หน้าร้านอัปเดตอัตโนมัติ',
      ] },
      { t: 'h', text: 'แก้ไขหลายรายการพร้อมกัน (Bulk edit)' },
      { t: 'ul', items: [
        'ติ๊กเลือกหลายสินค้า → แก้ไขพร้อมกันได้: หมวดหมู่, แบรนด์, สถานะ ฯลฯ',
        'ช่วยจัดหมวดสินค้าจำนวนมากได้เร็ว',
      ] },
      { t: 'note', text: 'ราคาทุน/ต้นทุน เป็นข้อมูลภายใน ไม่แสดงบนหน้าร้านและบอทจะไม่เปิดเผยให้ลูกค้า' },
    ],
  },
  {
    id: 'inventory',
    icon: '📦',
    title: 'คลังสินค้า (Inventory)',
    blocks: [
      { t: 'p', text: 'ดูและจัดการสต็อกคงเหลือของสินค้าแต่ละรายการ' },
      { t: 'ul', items: [
        'แสดงจำนวนคงเหลือ, จุดสั่งซื้อซ้ำ (reorder level), ตำแหน่งจัดเก็บ',
        'สินค้าที่ต่ำกว่าจุดสั่งซื้อซ้ำจะถูกชูเป็น "ใกล้หมด" และ AI Agent จะเสนองานเติมสต็อก',
        'ระบบซิงก์สต็อกอัตโนมัติจาก Google Sheet ทุกชั่วโมง (ถ้าตั้งค่าไว้)',
      ] },
      { t: 'steps', items: ['คลิกสินค้าเพื่อปรับจำนวน/จุดสั่งซื้อซ้ำ → บันทึก'] },
    ],
  },
  {
    id: 'orders',
    icon: '🚚',
    title: 'คำสั่งซื้อ (Orders)',
    blocks: [
      { t: 'p', text: 'จัดการคำสั่งซื้อตั้งแต่รับออเดอร์จนจัดส่ง พร้อมออกเอกสาร' },
      { t: 'h', text: 'สถานะคำสั่งซื้อ' },
      { t: 'ul', items: [
        'รอดำเนินการ → กำลังเตรียม → พร้อมส่ง → จัดส่งแล้ว',
        'หรือ ยกเลิก / คืนสินค้า',
        'กดปุ่มสถานะในหน้ารายละเอียดเพื่อเปลี่ยนสถานะ',
      ] },
      { t: 'h', text: 'พิมพ์เอกสาร' },
      { t: 'steps', items: [
        'เปิดคำสั่งซื้อ → แถบล่างมีปุ่ม 🖨 พิมพ์: ต้นฉบับ / สำเนา / ทั้งคู่',
        'ชื่อเอกสารเปลี่ยนตามสถานะ: ใบสั่งขาย / ใบส่งของ / ใบสรุปจัดส่งแล้ว / ใบยกเลิก / ใบคืน',
        'มีช่องลงชื่อ + วันที่ ตามบทบาท (ผู้สั่งซื้อ/ผู้เสนอราคา ฯลฯ) ครบ 1 หน้า A4',
      ] },
      { t: 'note', text: 'แก้ไขรายการสินค้าในออเดอร์ได้ด้วยปุ่ม "แก้ไขรายการ" (ระหว่างแก้ไข แถบพิมพ์จะซ่อน)' },
    ],
  },
  {
    id: 'crm',
    icon: '👥',
    title: 'ระบบลูกค้า (CRM)',
    audience: 'ทุกคน (อนุมัติเชื่อมบัญชี = Owner/Admin)',
    blocks: [
      { t: 'p', text: 'ฐานลูกค้า + เครื่องมือดูแลลูกค้าครบวงจร มีหลายมุมมอง (กดสลับด้านบน)' },
      { t: 'ul', items: [
        'แดชบอร์ด CRM, รายชื่อลูกค้า, กลุ่ม RFM (แชมป์/ขาประจำ/กำลังจะหาย ฯลฯ)',
        'เครื่องมือ: เตือนซื้อซ้ำ, ดึงลูกค้าหาย, ติดตามใบเสนอราคา, NPS/ความพึงพอใจ, แนะนำเพื่อน, จัดการ Tier, แคมเปญ, ตารางนัด',
      ] },
      { t: 'h', text: 'โปรไฟล์ลูกค้า 360°' },
      { t: 'steps', items: [
        'คลิกชื่อลูกค้า → เปิดแผงด้านขวา: ยอดซื้อสะสม, RFM, ข้อมูลติดต่อ, ประวัติออเดอร์/ใบเสนอราคา, แชต, แต้มสะสม, สาขา, โน้ต',
        'กล่อง "ผู้ติดต่อ (จากพอร์ทัล)": รายชื่อคนที่ล็อกอินพอร์ทัลในนามบริษัทนี้ พร้อมสถานะยืนยัน',
      ] },
      { t: 'h', text: 'อนุมัติคำขอเชื่อมบัญชีลูกค้า (Owner/Admin)' },
      { t: 'p', text: 'เมื่อลูกค้าลงทะเบียนพอร์ทัลด้วยเลขผู้เสียภาษีที่ตรงกับลูกค้าเดิม จะมีแผงเหลือง "คำขอเชื่อมบัญชี — รออนุมัติ" บนสุดของหน้า CRM' },
      { t: 'steps', items: [
        'ติดต่อลูกค้าขอเอกสารยืนยัน (หนังสือรับรองบริษัท / ภพ.20)',
        'กด อนุมัติ → ลูกค้าเห็น Tier + ประวัติบริษัททันที / กด ปฏิเสธ → ตัดการเชื่อม',
      ] },
      { t: 'warn', text: 'ก่อนอนุมัติทุกครั้งต้องยืนยันตัวตนลูกค้า เพราะเลขผู้เสียภาษีเป็นข้อมูลกึ่งสาธารณะ' },
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    title: 'แชทรวมช่องทาง (Omni-Chat)',
    blocks: [
      { t: 'p', text: 'รวมแชทจากทุกช่องทาง (LINE OA, เว็บวิดเจ็ต ฯลฯ) ไว้หน้าจอเดียว ตอบลูกค้าได้โดยตรง' },
      { t: 'h', text: 'การทำงานหลัก' },
      { t: 'ul', items: [
        'ฟิลเตอร์สถานะ: ยังไม่อ่าน / กำลังดำเนินการ / เสร็จสิ้น',
        'ผู้รับผิดชอบ: เลือกพนักงานที่ดูแลห้องแชทนี้ (สีวงแหวนบอก role)',
        'บอทตอบ (สวิตช์): เปิด = บอท "เอย" ตอบอัตโนมัติ / ปิด = แอดมินคุยเอง',
        'พิมพ์ตอบ: ช่องขยายอัตโนมัติสูงสุด 8 บรรทัด (Shift+Enter ขึ้นบรรทัด, Enter ส่ง)',
        'เครื่องมือ: อิโมจิ, แนบรูป, ครอปภาพ, ข้อความสำเร็จรูป (Quick reply), การ์ดสินค้า',
      ] },
      { t: 'h', text: 'รูปภาพจากลูกค้า' },
      { t: 'ul', items: [
        'รูป (สลิป/สินค้า) ที่ลูกค้าส่งจะแสดงในแชท — คลิกเปิดเต็มจอ',
        'เอาเมาส์ชี้รูป → ปุ่ม ⬇️ ดาวน์โหลดไฟล์จริงได้เลย',
      ] },
      { t: 'h', text: 'โน้ตลูกค้า' },
      { t: 'ul', items: [
        'เพิ่มโน้ตประเภท: ทั่วไป, ใบกำกับภาษี, ที่อยู่ส่งของ, เตือนความจำ, บัญชีธนาคาร, สิทธิพิเศษ',
        'เลือก-คลุมข้อความเพื่อคัดลอกได้เลย หรือกดปุ่ม 📋 คัดลอกทั้งโน้ต',
        'ที่อยู่ส่งของจะแสดง ต./อ./จ. ให้อัตโนมัติ (คัดลอกส่งขนส่งได้ทันที)',
        'โน้ตเตือนความจำเลือกวันครบกำหนด (วันอย่างเดียว) · ลากจัดลำดับได้ที่ที่จับ ⠿',
      ] },
    ],
  },
  {
    id: 'marketing',
    icon: '📈',
    title: 'การตลาด (Marketing)',
    audience: 'Owner / Admin / Staff',
    blocks: [
      { t: 'p', text: 'เครื่องมือการตลาด 2 อย่างหลัก: แคมเปญส่งข้อความหาลูกค้า และคูปองส่วนลด (เมนู "Marketing")' },
      { t: 'h', text: 'แคมเปญ (Campaigns)' },
      { t: 'ul', items: [
        'ยิงแคมเปญตามกลุ่มลูกค้า (RFM/Tier) ผ่าน LINE — ส่งทีละราย เว้นจังหวะ สุ่มสลับข้อความ (กันถูกมองเป็นบอท)',
        'กดสร้างแคมเปญ → ตั้งชื่อ/กลุ่มเป้าหมาย/ข้อความ → เริ่มหรือหยุดแคมเปญได้',
      ] },
      { t: 'h', text: 'คูปอง / Discount Codes' },
      { t: 'ul', items: [
        'สร้างรหัสคูปอง กำหนดส่วนลด (บาทหรือ %) วันหมดอายุ และจำนวนครั้งที่ใช้ได้',
        'คูปองจากระบบสะสมแต้ม/ดึงลูกค้ากลับ จะออกเป็นรหัสใช้ครั้งเดียวให้อัตโนมัติ',
      ] },
      { t: 'warn', text: 'ส่งแคมเปญในเวลาทำการ และไม่เกินโควตา LINE OA/เดือน' },
      { t: 'note', text: 'ขณะนี้คูปองยังไม่ถูกหักตอนลูกค้าสั่งซื้อบนหน้าร้านโดยอัตโนมัติ (ยังไม่ได้ต่อระบบตรวจคูปองที่ตะกร้า) — ใช้เป็นรหัสอ้างอิงให้ทีมกรอกส่วนลดด้วยมือไปก่อน' },
    ],
  },
  {
    id: 'affiliate',
    icon: '🤝',
    title: 'ระบบตัวแทนจำหน่าย (Affiliate / Dropship)',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'หน้าทะเบียนตัวแทน/พาร์ทเนอร์ที่ช่วยขายให้ JNAC แล้วได้ส่วนแบ่ง (คอมมิชชัน) — อยู่ที่เมนู "Affiliate" (คนละหน้ากับการตลาด)' },
      { t: 'h', text: 'การ์ดสรุปด้านบน' },
      { t: 'ul', items: [
        'ตัวแทนที่ใช้งาน — จำนวนตัวแทนสถานะ active เทียบกับทั้งหมด',
        'ยอดขายรวม / คอมมิชชันจ่ายแล้ว / ค้างจ่าย — รวมจากตัวแทนทุกราย',
      ] },
      { t: 'h', text: 'อนุมัติ / ระงับ ตัวแทน' },
      { t: 'steps', items: [
        'ตัวแทนสมัครใหม่จะขึ้นสถานะ "pending" (รออนุมัติ)',
        'กดปุ่ม "อนุมัติ" → เปลี่ยนเป็น "active" เริ่มใช้งานและรับคอมได้',
        'กดปุ่ม "ระงับ" → พักการใช้งานตัวแทน (suspended) เมื่อมีปัญหา',
      ] },
      { t: 'h', text: 'Tier (ระดับตัวแทน) & คอม%' },
      { t: 'ul', items: [
        'มี 4 ระดับ: Starter → Silver → Gold → Platinum (ใช้จัดกลุ่ม/ให้สิทธิ์ตามผลงาน)',
        'คอม% = อัตราส่วนแบ่งของตัวแทนแต่ละราย กำหนดแยกได้ต่อคน',
      ] },
      { t: 'h', text: 'Tracking Links (ลิงก์ติดตาม)' },
      { t: 'steps', items: [
        'แต่ละตัวแทนมีลิงก์เฉพาะตัว /ref/{รหัส} ไว้ให้แชร์',
        'กด "Copy link" เพื่อคัดลอกลิงก์ส่งให้ตัวแทน',
      ] },
      { t: 'warn', text: 'ตอนนี้ตัวเลขคลิก/ยอดขาย/คอมมิชชันยังต้องบันทึกด้วยมือ — ระบบยังไม่นับคลิกอัตโนมัติ และยังไม่ผูกออเดอร์เข้ากับตัวแทนเพื่อคำนวณคอมเอง (ต้องพัฒนาเพิ่มถ้าต้องการให้นับอัตโนมัติ)' },
    ],
  },
  {
    id: 'rag',
    icon: '🧠',
    title: 'Knowledge Base (ฐานความรู้บอท)',
    blocks: [
      { t: 'p', text: 'คลังความรู้ที่บอท "เอย" ใช้ตอบคำถามนโยบาย/ข้อมูลทั่วไป (FAQ, เงื่อนไขจัดส่ง, การชำระเงิน ฯลฯ)' },
      { t: 'steps', items: [
        'เพิ่ม/แก้ไขบทความความรู้ → ระบบทำ embedding ให้ค้นหาเชิงความหมายได้',
        'ยิ่งใส่ความรู้ครบ บอทยิ่งตอบเองได้มาก ลดงานเข้าทีม',
      ] },
      { t: 'note', text: 'ข้อมูลสินค้า/ราคา/สต็อก บอทดึงสดจากระบบสินค้าอยู่แล้ว ไม่ต้องใส่ใน Knowledge Base' },
    ],
  },
  {
    id: 'ask',
    icon: '🤖',
    title: 'AI ผู้ช่วย (AI Admin Chat)',
    blocks: [
      { t: 'p', text: 'ช่องแชทให้ทีมงานถาม AI เกี่ยวกับข้อมูลในระบบ/ความรู้สินค้า เพื่อช่วยทำงาน (คนละตัวกับบอทที่คุยกับลูกค้า)' },
    ],
  },
  {
    id: 'agent',
    icon: '✨',
    title: 'AI Agent (ผู้ช่วยอัตโนมัติ)',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'ศูนย์รวม "งานที่ AI เสนอ" ให้ทีมตรวจและอนุมัติ — แบ่งเป็น 3 สาย' },
      { t: 'ul', items: [
        'Sales: Lead ใหม่จากแชท, คำขอใบเสนอราคา, ลูกค้าตอบรับ/ปฏิเสธใบเสนอราคา, ติดตามใบเสนอราคาค้าง',
        'Ops: สินค้าใกล้หมด/เติมสต็อก, ออเดอร์ค้างชำระ, ตะกร้าทิ้งค้าง, สรุปประจำวัน, คำขอยืนยันบัญชีลูกค้า',
        'Content/SEO: บทความสินค้า/คอนเทนต์',
      ] },
      { t: 'steps', items: [
        'แต่ละงานมี: หัวข้อ, รายละเอียด, คำแนะนำ',
        'กด อนุมัติ/ดำเนินการ เพื่อทำตามที่เสนอ หรือ ปิด (dismiss) ถ้าไม่ต้องการ',
      ] },
      { t: 'note', text: 'งานสำคัญ (ขอใบเสนอราคา/Lead/ยืนยันบัญชี/ตอบรับใบเสนอราคา) จะแจ้งเตือนเข้า LINE ของ Owner/Admin อัตโนมัติด้วย' },
    ],
  },
  {
    id: 'users',
    icon: '🔐',
    title: 'จัดการผู้ใช้และสิทธิ์ (Users)',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'เพิ่ม/แก้ไข/กำหนดสิทธิ์ทีมงาน (เรียงลำดับ Owner บนสุด)' },
      { t: 'h', text: 'บทบาท (Role)' },
      { t: 'ul', items: [
        '👑 Owner (เจ้าของ): ทำได้ทุกอย่าง รวมลบผู้ใช้/โอนความเป็นเจ้าของ',
        'Admin (ผู้ดูแล): จัดการ staff, ตั้งค่าระบบ, AI Agent, ดูบันทึกการใช้งาน',
        'Staff (พนักงาน): งานขาย/คลัง/แชท/ลูกค้า',
        'Agent / Viewer: สิทธิ์จำกัดตามที่กำหนด',
        'Customer (ลูกค้า): เห็นเฉพาะหน้าร้าน + พอร์ทัล ไม่เข้าหลังบ้าน',
      ] },
      { t: 'steps', items: [
        'กด "เพิ่มผู้ใช้" → กรอกอีเมล + เลือก role → ตั้งรหัสผ่าน หรือส่งอีเมลเชิญ',
        'แก้ไข role/ชื่อ, ตั้งรหัสผ่านใหม่ (🔑), เปิด-ปิดบัญชี (⏻), โอนเจ้าของ (👑), ลบ (🗑)',
        'กดดูคู่มือสิทธิ์ตามบทบาทได้ที่การ์ดด้านล่างของหน้า',
      ] },
      { t: 'warn', text: 'ผู้สมัคร/ล็อกอินใหม่ทุกคนเป็น role customer โดยอัตโนมัติ — ต้อง Owner/Admin กำหนดสิทธิ์ทีมงานให้เองเท่านั้น' },
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: 'ตั้งค่าระบบ (Settings)',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'ตั้งค่ากลางของระบบ (เข้าได้จากเมนูโปรไฟล์มุมขวาบน → ตั้งค่าระบบ)' },
      { t: 'h', text: 'LINE OA' },
      { t: 'steps', items: [
        'เพิ่ม Channel → กรอก Channel ID + Access token + Channel secret (จาก LINE Developers Console)',
        'กด "ทดสอบเชื่อมต่อ" ให้ขึ้นเขียว → เพิ่ม → ใช้งาน (activate) — ระบบปิด channel อื่นให้อัตโนมัติ',
        'คัดลอก Webhook URL ในการ์ดไปวางใน LINE Console → Messaging API → เปิด Use webhook',
      ] },
      { t: 'h', text: 'อื่นๆ' },
      { t: 'ul', items: [
        'ข้อมูลบริษัท (ชื่อ, ที่อยู่, เลขภาษี, โทร, โลโก้) — ใช้บนเอกสาร/หน้าร้าน',
        'AI Persona: ปรับบุคลิก/คำพูดของบอทแต่ละช่องทาง',
        'หยุดบอทชั่วคราว (3 ระดับ): ทั้งระบบ / เฉพาะช่องทาง / เฉพาะห้องแชท',
        'คำพ้องค้นหา (keyword synonyms): แปลงคำที่ลูกค้าพิมพ์ → ชื่อสินค้า',
      ] },
    ],
  },
  {
    id: 'audit',
    icon: '📜',
    title: 'บันทึกการใช้งาน (Audit Log)',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'บันทึกการกระทำสำคัญในระบบ เช่น เพิ่ม/แก้/ลบผู้ใช้, อนุมัติเชื่อมบัญชี, ลูกค้าแก้ข้อมูลตัวเอง, ตอบรับใบเสนอราคา — ใช้ตรวจสอบย้อนหลังว่าใครทำอะไรเมื่อไหร่' },
    ],
  },
  {
    id: 'portal',
    icon: '🪪',
    title: 'พอร์ทัลลูกค้า (บัญชีของฉัน)',
    blocks: [
      { t: 'p', text: 'หน้า https://www.jnac.online/account สำหรับลูกค้าที่ล็อกอิน — ผูกกับ Tier ใน CRM' },
      { t: 'ul', items: [
        'การ์ดระดับสมาชิก (Tier) + ส่วนลดสมาชิก % + คะแนน + ยอดสะสม',
        'ข้อมูลบริษัทตัวเอง (แก้ไขได้เอง — เลขภาษี/อีเมลแก้ไม่ได้ ต้องแจ้งทีมงาน)',
        'ใบเสนอราคา/คำสั่งซื้อของตัวเอง — เปิดดูเอกสารเต็ม + พิมพ์/บันทึก PDF + กดตอบรับ/ปฏิเสธใบเสนอราคา',
        'ลงทะเบียนเอง: กรอกชื่อ+เบอร์+เลขภาษี 13 หลัก+ที่อยู่ (รหัสไปรษณีย์เติม ต./อ./จ. ให้อัตโนมัติ)',
      ] },
      { t: 'note', text: 'เลขภาษีตรงลูกค้าเดิม → เข้าสถานะ "รอยืนยันตัวตน" (Tier ทั่วไปก่อน ไม่เห็นประวัติ) จนกว่า Owner/Admin อนุมัติในหน้า CRM' },
      { t: 'p', text: 'สมาชิกที่ล็อกอินแล้วขอใบเสนอราคาในตะกร้า ระบบเติมข้อมูล + หักส่วนลด Tier ให้อัตโนมัติ และใบเข้าประวัติบัญชีทันที' },
    ],
  },
  {
    id: 'bot',
    icon: '🗣️',
    title: 'บอท "เอย" (พฤติกรรมการตอบลูกค้า)',
    blocks: [
      { t: 'p', text: 'บอท AI ที่ตอบลูกค้าทั้ง LINE และเว็บวิดเจ็ต (สมองตัวเดียวกัน)' },
      { t: 'ul', items: [
        'ไม่ตอบว่า "ไม่สามารถ/ไม่มี/ไม่พบ" — เรื่องที่ตอบเองไม่ได้จะ "รับเรื่องไว้ + แจ้งทีมงาน" และบอกลูกค้าว่าจะรีบแจ้งกลับ',
        'สินค้าหมด/ไม่ตรง → เสนอสินค้าใกล้เคียง หรือเสนอสั่งผลิต',
        'ขอใบเสนอราคา (ระบุสินค้า+จำนวน) → บอทสร้างใบเสนอราคาฉบับร่างจริงให้ + แจ้งเลขที่ QT- กับลูกค้า',
        'อ่านรูปได้ (vision) — ดูสลิป/รูปสินค้าแล้วเข้าใจ',
        'ไม่เปิดเผยราคาทุน/ต้นทุน เด็ดขาด',
      ] },
      { t: 'note', text: 'อยากแทรกคุยเอง: ปิดสวิตช์ "บอทตอบ" ในห้องแชทนั้น (Omni-Chat) หรือหยุดทั้งระบบ/ช่องทางที่ ตั้งค่าระบบ' },
    ],
  },
  {
    id: 'notify',
    icon: '🔔',
    title: 'การแจ้งเตือนทีมผ่าน LINE',
    audience: 'Owner / Admin',
    blocks: [
      { t: 'p', text: 'เมื่อมีงานสำคัญเข้าคิว AI Agent ระบบจะ push ข้อความเข้า LINE ของ Owner/Admin อัตโนมัติ' },
      { t: 'ul', items: [
        'เหตุการณ์: ขอใบเสนอราคาใหม่, Lead ใหม่, คำขอยืนยันบัญชีลูกค้า, ลูกค้าตอบรับ/ปฏิเสธใบเสนอราคา',
        'เงื่อนไข: ต้องเป็น Owner/Admin ที่ผูก LINE ไว้ (ทักหา OA 1 ครั้งแล้วแจ้งทีมผูกให้)',
      ] },
    ],
  },
  {
    id: 'troubleshoot',
    icon: '🛠️',
    title: 'แก้ปัญหาเบื้องต้น',
    blocks: [
      { t: 'ul', items: [
        'บอทไม่ตอบใน LINE → เช็ก Webhook URL + เปิด Use webhook ใน LINE Console และปิด Auto-reply/Greeting ของ OA',
        'บอทตอบชนกับระบบเดิม → มีระบบบอทเก่าทำงานอยู่ ต้องสลับ webhook มาที่ระบบนี้ + ปิดระบบเก่า',
        'หน้าจอไม่อัปเดตหลังเปลี่ยนข้อมูล → รีเฟรชแบบล้างแคช (Ctrl+Shift+R)',
        'ลืมรหัสผ่าน/บัญชีถูกปิด → ติดต่อ Owner/Admin ให้ตั้งรหัสใหม่หรือเปิดบัญชีในหน้าจัดการผู้ใช้',
      ] },
      { t: 'note', text: 'ติดปัญหาที่แก้เองไม่ได้ ติดต่อทีมพัฒนาระบบพร้อมภาพหน้าจอและขั้นตอนที่ทำ' },
    ],
  },
];

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'h':
      return <div className="text-sm font-bold text-neutral-800 mt-3 mb-1">{b.text}</div>;
    case 'p':
      return <p className="text-sm text-neutral-700 leading-relaxed mb-1.5">{b.text}</p>;
    case 'ul':
      return (
        <ul className="mb-2 space-y-1">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-700 leading-relaxed">
              <span className="text-indigo-400 flex-shrink-0">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="mb-2 space-y-1">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-700 leading-relaxed">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold flex-shrink-0">{i + 1}</span>
              <span className="pt-0.5">{it}</span>
            </li>
          ))}
        </ol>
      );
    case 'note':
      return <div className="my-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 leading-relaxed">💡 {b.text}</div>;
    case 'warn':
      return <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">⚠️ {b.text}</div>;
  }
}

function blockText(b: Block): string {
  if (b.t === 'ul' || b.t === 'steps') return b.items.join(' ');
  return b.text;
}

export default function Manual() {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(term) ||
        (s.audience ?? '').toLowerCase().includes(term) ||
        s.blocks.some((b) => blockText(b).toLowerCase().includes(term)),
    );
  }, [q]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
          <BookOpen size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">คู่มือการใช้งาน CoreBiz Center</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            รวมฟังก์ชันหลักทุกตัว เงื่อนไข และวิธีใช้ — สำหรับทีมงานเปิดดูได้ทันที
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative my-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาในคู่มือ เช่น ใบเสนอราคา, สต็อก, LINE, สิทธิ์…"
          className="w-full h-10 rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {/* TOC */}
      {!q && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-5">
          <div className="text-[11px] uppercase font-bold text-neutral-500 mb-2 tracking-wide">สารบัญ</div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 text-sm text-neutral-700 hover:text-indigo-700 py-1 group"
              >
                <span>{s.icon}</span>
                <span className="group-hover:underline">{s.title}</span>
                <ChevronRight size={13} className="text-neutral-300 ml-auto" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {filtered.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="rounded-xl border border-neutral-200 bg-white p-5 scroll-mt-4"
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-neutral-100">
              <span className="text-lg">{s.icon}</span>
              <h2 className="text-base font-bold text-neutral-900">{s.title}</h2>
              {s.audience && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {s.audience}
                </span>
              )}
            </div>
            {s.blocks.map((b, i) => (
              <BlockView key={i} b={b} />
            ))}
          </section>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-sm text-neutral-400 py-12">
            ไม่พบหัวข้อที่ตรงกับ "{q}"
          </div>
        )}
      </div>

      <div className="text-center text-[11px] text-neutral-400 mt-6">
        CoreBiz Center · คู่มือนี้อัปเดตตามฟังก์ชันล่าสุดของระบบ
      </div>
    </div>
  );
}
