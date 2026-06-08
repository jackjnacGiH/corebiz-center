import { supabase } from "./supabase";
import { effectivePrice } from "./format";
import type { SProduct } from "./products";

export const SITE = "https://www.jnac.online";
export const SHOP = `${SITE}/shop`;

export interface OrgInfo {
  business_name: string;
  address: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
}

const FALLBACK_ORG: OrgInfo = {
  business_name: "บริษัท เจ แนค (ประเทศไทย) จำกัด",
  address: null,
  tax_id: null,
  phone: null,
  email: null,
  website: SITE,
  logo_url: null,
};

export async function getOrg(): Promise<OrgInfo> {
  try {
    const { data } = await supabase
      .from("org_settings")
      .select("business_name,address,tax_id,phone,email,website,logo_url")
      .limit(1)
      .maybeSingle();
    if (data) {
      const d = data as Partial<OrgInfo>;
      return {
        ...FALLBACK_ORG,
        ...d,
        business_name: d.business_name || FALLBACK_ORG.business_name,
      };
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_ORG;
}

/** Wrap a JSON-LD object for dangerouslySetInnerHTML. */
export function ld(obj: unknown): { __html: string } {
  return { __html: JSON.stringify(obj) };
}

export function productUrl(sku: string): string {
  return `${SHOP}/p/${encodeURIComponent(sku)}`;
}

export function categoryUrl(slug: string): string {
  return `${SHOP}/c/${encodeURIComponent(slug)}`;
}

export function groupUrl(id: string): string {
  return `${SHOP}/g/${encodeURIComponent(id)}`;
}

export function organizationLd(org: OrgInfo) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.business_name,
    url: SITE,
    ...(org.logo_url ? { logo: org.logo_url } : {}),
    ...(org.phone || org.email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "sales",
            ...(org.phone ? { telephone: org.phone } : {}),
            ...(org.email ? { email: org.email } : {}),
            areaServed: "TH",
            availableLanguage: ["th", "en"],
          },
        }
      : {}),
  };
}

export function localBusinessLd(org: OrgInfo) {
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: org.business_name,
    url: SHOP,
    ...(org.logo_url ? { image: org.logo_url } : {}),
    ...(org.phone ? { telephone: org.phone } : {}),
    ...(org.email ? { email: org.email } : {}),
    ...(org.address
      ? { address: { "@type": "PostalAddress", streetAddress: org.address, addressCountry: "TH" } }
      : {}),
    ...(org.tax_id ? { taxID: org.tax_id } : {}),
  };
}

export function productLd(p: SProduct, org: OrgInfo) {
  const price = effectivePrice(p);
  const images = Array.isArray(p.images)
    ? (p.images.filter((x) => typeof x === "string") as string[])
    : [];
  return {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: p.name_th,
    ...(images.length ? { image: images } : {}),
    description: (p.description_th || p.name_th).slice(0, 500),
    sku: p.sku,
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(p.category_name_th ? { category: p.category_name_th } : {}),
    offers: {
      "@type": "Offer",
      url: productUrl(p.sku),
      priceCurrency: "THB",
      price: String(price),
      availability: p.in_stock
        ? "https://schema.org/InStock"
        : "https://schema.org/PreOrder",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: org.business_name },
    },
  };
}

export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function itemListLd(products: SProduct[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.slice(0, 100).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: productUrl(p.sku),
      name: p.name_th,
    })),
  };
}
