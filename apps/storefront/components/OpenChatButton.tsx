"use client";

import type { CSSProperties, ReactNode } from "react";

/** A CTA that pops the on-page เอย chat widget open (via the ChatWidget host),
 *  instead of navigating to the full /widget page. */
export default function OpenChatButton({
  className,
  style,
  children,
  ariaLabel,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => window.dispatchEvent(new Event("corebiz:open-chat"))}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
}
