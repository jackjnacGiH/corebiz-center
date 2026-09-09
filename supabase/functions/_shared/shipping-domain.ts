// Pure domain code shared by the shipping UI, Edge Function and offline tests.
export interface ShippingAddress {
  company?: string;
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
export interface ShippingParcel {
  box_width: number;
  box_height: number;
  box_length: number;
  box_weight: number;
}
export interface ShippingDraft {
  parcels?: ShippingParcel[];
  purpose: string;
  handling_note: string;
  carrier_code: string;
  origin: ShippingAddress;
  destination: ShippingAddress;
  box_width: number;
  box_height: number;
  box_length: number;
  box_weight: number;
  parcel_total: number;
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
  recipient_company?: string;
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
  company: "",
  fullname: "",
  address: "",
  county: "",
  city: "",
  state: "",
  postcode: "",
  email: "",
  telephone1: "",
});
const sameName = (a: string, b: string) =>
  a.replace(/[\s.,()]/g, "").toLocaleLowerCase("th") ===
  b.replace(/[\s.,()]/g, "").toLocaleLowerCase("th");
const organizationName = (name: string) =>
  /^(บริษัท|ห้างหุ้นส่วน|หจก\.?|บจก\.?|บมจ\.?|หน่วยงาน|สำนักงาน|โรงเรียน|โรงพยาบาล|มหาวิทยาลัย|เทศบาล|องค์การ)/.test(name) ||
  /\b(company|co\.?\s*,?\s*ltd\.?|limited|corporation|corp\.?|inc\.?|llc)\b/i.test(name);

// Repair unambiguous legacy company/contact mix-ups without inventing a person.
// Conflicting company names are left intact for staff to review.
export function normalizeShippingContact(address: ShippingAddress): ShippingAddress {
  let company = (address.company ?? "").trim();
  let fullname = address.fullname.trim();
  if (company && fullname && sameName(company, fullname)) {
    if (/^(คุณ|นาย|นางสาว|นาง)\s*\S/.test(fullname) && !organizationName(fullname)) company = "";
    else fullname = "";
  } else if (!company && organizationName(fullname)) {
    company = fullname;
    fullname = "";
  }
  return { ...address, company, fullname };
}

export function recipientAddress(
  value: unknown,
  fallback: Record<string, unknown> = {},
): ShippingAddress {
  const a = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const small = (v: unknown, max = 150) => typeof v === "string" ? v.trim().slice(0, max) : "";
  const address = normalizeShippingContact({
    company: small(a.company) || small(a.company_name) || small(fallback.company),
    fullname: small(a.fullname ?? a.contact_name ?? a.name),
    address: small(a.address ?? a.line ?? a.line1 ?? (typeof value === "string" ? value : ""), 500),
    county: small(a.county ?? a.subdistrict),
    city: small(a.city ?? a.district),
    state: small(a.state ?? a.province),
    postcode: small(a.postcode ?? a.postal_code),
    email: small(a.email ?? fallback.email),
    telephone1: small(a.telephone1 ?? a.phone ?? fallback.telephone1 ?? fallback.phone),
  });
  const fallbackContact = normalizeShippingContact({
    ...emptyAddress(), company: address.company, fullname: small(fallback.fullname),
  });
  // A real contact in the saved delivery address takes precedence over CRM.
  return normalizeShippingContact({
    ...address,
    fullname: address.fullname || (organizationName(fallbackContact.fullname) ? "" : fallbackContact.fullname),
  });
}

export function shipmentWithContactFields(s: Shipment): Shipment {
  if (s.status !== "draft") return s; // Keep submitted shipment snapshots unchanged.
  return { ...s, draft: { ...s.draft,
    origin: normalizeShippingContact(s.draft.origin),
    destination: normalizeShippingContact(s.draft.destination),
  } };
}
export const emptyDraft = (): ShippingDraft => ({
  purpose: "",
  handling_note: "กรุณาอย่าโยน • ระวังของแตก",
  carrier_code: "",
  origin: emptyAddress(),
  destination: emptyAddress(),
  box_width: 0,
  box_height: 0,
  box_length: 0,
  box_weight: 0,
  parcel_total: 1,
  cod_amount: "0.00",
  cod_account_id: null,
  products: [{ name: "", code: "", qty: 1, price: "0.00", weight: 0 }],
});
export const emptyParcel = (): ShippingParcel => ({
  box_width: 0, box_height: 0, box_length: 0, box_weight: 0,
});
export function shippingParcels(d: ShippingDraft): ShippingParcel[] {
  if (d.parcels?.length) return d.parcels;
  const count = Math.max(1, Math.min(99, Math.trunc(d.parcel_total || 1)));
  return Array.from({ length: count }, (_, index) => index === 0 ? {
    box_width: d.box_width, box_height: d.box_height,
    box_length: d.box_length, box_weight: d.box_weight,
  } : emptyParcel());
}
export function shippingQuoteKey(d: ShippingDraft): string {
  return JSON.stringify({
    areas: [d.origin, d.destination].map((a) => [a.county, a.city, a.state, a.postcode]),
    parcels: shippingParcels(d).map((p) => [p.box_width, p.box_height, p.box_length, p.box_weight]),
  });
}
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
  return normalizeShippingContact(Object.fromEntries(
    Object.keys(emptyAddress()).map((k) => [
      k,
      text(k === "company" ? a[k] ?? "" : a[k], k === "address" ? 500 : 150),
    ]),
  ) as unknown as ShippingAddress);
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
  const parcelTotal = quantity(d.parcel_total ?? 1, 99, true);
  if (parcelTotal < 1) throw new Error("invalid_quantity");
  let parcels: ShippingParcel[] | undefined;
  if (d.parcels !== undefined) {
    if (!Array.isArray(d.parcels) || d.parcels.length !== parcelTotal)
      throw new Error("invalid_parcels");
    parcels = d.parcels.map((value) => {
      const parcel = object(value);
      return {
        box_width: quantity(parcel.box_width, 1000),
        box_height: quantity(parcel.box_height, 1000),
        box_length: quantity(parcel.box_length, 1000),
        box_weight: quantity(parcel.box_weight, 1000000, true),
      };
    });
  }
  return {
    ...(parcels ? { parcels } : {}),
    purpose: text(d.purpose, 300),
    // Optional for backwards compatibility with drafts saved before labels existed.
    handling_note: text(d.handling_note ?? "", 120),
    carrier_code: text(d.carrier_code, 80),
    origin: addressFrom(d.origin),
    destination: addressFrom(d.destination),
    box_width: quantity(parcels?.[0].box_width ?? d.box_width, 1000),
    box_height: quantity(parcels?.[0].box_height ?? d.box_height, 1000),
    box_length: quantity(parcels?.[0].box_length ?? d.box_length, 1000),
    box_weight: quantity(parcels?.[0].box_weight ?? d.box_weight, 1000000, true),
    parcel_total: parcelTotal,
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
export function parseDraftUpdate(value: unknown, previous: ShippingDraft): ShippingDraft {
  const input = object(value);
  if (previous.parcels?.length && !("parcels" in input)) throw new Error("client_outdated");
  const preserveCompany = (side: "origin" | "destination") => {
    const address = object(input[side]);
    return { ...address, company: "company" in address ? address.company : previous[side].company ?? "" };
  };
  return parseDraft({ ...input, origin: preserveCompany("origin"), destination: preserveCompany("destination") });
}
export type QuoteIssue =
  | `${"origin" | "destination"}_${"county" | "city" | "state" | "postcode"}`
  | "carrier_required"
  | "box_width"
  | "box_height"
  | "box_length"
  | "box_weight"
  | "parcels_incomplete";

// Rates use the delivery area and packed parcel, before shipment/COD setup.
export function quoteIssues(d: ShippingDraft): QuoteIssue[] {
  const issues: QuoteIssue[] = [];
  const parcels = shippingParcels(d);
  for (const side of ["origin", "destination"] as const) {
    for (const field of ["county", "city", "state"] as const)
      if (!d[side][field].trim()) issues.push(`${side}_${field}`);
    if (!/^\d{5}$/.test(d[side].postcode)) issues.push(`${side}_postcode`);
  }
  for (const field of ["box_width", "box_height", "box_length", "box_weight"] as const)
    if (!Number.isFinite(parcels[0][field]) || parcels[0][field] <= 0) issues.push(field);
  if (parcels.slice(1).some((parcel) => Object.values(parcel).some((v) => !Number.isFinite(v) || v <= 0)))
    issues.push("parcels_incomplete");
  return issues;
}

export function quotePayload(
  d: ShippingDraft,
  carrierCodes = [d.carrier_code],
  parcel: ShippingParcel = shippingParcels(d)[0],
): Record<string, unknown> {
  if (quoteIssues(d).length) throw new Error("quote_incomplete");
  if (!carrierCodes.length || carrierCodes.some((code) => !code.trim()))
    throw new Error("carrier_required");
  const area = ({ county, city, state, postcode }: ShippingAddress) => ({
    county, city, state, postcode,
  });
  return {
    ...parcel,
    carriers_code: carrierCodes,
    origin: area(d.origin),
    destination: area(d.destination),
  };
}

export function readyIssues(d: ShippingDraft): string[] {
  const issues: string[] = [];
  if (d.parcel_total > 1) issues.push("multi_parcel_submission_unavailable");
  for (const side of ["origin", "destination"] as const) {
    const a = normalizeShippingContact(d[side]);
    if (organizationName(a.fullname) || [a.fullname, a.address, a.county, a.city, a.state, a.postcode, a.email, a.telephone1].some((v) => !v))
      issues.push(`${side}_incomplete`);
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
  const {
    purpose: _purpose,
    handling_note: _handlingNote,
    parcel_total: _parcelTotal,
    parcels: _parcels,
    cod_account_id: _account,
    ...d
  } = s.draft;
  void _purpose;
  void _handlingNote;
  void _parcelTotal;
  void _parcels;
  void _account;
  return {
    ...d,
    origin: providerAddress(d.origin),
    destination: providerAddress(d.destination),
    reference_no: s.reference_no,
    external_id: s.id,
    cod_account: codAccount,
    cod_amount: moneyMinor(d.cod_amount) / 100,
    is_warranty: false,
    product_price: 0,
  };
}
function providerAddress({ company, ...a }: ShippingAddress): ShippingAddress {
  return {
    ...a,
    fullname: company && company !== a.fullname
      ? `${company} / ${a.fullname}`.slice(0, 150)
      : a.fullname,
  };
}

export function summarizeShippingItems(items: ShippingItem[], visibleLimit = 5) {
  return {
    visible: items.slice(0, visibleLimit),
    remainingItems: Math.max(0, items.length - visibleLimit),
    remainingQuantity: items.slice(visibleLimit).reduce((sum, item) => sum + item.qty, 0),
    totalQuantity: items.reduce((sum, item) => sum + item.qty, 0),
  };
}

// Quote literal filter values before Supabase URL-encodes them.
export function shipmentSearchFilter(value: string): string | null {
  const search = value.trim().slice(0, 80).replace(/[%_*]/g, "");
  if (!search) return null;
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const pattern = quote(`%${search}%`);
  const fields = [
    "reference_no", "order_code", "tracking_number",
    "draft->destination->>fullname", "draft->destination->>company",
    "draft->destination->>address", "draft->destination->>telephone1",
  ];
  const filters = fields.map((field) => `${field}.ilike.${pattern}`);
  if (/^[+\d\s()-]+$/.test(search)) {
    const digits = search.replace(/\D/g, "");
    if (digits.length >= 3)
      filters.push(`draft->destination->>telephone1.ilike.${quote(`%${digits.split("").join("%")}%`)}`);
  }
  return filters.join(",");
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
