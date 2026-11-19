"use client";

import { useState } from "react";
import type { CatalogImageVariant } from "@/lib/catalogImages";

export const CARD_IMAGE_SIZES = "(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

export default function CatalogImage({ src, alt, variant, sizes = CARD_IMAGE_SIZES, priority = false, className = "" }: {
  src: string;
  alt: string;
  variant?: CatalogImageVariant;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  const useVariant = variant && failedSource !== src;
  const fallback = variant?.sources.find(image => image.width >= 640) ?? variant?.sources.at(-1);

  if (failedOriginal === src) {
    return <span role="img" aria-label={alt} className={`grid place-items-center text-center text-sm text-neutral-500 ${className}`}>ไม่สามารถโหลดรูปได้</span>;
  }

  return (
    // Static WebP files are already resized; do not add request-time optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={useVariant ? fallback?.src ?? src : src}
      srcSet={useVariant ? variant.sources.map(image => `${image.src} ${image.width}w`).join(", ") : undefined}
      sizes={useVariant ? sizes : undefined}
      width={variant?.width}
      height={variant?.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => useVariant ? setFailedSource(src) : setFailedOriginal(src)}
      className={className}
    />
  );
}
