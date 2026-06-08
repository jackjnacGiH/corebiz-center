"use client";

import { useEffect, useState } from "react";

/** Floating "กลับขึ้นด้านบน" button. Appears after scrolling down and smooth-
 *  scrolls to the top. Sits bottom-RIGHT, stacked just ABOVE the เอย chat
 *  bubble. Rendered above the (transparent) chat iframe so it stays clickable,
 *  and auto-hides while the chat panel is open so it never covers the chat. */
export default function BackToTop() {
  const [show, setShow] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    function onMsg(e: MessageEvent) {
      try {
        if (!new URL(e.origin).hostname.endsWith("corebiz.online")) return;
      } catch {
        return;
      }
      const d = e.data as { type?: string; open?: boolean } | null;
      if (d && typeof d === "object" && d.type === "corebiz-widget") {
        setChatOpen(Boolean(d.open));
      }
    }
    window.addEventListener("message", onMsg);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("message", onMsg);
    };
  }, []);

  const visible = show && !chatOpen;

  return (
    <button
      type="button"
      aria-label="กลับขึ้นด้านบน"
      title="กลับขึ้นด้านบน"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={
        "fixed right-5 bottom-[92px] sm:bottom-[96px] z-[1001] grid h-11 w-11 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/10 transition-all duration-300 hover:scale-110 " +
        (visible
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
