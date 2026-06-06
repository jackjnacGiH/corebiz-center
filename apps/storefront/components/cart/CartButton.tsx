"use client";

import { useCart } from "./CartProvider";

const BRAND = "#1696F4";

export default function CartButton() {
  const { count, setOpen } = useCart();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="relative inline-flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-semibold text-white transition"
      style={{ background: BRAND }}
      aria-label="ตะกร้าใบเสนอราคา"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l3-8H6.4M7 13L5.4 5M7 13l-2 5h12M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      </svg>
      <span className="hidden sm:inline">ตะกร้าใบเสนอราคา</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 grid place-items-center rounded-full bg-rose-500 text-white text-[11px] font-bold">
          {count}
        </span>
      )}
    </button>
  );
}
