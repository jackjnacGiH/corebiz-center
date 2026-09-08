// Pure domain code shared by the shipping UI, Edge Function and offline tests.
export interface ShippingAddress {
  fullname: string;
  address: string;
  county: string;
  city: string;
  state: string;
  postcode: string;
  email: string;
  telephone1: string;
}
export interface ShippingItem {
  name: string;
  code: string;
  qty: number;
  price: string;
  weight: number;
}
export interface ShippingDraft {
  purpose: string;
  carrier_code: string;
  origin: ShippingAddress;
  destination: ShippingAddress;
  box_width: number;
  box_height: number;
  box_length: number;
  box_weight: number;
  cod_amount: string;
  cod_account_id: string | null;
  products: ShippingItem[];
}
export type ShippingStatus =
  | "draft"
  | "submitting"
  | "outcome_unknown"
  | "waiting"
  | "on_delivery"
  | "delivered"
  | "on_return"
  | "returned"
  | "claimed"
  | "closed"
  | "canceled"
  | "archived";
export interface Shipment {
  id: string;
  reference_no: string;
  order_id: string | null;
  order_code: string | null;
  draft: ShippingDraft;
  status: ShippingStatus;
  tracking_number: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}
export const emptyAddress = (): ShippingAddress => ({
  fullname: "",
  address: "",
  county: "",
  city: "",
  state: "",
  postcode: "",
  email: "",
  telephone1: "",
});
export const emptyDraft = (): ShippingDraft => ({
  purpose: "",
  carrier_code: "",
  origin: emptyAddress(),
  destination: emptyAddress(),
  box_width: 0,
  box_height: 0,
  box_length: 0,
  box_weight: 0,
  cod_amount: "0.00",
  cod_account_id: null,
  products: [{ name: "", code: "", qty: 1, price: "0.00", weight: 0 }],
});
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export function moneyMinor(v: unknown): number {
  if (typeof v !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(v))
    throw new Error("invalid_money");
  const [whole, fraction = ""] = v.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function text(v: unknown, max: number): string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new Error("invalid_text");
  return v.trim();
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("invalid_payload");
  return v as Record<string, unknown>;
}
function quantity(v: unknown, max: number, integer = false): number {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new Error("invalid_quantity");
  return v;
}
export function addressFrom(v: unknown): ShippingAddress {
  const a = object(v);
  return Object.fromEntries(
    Object.keys(emptyAddress()).map((k) => [
      k,
      text(a[k], k === "address" ? 500 : 150),
    ]),
  ) as unknown as ShippingAddress;
}
// Whitelist fields; never persist caller-supplied status, prices from provider or external IDs.
export function parseDraft(v: unknown): ShippingDraft {
  const d = object(v);
  if (
    !Array.isArray(d.products) ||
    d.products.length < 1 ||
    d.products.length > 100
  )
    throw new Error("invalid_items");
  moneyMinor(d.cod_amount);
  if (d.cod_account_id !== null && !isUuid(d.cod_account_id))
    throw new Error("invalid_cod_account");
  return {
    purpose: text(d.purpose, 300),
    carrier_code: text(d.carrier_code, 80),
    origin: addressFrom(d.origin),
    destination: addressFrom(d.destination),
    box_width: quantity(d.box_width, 1000),
    box_height: quantity(d.box_height, 1000),
    box_length: quantity(d.box_length, 1000),
    box_weight: quantity(d.box_weight, 1000000, true),
    cod_amount: String(d.cod_amount),
    cod_account_id: d.cod_account_id as string | null,
    products: d.products.map((v) => {
      const i = object(v);
      moneyMinor(i.price);
      return {
        name: text(i.name, 100),
        code: text(i.code, 100),
        qty: quantity(i.qty, 100000, true),
        price: String(i.price),
        weight: quantity(i.weight, 1000000, true),
      };
    }),
  };
}
export function readyIssues(d: ShippingDraft): string[] {
  const issues: string[] = [];
  for (const side of ["origin", "destination"] as const) {
    const a = d[side];
    if (Object.values(a).some((v) => !v)) issues.push(`${side}_incomplete`);
    if (!/^\d{5}$/.test(a.postcode)) issues.push(`${side}_postcode`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))
      issues.push(`${side}_email`);
    if (!/^\+?[0-9 -]{9,20}$/.test(a.telephone1)) issues.push(`${side}_phone`);
  }
  if (!d.carrier_code) issues.push("carrier_required");
  if (
    [d.box_width, d.box_height, d.box_length, d.box_weight].some((v) => v <= 0)
  )
    issues.push("parcel_required");
  if (d.products.some((i) => !i.name || i.qty < 1 || i.weight <= 0))
    issues.push("items_incomplete");
  if (moneyMinor(d.cod_amount) > 0 && !d.cod_account_id)
    issues.push("cod_account_required");
  return [...new Set(issues)];
}
export function providerPayload(
  s: Shipment,
  codAccount: string | null,
): Record<string, unknown> {
  if (readyIssues(s.draft).length) throw new Error("shipment_incomplete");
  const { purpose: _purpose, cod_account_id: _account, ...d } = s.draft;
  void _purpose;
  void _account;
  return {
    ...d,
    reference_no: s.reference_no,
    external_id: s.id,
    cod_account: codAccount,
    cod_amount: moneyMinor(d.cod_amount) / 100,
    is_warranty: false,
    product_price: 0,
  };
}
export function canUseShipping(
  profile: { role: string; is_active: boolean } | null,
  granted: boolean,
): boolean {
  return (
    !!profile?.is_active &&
    (["owner", "admin"].includes(profile.role) ||
      (profile.role === "staff" && granted))
  );
}

// Do not apply provider states to orders/payment_status. This reducer is shipment-only.
export function acceptStatus(
  current: ShippingStatus,
  incoming: string,
  currentAt: string | null,
  incomingAt: string,
): boolean {
  const transitions: Record<string, string[]> = {
    waiting: [
      "on_delivery",
      "delivered",
      "on_return",
      "returned",
      "claimed",
      "closed",
      "canceled",
    ],
    on_delivery: ["delivered", "on_return", "returned", "claimed", "closed"],
    delivered: ["on_return", "returned", "claimed", "closed"],
    on_return: ["returned", "claimed", "closed"],
    returned: ["claimed", "closed"],
    claimed: ["closed"],
  };
  const next = Date.parse(incomingAt),
    prev = currentAt ? Date.parse(currentAt) : -Infinity;
  return (
    Number.isFinite(next) &&
    next > prev &&
    (incoming === current || !!transitions[current]?.includes(incoming))
  );
}
