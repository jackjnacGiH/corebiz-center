"use client";

import { useState } from "react";
import { useCart } from "./CartProvider";

/** Small "+" add-to-cart button overlaid on a product card. It's a sibling of
 *  the card's <Link> (not nested), so clicking it adds to the cart without
 *  navigating to the product page. */
export default function CardAddButton(props: {
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
      aria-label={`หยิบ ${props.name} ใส่ตะกร้า`}
      title="หยิบใส่ตะกร้าใบเสนอราคา"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        add({
          sku: props.sku,
          name: props.name,
          price: props.price,
          unit: props.unit,
          image: props.image,
          moq: props.moq,
        });
        setAdded(true);
        setTimeout(() => setAdded(false), 1200);
      }}
      className="absolute top-2 right-2 z-10 grid place-items-center h-9 w-9 rounded-full text-white shadow-md hover:scale-110 active:scale-95 transition"
      style={{ background: added ? "#16a34a" : "#1696F4" }}
    >
      {added ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
      )}
    </button>
  );
}
