import { cache } from "react";
import { getProductBySku, getGroupById, getProductsByGroup, normalizeSku } from "./products";
import { isCatalogBuild, getBuildProduct, getBuildGroup, getBuildGroupProducts } from "./buildCatalog";

// Bound a first detail request to its SKU/group and share metadata/page reads.
// The route's existing 300s ISR caches the rendered page. A second persistent
// data-cache layer per SKU adds cold read/write latency and can compound expiry.
// Only company identity and whole-category snapshots need cross-route caching.
const readProduct = cache(getProductBySku);
const readGroup = cache(getGroupById);
const readGroupProducts = cache(getProductsByGroup);

export const getCatalogProductBySku = cache((sku: string) => {
  const normalized = normalizeSku(sku);
  return normalized ? (isCatalogBuild() ? getBuildProduct(normalized) : readProduct(normalized)) : Promise.resolve(null);
});

function normalizeGroupId(id: string): string | null {
  const value = id.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : null;
}

export const getCatalogGroupById = cache((id: string) => {
  const normalized = normalizeGroupId(id);
  return normalized ? (isCatalogBuild() ? getBuildGroup(normalized) : readGroup(normalized)) : Promise.resolve(null);
});

export const getCatalogProductsByGroup = cache((id: string) => {
  const normalized = normalizeGroupId(id);
  return normalized ? (isCatalogBuild() ? getBuildGroupProducts(normalized) : readGroupProducts(normalized)) : Promise.resolve([]);
});
