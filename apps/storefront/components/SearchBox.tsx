"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBox({
  initial = "",
  variant = "page",
  className = "",
  autoFocus = false,
}: {
  initial?: string;
  variant?: "nav" | "page";
  className?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    router.push(t ? `/search?q=${encodeURIComponent(t)}` : "/search");
  };

  const input =
    variant === "nav"
      ? "w-full rounded-full border border-white/15 bg-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder-white/50 outline-none transition focus:border-white focus:bg-white focus:text-neutral-800 focus:placeholder-neutral-400"
      : "w-full rounded-full border border-neutral-300 bg-white py-3 pl-11 pr-4 text-sm text-neutral-800 placeholder-neutral-400 outline-none transition focus:border-[#1696F4] focus:ring-2 focus:ring-[#1696F4]/30";
  const icon = variant === "nav" ? "left-3 h-4 w-4 text-white/60" : "left-4 h-5 w-5 text-neutral-400";

  return (
    <form role="search" onSubmit={submit} className={`relative ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${icon}`}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหาสินค้า หรือรหัส SKU…"
        aria-label="ค้นหาสินค้า"
        autoFocus={autoFocus}
        enterKeyHint="search"
        className={input}
      />
    </form>
  );
}
