import { ld } from "@/lib/seo";

type Section = { h: string; body: string[] };

/**
 * Renders an auto-composed SEO/AEO article at the bottom of a collection page
 * (category or product group) plus a schema.org Article JSON-LD block — so the
 * page is rich for both classic SEO and AI Search Overview answers.
 */
export default function CollectionArticle({
  title,
  article,
  url,
  orgName,
  logoUrl,
}: {
  title: string;
  article: Section[];
  url: string;
  orgName: string;
  logoUrl?: string | null;
}) {
  const articleBody = article.flatMap((s) => [s.h, ...s.body]).join(" ");
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={ld({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: `${title}: คู่มือการเลือกและใช้งาน`,
          about: title,
          inLanguage: "th-TH",
          articleBody,
          author: { "@type": "Organization", name: orgName },
          publisher: {
            "@type": "Organization",
            name: orgName,
            ...(logoUrl ? { logo: { "@type": "ImageObject", url: logoUrl } } : {}),
          },
          mainEntityOfPage: url,
        })}
      />
      <section className="mt-16 max-w-3xl">
        <h2 className="text-2xl font-bold text-neutral-900 mb-6">
          เจาะลึก {title}: ความรู้และการเลือกซื้อ
        </h2>
        <article className="space-y-6">
          {article.map((s, i) => (
            <div key={i}>
              <h3 className="text-lg font-bold text-neutral-900 mb-2">{s.h}</h3>
              {s.body.map((para, j) => (
                <p key={j} className="text-sm text-neutral-600 leading-relaxed mb-2">
                  {para}
                </p>
              ))}
            </div>
          ))}
        </article>
      </section>
    </>
  );
}
