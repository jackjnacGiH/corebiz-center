import { cache } from "react";
import { getCategoryCatalog } from "./categoryCatalog";
import { normalizeSku } from "./products";

// React cache deduplicates layout/metadata/page reads within one render only.
// The underlying public snapshot supplies the existing 300-second freshness.
const readCatalog = cache(getCategoryCatalog);

export const getCatalogProductBySku = cache(async (sku: string) => {
  const normalized = normalizeSku(sku);
  if (!normalized) return null;
  const { products } = await readCatalog();
  return products.find(p => p.sku === normalized)
    ?? products.find(p => normalizeSku(p.sku) === normalized)
    ?? null;
});

export const getCatalogGroupById = cache(async (id: string) => {
  const { groups } = await readCatalog();
  const normalized = id.trim().toLowerCase();
  return groups.find(group => group.id.toLowerCase() === normalized) ?? null;
});

export const getCatalogProductsByGroup = cache(async (id: string) => {
  const { products, productOrder } = await readCatalog();
  const order = new Map(productOrder.map((productId, index) => [productId, index]));
  const normalized = id.trim().toLowerCase();
  return products.filter(p => p.group_id?.toLowerCase() === normalized)
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
});
