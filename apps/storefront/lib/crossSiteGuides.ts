export interface CrossSiteGuide {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

const GROUP_GUIDES: Record<string, CrossSiteGuide> = {
  "64e1a9b0-97cd-4579-b418-eb56076dbb5d": {
    eyebrow: "ข้อมูลก่อนสั่งซื้อ",
    title: "เลือกเบอร์ CS310X ให้ตรงกับงานขัด",
    description:
      "อ่านข้อมูลวัสดุ ขนาด แนวทางเลือกเบอร์ และข้อควรตรวจสอบก่อนเลือกสินค้า CS310X แต่ละรายการ",
    href: "https://www.jnac.co.th/%E0%B8%88%E0%B8%B2%E0%B8%99%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%8B%E0%B9%89%E0%B8%AD%E0%B8%99%E0%B8%AB%E0%B8%A5%E0%B8%B1%E0%B8%87%E0%B8%AD%E0%B9%88%E0%B8%AD%E0%B8%99-klingspor-%E0%B8%A3%E0%B8%B8%E0%B9%88%E0%B8%99-cs310x",
    cta: "อ่านคู่มือ CS310X ฉบับเต็ม",
  },
};

export function getGroupCrossSiteGuide(groupId: string): CrossSiteGuide | null {
  return GROUP_GUIDES[groupId] ?? null;
}
