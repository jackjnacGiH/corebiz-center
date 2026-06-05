export function formatTHB(v: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
}

export function effectivePrice(p: {
  price: number;
  discount_value?: number | null;
  discount_type?: string | null;
}): number {
  const base = Number(p.price || 0);
  const val = Number(p.discount_value || 0);
  if (!val) return base;
  const off = p.discount_type === "percent" ? (base * val) / 100 : val;
  return Math.max(0, base - off);
}
