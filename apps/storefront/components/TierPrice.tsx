"use client";

import { useEffect, useState } from "react";
import { getPortalProfile, type PortalProfile } from "@/lib/supabase-browser";

/**
 * Member price hint on product pages. For a logged-in customer linked to a
 * CRM customer row with a tier discount (Silver/Gold/VIP), shows the price
 * after their member discount. Hidden for guests / general tier — the public
 * static price stays untouched (pages remain fully static/ISR).
 */
export default function TierPrice({ price }: { price: number }) {
  const [p, setP] = useState<PortalProfile | null>(null);

  useEffect(() => {
    let mounted = true;
    getPortalProfile().then((prof) => { if (mounted) setP(prof); });
    return () => { mounted = false; };
  }, []);

  if (!p || Number(p.discount_percent) <= 0 || price <= 0) return null;

  const pct = Number(p.discount_percent);
  const member = price * (1 - pct / 100);
  const fmt = (n: number) =>
    "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
      <span className="text-xs font-bold text-emerald-800">
        ราคาสมาชิก {p.tier_label} (−{pct}%)
      </span>
      <span className="text-lg font-extrabold text-emerald-700 tabular-nums">{fmt(member)}</span>
      <span className="text-[11px] text-emerald-600">ประหยัด {fmt(price - member)} · คำนวณในใบเสนอราคา</span>
    </div>
  );
}
