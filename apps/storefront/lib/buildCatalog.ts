import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { getPrerenderProducts, getGroups, getProductBySku, normalizeSku, type SProduct, type SGroup } from "./products";

// Next 16 sets NEXT_PHASE before spawning its static generation workers.
// This snapshot exists only in those build processes, never in runtime ISR.
export const isCatalogBuild = () => process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;

interface BuildCatalog {
  products: SProduct[];
  groups: SGroup[];
  exact: Map<string, SProduct>;
  normalized: Map<string, SProduct | null>;
  groupsById: Map<string, SGroup>;
  groupProducts: Map<string, SProduct[]>;
}

// An intentional immutable-public-data cache per build worker, not user state.
// Keeping a failed promise fails the build without a per-page retry stampede.
let buildCatalog: Promise<BuildCatalog> | undefined;
function readBuildCatalog(): Promise<BuildCatalog> {
  if (!isCatalogBuild()) throw new Error("build_catalog_unavailable_at_runtime");
  buildCatalog ??= Promise.all([getPrerenderProducts(), getGroups()]).then(([products, groups]) => {
    const exact = new Map<string, SProduct>();
    const normalized = new Map<string, SProduct | null>();
    const groupProducts = new Map<string, SProduct[]>();
    for (const product of products) {
      exact.set(product.sku, product);
      const sku = normalizeSku(product.sku);
      normalized.set(sku, normalized.has(sku) ? null : product);
      if (product.group_id) {
        const id = product.group_id.toLowerCase();
        const rows = groupProducts.get(id) ?? [];
        rows.push(product);
        groupProducts.set(id, rows);
      }
    }
    console.info(`[storefront-prerender] Bulk snapshot: ${products.length} products, ${groups.length} groups`);
    return { products, groups, exact, normalized, groupProducts,
      groupsById: new Map(groups.map(group => [group.id.toLowerCase(), group])) };
  });
  return buildCatalog;
}

export async function getPrerenderProductParams() {
  if (!isCatalogBuild()) return [];
  const { products } = await readBuildCatalog();
  return [...new Set(products.map(product => normalizeSku(product.sku)).filter(Boolean))].map(sku => ({ sku }));
}

export async function getPrerenderGroupParams() {
  if (!isCatalogBuild()) return [];
  const { groups } = await readBuildCatalog();
  return groups.map(group => ({ id: group.id }));
}

export async function getBuildProduct(sku: string): Promise<SProduct | null> {
  const catalog = await readBuildCatalog();
  const exact = catalog.exact.get(sku);
  if (exact) return exact;
  const candidate = catalog.normalized.get(sku);
  // Rare legacy normalized collisions retain the existing DB SKU precedence.
  return candidate === null ? getProductBySku(sku) : candidate ?? null;
}

export async function getBuildGroup(id: string): Promise<SGroup | null> {
  return (await readBuildCatalog()).groupsById.get(id) ?? null;
}

export async function getBuildGroupProducts(id: string): Promise<SProduct[]> {
  return (await readBuildCatalog()).groupProducts.get(id)?.slice() ?? [];
}
