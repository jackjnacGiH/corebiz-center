import type { Metadata } from "next";
import "./globals.css";
import { getOrg, organizationLd, localBusinessLd, ld, SITE, SHOP } from "@/lib/seo";
import { Nav, Footer } from "@/components/ui";
import ChatWidget from "@/components/ChatWidget";

const DESC =
  "JNAC (เจ แนค) ผู้จำหน่ายวัสดุและอุปกรณ์งานขัด เจียร ตัด ขัดเงา และเครื่องมือลมสำหรับงานอุตสาหกรรม — กระดาษทราย จานทราย ล้อขัด ใบตัด ครบวงจร พร้อมราคาและสเปกชัดเจน ขอใบเสนอราคาได้ทันที";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "JNAC – วัสดุงานขัด เจียร ตัด ขัดเงา สำหรับงานอุตสาหกรรม",
    template: "%s | JNAC by CoreBiz",
  },
  description: DESC,
  alternates: { canonical: "/shop" },
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "JNAC by CoreBiz",
    url: SHOP,
    title: "JNAC – วัสดุงานขัด เจียร ตัด ขัดเงา",
    description: DESC,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const org = await getOrg();
  return (
    <html lang="th">
      <body className="bg-neutral-50 text-neutral-900 antialiased min-h-screen flex flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={ld(organizationLd(org))} />
        <script type="application/ld+json" dangerouslySetInnerHTML={ld(localBusinessLd(org))} />
        <Nav org={org} />
        <div className="flex-1">{children}</div>
        <Footer org={org} />
        <ChatWidget />
      </body>
    </html>
  );
}
