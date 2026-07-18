import type { MetadataRoute } from "next";
import { getAllProducts, getCategories, getGroups } from "@/lib/products";
import { SHOP, productUrl, categoryUrl, groupUrl } from "@/lib/seo";
import { COMPARISON_SLUGS } from "@/lib/comparisons";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, groups] = await Promise.all([
    getAllProducts(),
    getCategories(),
    getGroups(),
  ]);

  // Only list groups that actually have active products.
  const groupCounts = new Map<string, number>();
  for (const p of products) {
    if (p.group_id) groupCounts.set(p.group_id, (groupCounts.get(p.group_id) ?? 0) + 1);
  }
  const visibleGroups = groups.filter((g) => (groupCounts.get(g.id) ?? 0) > 0);

  return [
    { url: SHOP, changeFrequency: "daily", priority: 1 },
    { url: `${SHOP}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SHOP}/how-to-order`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SHOP}/knowledge`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SHOP}/compare`, changeFrequency: "monthly", priority: 0.8 },
    ...COMPARISON_SLUGS.map((slug) => ({
      url: `${SHOP}/compare/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    ...visibleGroups.map((g) => ({
      url: groupUrl(g.id),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...categories.map((c) => ({
      url: categoryUrl(c.slug),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...products.map((p) => ({
      url: productUrl(p.sku),
      changeFrequency: "weekly" as const,
      priority: 0.8,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
    })),
  ];
}
