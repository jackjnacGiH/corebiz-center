"use client";

import { useEffect, useState } from "react";

// The public AI chat (เอย) served by the SPA — the very same floating widget
// embedded on www.jnac.co.th. It renders its OWN bubble + panel and posts its
// open/closed state to the host so we only resize the transparent iframe:
// a small box around the bubble when collapsed (so it doesn't block page
// clicks), full size when open. No custom wrapper → a single (purple) widget.
const WIDGET_SRC = "https://www.corebiz.online/widget?pos=br&offset=16";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      try {
        if (!new URL(e.origin).hostname.endsWith("corebiz.online")) return;
      } catch {
        return;
      }
      const d = e.data as { type?: string; open?: boolean } | null;
      if (d && typeof d === "object" && d.type === "corebiz-widget") {
        setOpen(Boolean(d.open));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      src={WIDGET_SRC}
      title="แชทกับเอย ผู้ช่วย AI"
      allow="clipboard-write"
      className={
        "fixed right-0 bottom-0 z-[1000] border-0 bg-transparent transition-[width,height] duration-200 " +
        (open
          ? "w-screen sm:w-[420px] h-[100dvh] sm:h-[680px] max-h-screen"
          : "w-[150px] h-[150px]")
      }
    />
  );
}
