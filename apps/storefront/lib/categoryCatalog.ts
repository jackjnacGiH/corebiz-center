import { unstable_cache } from "next/cache";
import { getAllProducts, getCategories, getGroups, getPublicProductOrder } from "./products";
import { getOrg } from "./seo";

// Public data only, with the same five-minute freshness as /products.
// Share one successful snapshot across categories and pagination requests;
// failed refreshes throw so Next can retain its last successful cache entry.
export const getCategoryCatalog = unstable_cache(async () => {
  const [products, categories, groups, org, productOrder] = await Promise.all([
    getAllProducts(), getCategories(), getGroups(), getOrg(), getPublicProductOrder(),
  ]);
  return { products, categories, groups, org, productOrder };
}, ["storefront-category-catalog-v2"], { revalidate: 300, tags: ["storefront-public-catalog"] });
