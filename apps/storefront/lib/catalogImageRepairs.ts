import repairs from "./catalog-image-repairs.json";

// Exact, reviewed repairs only. Database image arrays and Storage objects stay
// untouched; the old URLs remain in the registry for audit/reversal.
export function resolveCatalogImageUrl(src: string): string {
  const repair = (repairs as Record<string, { replacement: string }>)[src];
  return repair?.replacement ?? src;
}

export function resolveCatalogImageUrls(images: string[] | null): string[] | null {
  return Array.isArray(images) ? [...new Set(images.map(resolveCatalogImageUrl))] : images;
}
