"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "หน้าแรก" },
  { href: "/products", label: "สินค้าทั้งหมด" },
  { href: "/compare", label: "เปรียบเทียบและเลือกสินค้า" },
  { href: "/how-to-order", label: "วิธีการสั่งซื้อ" },
  { href: "/knowledge", label: "ศูนย์ความรู้" },
];

export default function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;

    firstLinkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="xl:hidden">
      <button
        ref={buttonRef}
        type="button"
        className="grid h-11 w-11 place-items-center rounded-lg border border-white/40 text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label={open ? "ปิดเมนูหลัก" : "เปิดเมนูหลัก"}
        aria-expanded={open}
        aria-controls="mobile-navigation-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? (
            <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          ) : (
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-navigation-panel"
          className="absolute inset-x-0 top-full border-t border-white/15 bg-[#0C3C63] px-4 py-4 shadow-xl"
        >
          <div className="mx-auto grid max-w-7xl gap-1">
            {LINKS.map((link, index) => (
              <Link
                key={link.href}
                ref={index === 0 ? firstLinkRef : undefined}
                href={link.href}
                className="rounded-lg px-4 py-3 text-base font-semibold text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <a
              href="#contact"
              className="rounded-lg px-4 py-3 text-base font-semibold text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              onClick={() => setOpen(false)}
            >
              ติดต่อเรา
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
