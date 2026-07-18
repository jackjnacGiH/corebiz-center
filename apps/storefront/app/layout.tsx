import type { Metadata } from "next";
import "./globals.css";
import { getOrg, organizationLd, localBusinessLd, websiteLd, ld, SITE, SHOP } from "@/lib/seo";
import { Nav, Footer } from "@/components/ui";
import ChatWidget from "@/components/ChatWidget";
import BackToTop from "@/components/BackToTop";
import { CartProvider } from "@/components/cart/CartProvider";
import CartDrawer from "@/components/cart/CartDrawer";

const DESC =
  "JNAC (เจ แนค) ผู้จำหน่ายวัสดุและอุปกรณ์อุตสาหกรรมครบวงจร — งานขัด ตัด เจียร, เครื่องมือช่าง (Tools) และพลาสติกวิศวกรรม พร้อมราคาและสเปกชัดเจน ขอใบเสนอราคาได้ทันที";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "JNAC – วัสดุงานขัด เจียร ตัด ขัดเงา สำหรับงานอุตสาหกรรม",
    template: "%s | JNAC",
  },
  description: DESC,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "J NAC (Thailand) Co., Ltd.",
    url: SHOP,
    title: "JNAC – วัสดุงานขัด เจียร ตัด ขัดเงา",
    description: DESC,
  },
  twitter: {
    card: "summary_large_image",
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
        <script type="application/ld+json" dangerouslySetInnerHTML={ld(websiteLd())} />
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-lg bg-white px-4 py-3 font-semibold text-[#0C3C63] shadow-lg transition focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-[#0C3C63]"
        >
          ข้ามไปยังเนื้อหาหลัก
        </a>
        <CartProvider>
          <Nav org={org} />
          <div className="flex-1">{children}</div>
          <Footer org={org} />
          <CartDrawer />
        </CartProvider>
        <ChatWidget />
        <BackToTop />
      </body>
    </html>
  );
}
