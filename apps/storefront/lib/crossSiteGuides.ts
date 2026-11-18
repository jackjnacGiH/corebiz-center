export interface CrossSiteGuide {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

const GROUP_GUIDES: Record<string, CrossSiteGuide> = {
  "64e1a9b0-97cd-4579-b418-eb56076dbb5d": {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "จานทรายเรียงซ้อน คืออะไร มีกี่ชนิด?",
    description:
      "อ่านหลักการเลือกจานทรายซ้อนหลังอ่อนและหลังแข็งตามรูปทรงชิ้นงาน แรงกด และลักษณะงาน ก่อนเลือกสินค้า CS310X",
    href: "https://www.jnac.co.th/17002546/%E0%B8%88%E0%B8%B2%E0%B8%99%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B9%80%E0%B8%A3%E0%B8%B5%E0%B8%A2%E0%B8%87%E0%B8%8B%E0%B9%89%E0%B8%AD%E0%B8%99-%E0%B8%84%E0%B8%B7%E0%B8%AD%E0%B8%AD%E0%B8%B0%E0%B9%84%E0%B8%A3-%E0%B8%A1%E0%B8%B5%E0%B8%81%E0%B8%B5%E0%B9%88%E0%B8%8A%E0%B8%99%E0%B8%B4%E0%B8%94",
    cta: "อ่านบทความจานทรายซ้อน",
  },
};

interface TopicGuide extends CrossSiteGuide {
  terms: string[];
}

export const ABRASIVES_TOPIC_GUIDES: TopicGuide[] = [
  {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "จานทรายเรียงซ้อน คืออะไร มีกี่ชนิด?",
    description: "อ่านหลักการเลือกจานทรายซ้อนหลังอ่อนและหลังแข็งตามรูปทรงชิ้นงาน แรงกด และลักษณะงาน",
    href: "https://www.jnac.co.th/17002546/%E0%B8%88%E0%B8%B2%E0%B8%99%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B9%80%E0%B8%A3%E0%B8%B5%E0%B8%A2%E0%B8%87%E0%B8%8B%E0%B9%89%E0%B8%AD%E0%B8%99-%E0%B8%84%E0%B8%B7%E0%B8%AD%E0%B8%AD%E0%B8%B0%E0%B9%84%E0%B8%A3-%E0%B8%A1%E0%B8%B5%E0%B8%81%E0%B8%B5%E0%B9%88%E0%B8%8A%E0%B8%99%E0%B8%B4%E0%B8%94",
    cta: "อ่านบทความฉบับเต็ม",
    terms: ["จานทรายซ้อน", "จานทรายเรียงซ้อน", "flap disc"],
  },
  {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "การปฏิบัติเพื่อความปลอดภัยในการใช้หินเจียร",
    description: "ทบทวนการตรวจสภาพจาน เครื่องมือ อุปกรณ์ป้องกัน และข้อควรระวังก่อนเริ่มงานเจียร",
    href: "https://www.jnac.co.th/17002573/%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%9B%E0%B8%8F%E0%B8%B4%E0%B8%9A%E0%B8%B1%E0%B8%95%E0%B8%B4%E0%B9%80%E0%B8%9E%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1%E0%B8%9B%E0%B8%A5%E0%B8%AD%E0%B8%94%E0%B8%A0%E0%B8%B1%E0%B8%A2%E0%B9%83%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%AB%E0%B8%B4%E0%B8%99%E0%B9%80%E0%B8%88%E0%B8%B5%E0%B8%A2%E0%B8%A3",
    cta: "อ่านแนวทางความปลอดภัย",
    terms: ["หินเจียร", "ใบเจียร", "grinding wheel", "grinding disc"],
  },
  {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "กระดาษทรายกับเคล็ดลับในการใช้งาน",
    description: "อ่านแนวทางใช้กระดาษทรายให้สัมพันธ์กับวัสดุ เบอร์ และลำดับขั้นของงานขัด",
    href: "https://www.jnac.co.th/17428113/%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%94%E0%B8%B2%E0%B8%A9%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%81%E0%B8%B1%E0%B8%9A%E0%B9%80%E0%B8%84%E0%B8%A5%E0%B9%87%E0%B8%94%E0%B8%A5%E0%B8%B1%E0%B8%9A%E0%B9%83%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%87%E0%B8%B2%E0%B8%99",
    cta: "อ่านเคล็ดลับงานขัด",
    terms: ["กระดาษทราย", "sandpaper"],
  },
  {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "การเลือกจานขัดใยสังเคราะห์และขนแกะขัดเงา",
    description: "อ่านภาพรวมการเลือกวัสดุขัดสำหรับเก็บผิวและขัดเงาก่อนเลือกขนาดหรือรุ่นสินค้า",
    href: "https://www.jnac.co.th/%E0%B8%84%E0%B8%B7%E0%B8%99%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1%E0%B9%80%E0%B8%87%E0%B8%B2%E0%B8%87%E0%B8%B2%E0%B8%A1%E0%B9%83%E0%B8%AB%E0%B9%89%E0%B8%8A%E0%B8%B4%E0%B9%89%E0%B8%99%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%82%E0%B8%AD%E0%B8%87%E0%B8%84%E0%B8%B8%E0%B8%93-%E0%B8%94%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%88%E0%B8%B2%E0%B8%99%E0%B8%82%E0%B8%B1%E0%B8%94%E0%B9%83%E0%B8%A2%E0%B8%AA%E0%B8%B1%E0%B8%87%E0%B9%80%E0%B8%84%E0%B8%A3%E0%B8%B2%E0%B8%B0%E0%B8%AB%E0%B9%8C-%E0%B8%82%E0%B8%99%E0%B9%81%E0%B8%81%E0%B8%B0%E0%B8%82%E0%B8%B1%E0%B8%94%E0%B9%80%E0%B8%87%E0%B8%B2",
    cta: "อ่านบทความงานขัดเงา",
    terms: ["จานขัดใยสังเคราะห์", "ขนแกะขัดเงา", "non woven disc", "polishing disc"],
  },
];

function findTopicGuide(text: string): CrossSiteGuide | null {
  const normalized = text.toLocaleLowerCase("th");
  return ABRASIVES_TOPIC_GUIDES.find((guide) =>
    guide.terms.some((term) => normalized.includes(term.toLocaleLowerCase("th"))),
  ) ?? null;
}

export function getGroupCrossSiteGuide(groupId: string, groupName = ""): CrossSiteGuide | null {
  return GROUP_GUIDES[groupId] ?? findTopicGuide(groupName);
}

export function getProductCrossSiteGuide(text: string): CrossSiteGuide | null {
  return findTopicGuide(text);
}

const COMPARISON_GUIDES: Record<string, CrossSiteGuide[]> = {
  "fiber-disc-vs-flap-disc": [ABRASIVES_TOPIC_GUIDES[0], {
    eyebrow: "บทความเชิงลึกที่ jnac.co.th",
    title: "กระดาษทรายกลมหลังไฟเบอร์ (Fiber Disc)",
    description: "ดูโครงสร้าง เม็ดขัด แผ่นรอง และแนวทางเลือก Fiber Disc ก่อนเทียบกับ Flap Disc รุ่นจริง",
    href: "https://www.jnac.co.th/14885674/%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%94%E0%B8%B2%E0%B8%A9%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2-fiber-disc",
    cta: "อ่านคู่มือ Fiber Disc",
  }],
  "flap-disc-soft-vs-hard-backing": [ABRASIVES_TOPIC_GUIDES[0]],
  "wet-vs-dry-sandpaper": [ABRASIVES_TOPIC_GUIDES[2]],
  "psa-vs-hook-loop-sandpaper": [ABRASIVES_TOPIC_GUIDES[2]],
  "aluminum-oxide-vs-zirconia-vs-ceramic": [
    ABRASIVES_TOPIC_GUIDES[2],
    {
      eyebrow: "บทความเชิงลึกที่ jnac.co.th",
      title: "กระดาษทรายกลมหลังไฟเบอร์ (Fiber Disc)",
      description: "ดูตัวอย่างการระบุ Aluminum Oxide และ Zirconia บนวัสดุขัด พร้อมข้อควรตรวจจากรุ่นจริง",
      href: "https://www.jnac.co.th/14885674/%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%94%E0%B8%B2%E0%B8%A9%E0%B8%97%E0%B8%A3%E0%B8%B2%E0%B8%A2-fiber-disc",
      cta: "อ่านคู่มือ Fiber Disc",
    },
  ],
};

export function getComparisonCrossSiteGuides(slug: string): CrossSiteGuide[] {
  return COMPARISON_GUIDES[slug] ?? [];
}
