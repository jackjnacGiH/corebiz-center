"use client";

import { Children, type ReactNode } from "react";
import { useCatalogBatch } from "./useCatalogBatch";

// Keep /products statically cached: reveal already-rendered server cards in
// batches without turning every catalog visit into a new database request.
export default function CatalogGrid({ children }: { children: ReactNode }) {
  const entries = Children.toArray(children);
  const { visibleCount, showMore } = useCatalogBatch();
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {entries.slice(0, visibleCount)}
      </div>
      {visibleCount < entries.length && (
        <div className="mt-6 text-center">
          <p className="mb-3 text-sm text-neutral-500" aria-live="polite">แสดง {Math.min(visibleCount, entries.length)} จาก {entries.length} รายการ</p>
          <button type="button" onClick={showMore} className="min-h-11 rounded-full border border-[#0879BD] bg-white px-6 py-2.5 font-semibold text-[#0879BD] hover:bg-sky-50">โหลดรายการเพิ่ม</button>
        </div>
      )}
    </>
  );
}
