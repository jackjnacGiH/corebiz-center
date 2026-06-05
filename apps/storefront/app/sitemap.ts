import type { MetadataRoute } from "next";
import { getAllProducts, getCategories } from "@/lib/products";
import { SHOP, productUrl, categoryUrl } from "@/lib/seo";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([getAllProducts(), getCategories()]);
  return [
    { url: SHOP, changeFrequency: "daily", priority: 1 },
    ...categories.map((c) => ({
      url: categoryUrl(c.slug),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: productUrl(p.sku),
      changeFrequency: "weekly" as const,
      priority: 0.8,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
    })),
  ];
}
