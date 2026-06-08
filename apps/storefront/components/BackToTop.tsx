"use client";

import { useEffect, useState } from "react";

/** Floating "กลับขึ้นด้านบน" button. Appears after scrolling down; smooth-
 *  scrolls to the top. Anchored bottom-LEFT so it never overlaps the chat
 *  bubble (which lives bottom-right). */
export default function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="กลับขึ้นด้านบน"
      title="กลับขึ้นด้านบน"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={
        "fixed left-4 bottom-4 sm:left-5 sm:bottom-5 z-[900] grid h-11 w-11 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/10 transition-all duration-300 hover:scale-110 " +
        (show
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-3 pointer-events-none")
      }
      style={{ background: "#0C3C63" }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-5 w-5"
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </button>
  );
}
