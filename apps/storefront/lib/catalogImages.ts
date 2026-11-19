import manifest from "./catalog-image-manifest.json";

export type CatalogImageVariant = {
  width: number;
  height: number;
  originalBytes: number;
  sources: { width: number; src: string; bytes: number }[];
};

// Called on the server only. Send just the selected image's variants to clients,
// not the entire catalog manifest. Original URLs remain unchanged in the data.
export function catalogImageVariant(src: string | null | undefined): CatalogImageVariant | undefined {
  if (!src) return undefined;
  return (manifest as Record<string, CatalogImageVariant>)[src];
}
