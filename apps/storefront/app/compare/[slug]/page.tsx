import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import OpenChatButton from "@/components/OpenChatButton";
import { Breadcrumb } from "@/components/ui";
import { COMPARISONS, getComparison } from "@/lib/comparisons";
import { getComparisonCrossSiteGuides } from "@/lib/crossSiteGuides";
import { breadcrumbLd, faqLd, getOrg, ld, SHOP } from "@/lib/seo";

export const dynamicParams = false;

const DATE_PUBLISHED = "2026-07-18";
const DATE_MODIFIED = "2026-11-18";
const AUTHOR = "ทีมเนื้อหา J NAC";
const REVIEWER = "ทีมเทคนิคผลิตภัณฑ์ J NAC";

const SPEC_CHECKS = [
  ["วัสดุชิ้นงาน", "เทียบชนิดวัสดุกับข้อมูลรุ่นจริง", "วัสดุชื่อใกล้กันอาจต้องใช้เม็ดขัดหรือกระบวนการต่างกัน"],
  ["เบอร์ขัด (Grit)", "เลือกตามปริมาณเนื้อที่ต้องลบและผิวปลายทาง", "ทดลองบนพื้นที่เล็กและไล่เบอร์เพื่อลดรอยจากขั้นก่อนหน้า"],
  ["Backing / ระบบยึด", "ตรวจชนิด backing, pad, รู และขนาดให้ตรงกัน", "ห้ามดัดแปลงหรือติดตั้งกับระบบที่ผู้ผลิตไม่รองรับ"],
  ["Max RPM", "อ่านค่าบนวัสดุขัด อุปกรณ์รอง และเครื่องมือ", "ห้ามใช้เกินค่าต่ำสุดที่อุปกรณ์ในชุดอนุญาต"],
  ["ข้อควรระวัง", "ตรวจสภาพสินค้า guard และ PPE ก่อนเริ่มงาน", "หยุดใช้เมื่อชำรุด สั่นผิดปกติ หรือข้อมูลบนฉลากไม่ชัด"],
] as const;

export function generateStaticParams() {
  return COMPARISONS.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getComparison(slug);
  if (!guide) return { title: "ไม่พบคู่มือเปรียบเทียบ" };

  return {
    title: guide.shortTitle,
    description: guide.description,
    alternates: { canonical: `/compare/${guide.slug}` },
    openGraph: {
      type: "article",
      url: `/compare/${guide.slug}`,
      title: `${guide.title} | JNAC`,
      description: guide.description,
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getComparison(slug);
  if (!guide) notFound();
  const org = await getOrg();
  const url = `${SHOP}/compare/${guide.slug}`;
  const relatedArticles = getComparisonCrossSiteGuides(guide.slug);
  const articleBody = [
    guide.answer,
    ...guide.rows.flatMap((row) => [row.label, ...row.values]),
    ...guide.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...guide.faqs.flatMap((faq) => [faq.q, faq.a]),
  ].join(" ");

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={ld(faqLd(guide.faqs))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld(
          breadcrumbLd([
            { name: "หน้าแรก", url: SHOP },
            { name: "เปรียบเทียบและเลือกสินค้า", url: `${SHOP}/compare` },
            { name: guide.shortTitle, url },
          ]),
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: guide.title,
          description: guide.description,
          articleBody,
          inLanguage: "th-TH",
          mainEntityOfPage: url,
          datePublished: DATE_PUBLISHED,
          dateModified: DATE_MODIFIED,
          author: { "@type": "Organization", name: AUTHOR },
          reviewedBy: { "@type": "Organization", name: REVIEWER },
          publisher: {
            "@type": "Organization",
            name: org.business_name,
            ...(org.logo_url ? { logo: { "@type": "ImageObject", url: org.logo_url } } : {}),
          },
        })}
      />

      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <Breadcrumb
          items={[
            { name: "หน้าแรก", href: "/" },
            { name: "เปรียบเทียบสินค้า", href: "/compare" },
            { name: guide.shortTitle },
          ]}
        />

        <article>
          <header className="max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-wide text-[#0879BD]">คู่มือเลือกวัสดุขัด</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-[#0C3C63] sm:text-4xl">
              {guide.title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              จัดทำโดย {AUTHOR} · ตรวจทานโดย {REVIEWER} · เผยแพร่ <time dateTime={DATE_PUBLISHED}>18 ก.ค. 2569</time> · แก้ไขล่าสุด <time dateTime={DATE_MODIFIED}>18 พ.ย. 2569</time>
            </p>
            <div className="mt-6 rounded-2xl border-l-4 border-[#0879BD] bg-sky-50 p-5 sm:p-6">
              <h2 className="text-lg font-bold text-[#0C3C63]">คำตอบสั้น</h2>
              <p className="mt-2 leading-relaxed text-neutral-800">{guide.answer}</p>
            </div>
          </header>

          <section className="mt-10" aria-labelledby="comparison-table-heading">
            <h2 id="comparison-table-heading" className="text-2xl font-bold text-[#0C3C63]">ตารางเปรียบเทียบ</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="min-w-[720px] w-full border-collapse text-left text-sm">
                <thead className="bg-[#0C3C63] text-white">
                  <tr>
                    {guide.columns.map((column) => (
                      <th key={column} scope="col" className="px-5 py-4 font-semibold">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {guide.rows.map((row) => (
                    <tr key={row.label} className="align-top">
                      <th scope="row" className="w-44 bg-neutral-50 px-5 py-4 font-semibold text-neutral-900">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={`${row.label}-${index}`} className="px-5 py-4 leading-relaxed text-neutral-700">{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">บนมือถือสามารถเลื่อนตารางซ้าย-ขวาได้</p>
          </section>

          <section className="mt-10" aria-labelledby="spec-check-heading">
            <h2 id="spec-check-heading" className="text-2xl font-bold text-[#0C3C63]">ตารางเช็กสเปกก่อนเลือกและใช้งาน</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="min-w-[720px] w-full border-collapse text-left text-sm">
                <thead className="bg-neutral-100 text-neutral-900">
                  <tr>
                    <th scope="col" className="px-5 py-4 font-semibold">หัวข้อ</th>
                    <th scope="col" className="px-5 py-4 font-semibold">สิ่งที่ต้องเปรียบเทียบ</th>
                    <th scope="col" className="px-5 py-4 font-semibold">ข้อควรระวัง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {SPEC_CHECKS.map(([label, check, caution]) => (
                    <tr key={label} className="align-top">
                      <th scope="row" className="bg-neutral-50 px-5 py-4 font-semibold text-neutral-900">{label}</th>
                      <td className="px-5 py-4 leading-relaxed text-neutral-700">{check}</td>
                      <td className="px-5 py-4 leading-relaxed text-neutral-700">{caution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-12 grid gap-6 lg:grid-cols-2" aria-label="งานที่เหมาะและไม่เหมาะ">
            {guide.options.map((option) => (
              <div key={option.name} className="rounded-2xl border border-neutral-200 bg-white p-6">
                <h2 className="text-xl font-bold text-[#0C3C63]">{option.name}</h2>
                <h3 className="mt-5 font-semibold text-emerald-800">เหมาะกับงานอะไร</h3>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-neutral-700">
                  {option.suitable.map((item) => <li key={item}>• {item}</li>)}
                </ul>
                <h3 className="mt-5 font-semibold text-amber-800">ไม่เหมาะหรือควรระวัง</h3>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-neutral-700">
                  {option.avoid.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            ))}
          </section>

          {guide.sections.map((section) => (
            <section key={section.heading} className="mt-12 max-w-4xl">
              <h2 className="text-2xl font-bold text-[#0C3C63]">{section.heading}</h2>
              <div className="mt-4 space-y-4 leading-relaxed text-neutral-700">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}

          <section className="mt-12 max-w-4xl" aria-labelledby="comparison-faq">
            <h2 id="comparison-faq" className="text-2xl font-bold text-[#0C3C63]">คำถามที่พบบ่อย</h2>
            <div className="mt-4 space-y-4">
              {guide.faqs.map((faq) => (
                <div key={faq.q} className="rounded-xl border border-neutral-200 bg-white p-5">
                  <h3 className="font-semibold text-neutral-900">{faq.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-700">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>

          {relatedArticles.length > 0 && (
            <section className="mt-12 max-w-4xl" aria-labelledby="expert-articles">
              <h2 id="expert-articles" className="text-2xl font-bold text-[#0C3C63]">อ่านบทความผู้เชี่ยวชาญจาก J NAC</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {relatedArticles.map((article) => (
                  <a
                    key={article.href}
                    href={article.href}
                    target="_blank"
                    rel="noopener"
                    className="rounded-xl border border-sky-200 bg-white p-5 transition hover:bg-sky-50"
                  >
                    <p className="text-xs font-bold uppercase tracking-wide text-[#0879BD]">{article.eyebrow}</p>
                    <h3 className="mt-2 font-bold text-[#0C3C63]">{article.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-700">{article.description}</p>
                    <span className="mt-3 inline-block font-semibold text-[#0879BD]">{article.cta} ↗</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="mt-12 rounded-2xl bg-[#0C3C63] p-6 text-white sm:p-8" aria-labelledby="comparison-cta">
            <h2 id="comparison-cta" className="text-2xl font-bold">ยังไม่แน่ใจว่ารุ่นไหนตรงกับงาน?</h2>
            <p className="mt-2 max-w-3xl leading-relaxed text-white/90">
              เตรียมข้อมูลวัสดุชิ้นงาน ขั้นตอนงาน เครื่องมือ ขนาด และรอบที่ใช้ แล้วให้ทีม JNAC ช่วยตรวจตัวเลือกจากสินค้าที่มีอยู่จริง
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/products" className="inline-flex min-h-11 items-center rounded-lg bg-white px-5 py-3 font-semibold text-[#0C3C63] transition hover:bg-sky-50">
                ดูสินค้าวัสดุขัด
              </Link>
              <OpenChatButton className="inline-flex min-h-11 items-center rounded-lg border border-white/60 px-5 py-3 font-semibold text-white transition hover:bg-white/10">
                ปรึกษาผู้เชี่ยวชาญ
              </OpenChatButton>
            </div>
          </section>
        </article>
      </main>
    </>
  );
}
