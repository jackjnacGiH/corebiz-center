"use client";

import { useEffect, useRef, useState } from "react";

// The public AI chat (เอย) served by the SPA — the very same floating widget
// embedded on www.jnac.co.th. It renders its OWN bubble + panel and posts its
// open/closed state to the host so we only resize the transparent iframe:
// a small box around the bubble when collapsed (so it doesn't block page
// clicks), full size when open. No custom wrapper → a single (purple) widget.
const WIDGET_SRC = "https://www.jnac.online/widget?pos=br&offset=16";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      try {
        if (!new URL(e.origin).hostname.endsWith("jnac.online")) return;
      } catch {
        return;
      }
      const d = e.data as { type?: string; open?: boolean } | null;
      if (d && typeof d === "object" && d.type === "corebiz-widget") {
        setOpen(Boolean(d.open));
      }
    }
    // Any page CTA can fire window event "corebiz:open-chat" to pop the chat
    // open in place (instead of opening the full /widget page in a new tab).
    function onOpenChat() {
      setOpen(true);
      iframeRef.current?.contentWindow?.postMessage(
        { type: "corebiz-widget-cmd", action: "open" },
        "*",
      );
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("corebiz:open-chat", onOpenChat);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("corebiz:open-chat", onOpenChat);
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
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
