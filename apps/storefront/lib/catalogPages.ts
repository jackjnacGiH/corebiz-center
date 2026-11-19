import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getProductBySku, getGroupById, getProductsByGroup, normalizeSku } from "./products";

// Bound a first detail request to its SKU/group, not the full catalog.
// React cache deduplicates metadata/page reads; the data cache shares successful
// public lookups across renders with the existing five-minute freshness.
const options = { revalidate: 300, tags: ["storefront-public-catalog"] };
const readProduct = unstable_cache(getProductBySku, ["storefront-product-v1"], options);
const readGroup = unstable_cache(getGroupById, ["storefront-group-v1"], options);
const readGroupProducts = unstable_cache(getProductsByGroup, ["storefront-group-products-v1"], options);

export const getCatalogProductBySku = cache((sku: string) => {
  const normalized = normalizeSku(sku);
  return normalized ? readProduct(normalized) : Promise.resolve(null);
});

function normalizeGroupId(id: string): string | null {
  const value = id.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : null;
}

export const getCatalogGroupById = cache((id: string) => {
  const normalized = normalizeGroupId(id);
  return normalized ? readGroup(normalized) : Promise.resolve(null);
});

export const getCatalogProductsByGroup = cache((id: string) => {
  const normalized = normalizeGroupId(id);
  return normalized ? readGroupProducts(normalized) : Promise.resolve([]);
});
