"use client";

import { useState, useSyncExternalStore } from "react";

const MOBILE_BATCH = 12;
const DESKTOP_BATCH = 30;
const QUERY = "(min-width: 640px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const snapshot = () => window.matchMedia(QUERY).matches ? DESKTOP_BATCH : MOBILE_BATCH;
const serverSnapshot = () => MOBILE_BATCH;

export function useCatalogBatch() {
  // Mobile-first SSR avoids downloading 30 photos before hydration on phones.
  const batch = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [requestedCount, setRequestedCount] = useState(0);
  const visibleCount = Math.max(batch, requestedCount);
  return {
    visibleCount,
    showMore: () => setRequestedCount(count => Math.max(count, batch) + batch),
  };
}
