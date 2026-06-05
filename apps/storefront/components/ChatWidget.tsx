"use client";

import { useState } from "react";

const BRAND = "#1696F4";
// Same-origin (corebiz.online) — the public AI chat (เอย) served by the SPA,
// the very same bot embedded on www.jnac.co.th.
const WIDGET_URL = "https://www.corebiz.online/widget";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) setMounted(true); // mount the iframe on first open, keep it after
      return next;
    });
  }

  return (
    <>
      {/* Chat panel */}
      {mounted && (
        <div
          className={
            "fixed z-[1000] right-4 sm:right-6 bottom-24 " +
            "w-[92vw] sm:w-[384px] h-[70vh] sm:h-[560px] max-h-[calc(100vh-7rem)] " +
            "rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 bg-white flex flex-col " +
            "transition-all duration-200 origin-bottom-right " +
            (open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none")
          }
          aria-hidden={!open}
        >
          <div
            className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0"
            style={{ background: BRAND }}
          >
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-white/20 text-sm font-bold">
                เอย
              </span>
              <div className="leading-tight">
                <div className="text-sm font-bold">ผู้ช่วย AI</div>
                <div className="text-[11px] text-white/80">พร้อมให้บริการ</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="ปิดแชท"
              className="p-1.5 rounded-md hover:bg-white/15 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <iframe
            src={WIDGET_URL}
            title="แชทกับเอย ผู้ช่วย AI"
            className="flex-1 w-full border-0"
            allow="clipboard-write"
          />
        </div>
      )}

      {/* Floating launcher */}
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "ปิดแชท" : "แชทกับเอย ผู้ช่วย AI"}
        className="fixed z-[1000] right-4 sm:right-6 bottom-6 grid place-items-center h-14 w-14 rounded-full text-white shadow-xl shadow-black/20 hover:scale-105 active:scale-95 transition"
        style={{ background: BRAND }}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h8M8 14h5M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 21 12Z"
            />
          </svg>
        )}
      </button>
    </>
  );
}
