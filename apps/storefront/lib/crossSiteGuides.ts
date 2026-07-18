export interface CrossSiteGuide {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

const GROUP_GUIDES: Record<string, CrossSiteGuide> = {
  "64e1a9b0-97cd-4579-b418-eb56076dbb5d": {
    eyebrow: "คู่มือเลือกสินค้า",
    title: "เลือก Flap Disc แบบ Soft หรือ Hard Backing",
    description:
      "เทียบจุดเด่นของแป้นหลังอ่อนและแป้นหลังแข็ง เพื่อเลือกให้เหมาะกับงานผิวโค้ง งานพื้นราบ และงานขอบ",
    href: "/compare/flap-disc-soft-vs-hard-backing",
    cta: "ดูคู่มือเปรียบเทียบ",
  },
};

export function getGroupCrossSiteGuide(groupId: string): CrossSiteGuide | null {
  return GROUP_GUIDES[groupId] ?? null;
}
