"use client";

import { useState } from "react";
import { useCart } from "./CartProvider";

const BRAND = "#1696F4";

export default function AddToCartButton(props: {
  sku: string;
  name: string;
  price: number;
  unit: string | null;
  image: string | null;
  moq: number;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        add({ sku: props.sku, name: props.name, price: props.price, unit: props.unit, image: props.image, moq: props.moq });
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
      className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 text-white rounded-lg py-3.5 px-8 font-semibold transition shadow-md"
      style={{ background: added ? "#16a34a" : BRAND }}
    >
      {added ? (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          เพิ่มลงตะกร้าแล้ว
        </>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l3-8H6.4M7 13L5.4 5M7 13l-2 5h12M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          </svg>
          หยิบใส่ตะกร้า
        </>
      )}
    </button>
  );
}
