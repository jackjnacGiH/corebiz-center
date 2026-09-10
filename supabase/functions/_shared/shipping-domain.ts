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
export const SHIPPING_BOX_DIMENSION_MAX_CM = 180;
const BOX_DIMENSION_FIELDS = ["box_width", "box_height", "box_length"] as const;

export const SHIPPING_DRAFT_FIELD_NAMES = [
  "draft",
  "purpose",
  "handling_note",
  "carrier_code",
  "origin",
  "origin.company",
  "origin.fullname",
  "origin.address",
  "origin.county",
  "origin.city",
  "origin.state",
  "origin.postcode",
  "origin.email",
  "origin.telephone1",
  "destination",
  "destination.company",
  "destination.fullname",
  "destination.address",
  "destination.county",
  "destination.city",
  "destination.state",
  "destination.postcode",
  "destination.email",
  "destination.telephone1",
  "box_width",
  "box_height",
  "box_length",
  "box_weight",
  "parcel_total",
  "parcels",
  "parcels.box_width",
  "parcels.box_height",
  "parcels.box_length",
  "parcels.box_weight",
  "cod_amount",
  "cod_account_id",
  "products",
  "products.name",
  "products.code",
  "products.qty",
  "products.price",
  "products.weight",
] as const;
export type ShippingDraftFieldName = typeof SHIPPING_DRAFT_FIELD_NAMES[number];

export const SHIPPING_DRAFT_FIELD_REASONS = [
  "missing_object",
  "invalid_array",
  "invalid_count",
  "count_mismatch",
  "invalid_text_type",
  "text_too_long",
  "unsupported_text_character",
  "invalid_number_type",
  "number_below_zero",
  "number_below_one",
  "number_above_max",
  "whole_number_required",
  "invalid_money_format",
  "invalid_identifier",
] as const;
export type ShippingDraftFieldReason = typeof SHIPPING_DRAFT_FIELD_REASONS[number];

export interface ShippingDraftFieldIssue {
  field: ShippingDraftFieldName;
  reason: ShippingDraftFieldReason;
  index?: number;
  limit?: number;
}

const SHIPPING_DRAFT_FIELD_SET = new Set<string>(SHIPPING_DRAFT_FIELD_NAMES);
const SHIPPING_DRAFT_REASON_SET = new Set<string>(SHIPPING_DRAFT_FIELD_REASONS);

export function isShippingDraftFieldIssue(value: unknown): value is ShippingDraftFieldIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const issue = value as Record<string, unknown>;
  if (
    typeof issue.field !== "string" || !SHIPPING_DRAFT_FIELD_SET.has(issue.field) ||
    typeof issue.reason !== "string" || !SHIPPING_DRAFT_REASON_SET.has(issue.reason)
  ) return false;
  if (issue.index !== undefined && (
    !Number.isInteger(issue.index) || Number(issue.index) < 0 || Number(issue.index) > 99
  )) return false;
  if (issue.limit !== undefined && (
    typeof issue.limit !== "number" || !Number.isFinite(issue.limit) || issue.limit < 0 || issue.limit > 1000000
  )) return false;
  return true;
}

const legacyDraftErrorCode = (issue: ShippingDraftFieldIssue): string => {
  if (issue.field === "draft") return "invalid_payload";
  if (issue.field === "products") return "invalid_items";
  if (issue.field === "parcels") return "invalid_parcels";
  if (issue.field === "cod_amount" || issue.field === "products.price") return "invalid_money";
  if (issue.field === "cod_account_id") return "invalid_cod_account";
  if (issue.reason.includes("text")) return "invalid_text";
  return "invalid_quantity";
};

export class ShippingDraftFieldError extends Error {
  readonly issue: ShippingDraftFieldIssue;
  constructor(issue: ShippingDraftFieldIssue) {
    super(legacyDraftErrorCode(issue));
    this.name = "ShippingDraftFieldError";
    this.issue = issue;
  }
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

// PromptSpeed accepts phone numbers as digits. Readiness requires that exact
// format; normalization remains as a final safeguard for older saved drafts.
export function normalizeProviderPhone(value: string): string {
  return value.replace(/[\s-]/gu, "").replace(/^\+/, "");
}

export function validProviderPhone(value: string): boolean {
  // PromptSpeed rejects punctuation inconsistently between carriers. Require
  // the exact provider-safe representation in new/edited drafts so staff see
  // the problem before a chargeable create request is sent.
  return /^[0-9]{9,20}$/.test(value);
}

export function validProviderEmail(value: string): boolean {
  const email = value.trim();
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

const draftRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/**
 * Reports every serialization/format problem with a server-generated field
 * name. Values are deliberately omitted so API responses cannot echo customer
 * data or provider credentials back to the browser.
 */
export function draftFormatIssues(value: unknown): ShippingDraftFieldIssue[] {
  const issues: ShippingDraftFieldIssue[] = [];
  const add = (
    field: ShippingDraftFieldName,
    reason: ShippingDraftFieldReason,
    options: Pick<ShippingDraftFieldIssue, "index" | "limit"> = {},
  ) => {
    const issue: ShippingDraftFieldIssue = { field, reason };
    if (options.index !== undefined) issue.index = options.index;
    if (options.limit !== undefined) issue.limit = options.limit;
    issues.push(issue);
  };
  const inspectText = (
    input: unknown,
    field: ShippingDraftFieldName,
    max: number,
    index?: number,
  ) => {
    if (typeof input !== "string") {
      add(field, "invalid_text_type", { index });
      return;
    }
    if (input.length > max) add(field, "text_too_long", { index, limit: max });
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))
      add(field, "unsupported_text_character", { index });
  };
  const inspectQuantity = (
    input: unknown,
    field: ShippingDraftFieldName,
    max: number,
    integer = false,
    minimum = 0,
    index?: number,
  ) => {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      add(field, "invalid_number_type", { index });
      return;
    }
    if (input < minimum)
      add(field, minimum === 1 ? "number_below_one" : "number_below_zero", { index });
    else if (input > max) add(field, "number_above_max", { index, limit: max });
    if (integer && !Number.isInteger(input)) add(field, "whole_number_required", { index });
  };
  const inspectAddress = (input: unknown, side: "origin" | "destination") => {
    const address = draftRecord(input);
    if (!address) {
      add(side, "missing_object");
      return;
    }
    const fields = [
      ["company", 150],
      ["fullname", 150],
      ["address", 500],
      ["county", 150],
      ["city", 150],
      ["state", 150],
      ["postcode", 150],
      ["email", 150],
      ["telephone1", 150],
    ] as const;
    for (const [field, max] of fields)
      inspectText(
        field === "company" || field === "email" ? address[field] ?? "" : address[field],
        `${side}.${field}`,
        max,
      );
  };
  const inspectParcel = (input: unknown, index: number) => {
    const parcel = draftRecord(input);
    if (!parcel) {
      add("parcels", "missing_object", { index });
      return;
    }
    for (const field of BOX_DIMENSION_FIELDS)
      inspectQuantity(
        parcel[field],
        `parcels.${field}`,
        SHIPPING_BOX_DIMENSION_MAX_CM,
        false,
        0,
        index,
      );
    inspectQuantity(parcel.box_weight, "parcels.box_weight", 1000000, true, 0, index);
  };

  const draft = draftRecord(value);
  if (!draft) {
    add("draft", "missing_object");
    return issues;
  }

  inspectText(draft.purpose, "purpose", 300);
  inspectText(draft.handling_note ?? "", "handling_note", 120);
  inspectText(draft.carrier_code, "carrier_code", 80);
  inspectAddress(draft.origin, "origin");
  inspectAddress(draft.destination, "destination");

  inspectQuantity(draft.parcel_total ?? 1, "parcel_total", 99, true, 1);
  const parcelTotal = typeof draft.parcel_total === "number" &&
      Number.isInteger(draft.parcel_total) && draft.parcel_total >= 1 && draft.parcel_total <= 99
    ? draft.parcel_total
    : draft.parcel_total === undefined
      ? 1
      : null;
  if (draft.parcels !== undefined) {
    if (!Array.isArray(draft.parcels)) add("parcels", "invalid_array");
    else {
      if (parcelTotal !== null && draft.parcels.length !== parcelTotal)
        add("parcels", "count_mismatch", { limit: parcelTotal });
      draft.parcels.slice(0, 100).forEach(inspectParcel);
    }
  } else {
    for (const field of BOX_DIMENSION_FIELDS)
      inspectQuantity(draft[field], field, SHIPPING_BOX_DIMENSION_MAX_CM);
    inspectQuantity(draft.box_weight, "box_weight", 1000000, true);
  }

  if (typeof draft.cod_amount !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(draft.cod_amount))
    add("cod_amount", "invalid_money_format");
  if (draft.cod_account_id !== null && !isUuid(draft.cod_account_id))
    add("cod_account_id", "invalid_identifier");

  if (!Array.isArray(draft.products)) add("products", "invalid_array");
  else {
    if (draft.products.length < 1 || draft.products.length > 100)
      add("products", "invalid_count", { limit: 100 });
    draft.products.slice(0, 100).forEach((input, index) => {
      const item = draftRecord(input);
      if (!item) {
        add("products", "missing_object", { index });
        return;
      }
      inspectText(item.name, "products.name", 100, index);
      inspectText(item.code, "products.code", 100, index);
      inspectQuantity(item.qty, "products.qty", 100000, true, 0, index);
      if (typeof item.price !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(item.price))
        add("products.price", "invalid_money_format", { index });
      inspectQuantity(item.weight, "products.weight", 1000000, true, 0, index);
    });
  }
  return issues;
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
      text(k === "company" || k === "email" ? a[k] ?? "" : a[k], k === "address" ? 500 : 150),
    ]),
  ) as unknown as ShippingAddress);
}
// Whitelist fields; never persist caller-supplied status, prices from provider or external IDs.
export function parseDraft(v: unknown): ShippingDraft {
  const fieldIssue = draftFormatIssues(v)[0];
  if (fieldIssue) throw new ShippingDraftFieldError(fieldIssue);
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
        box_width: quantity(parcel.box_width, SHIPPING_BOX_DIMENSION_MAX_CM),
        box_height: quantity(parcel.box_height, SHIPPING_BOX_DIMENSION_MAX_CM),
        box_length: quantity(parcel.box_length, SHIPPING_BOX_DIMENSION_MAX_CM),
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
    box_width: quantity(parcels?.[0].box_width ?? d.box_width, SHIPPING_BOX_DIMENSION_MAX_CM),
    box_height: quantity(parcels?.[0].box_height ?? d.box_height, SHIPPING_BOX_DIMENSION_MAX_CM),
    box_length: quantity(parcels?.[0].box_length ?? d.box_length, SHIPPING_BOX_DIMENSION_MAX_CM),
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
  for (const field of ["box_width", "box_height", "box_length", "box_weight"] as const) {
    const value = parcels[0][field];
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (field !== "box_weight" && value > SHIPPING_BOX_DIMENSION_MAX_CM)
    ) issues.push(field);
  }
  if (parcels.slice(1).some((parcel) =>
    Object.values(parcel).some((value) => !Number.isFinite(value) || value <= 0) ||
    BOX_DIMENSION_FIELDS.some((field) => parcel[field] > SHIPPING_BOX_DIMENSION_MAX_CM)
  ))
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
  const parcels = shippingParcels(d);
  if (d.parcel_total > 1) issues.push("multi_parcel_submission_unavailable");
  for (const side of ["origin", "destination"] as const) {
    const a = normalizeShippingContact(d[side]);
    const hasRecipientName = !!a.fullname || !!a.company;
    const hasRealContactName = !a.fullname || !organizationName(a.fullname);
    if (!hasRecipientName || !hasRealContactName || [a.address, a.county, a.city, a.state, a.postcode, a.telephone1].some((v) => !v))
      issues.push(`${side}_incomplete`);
    if (!/^\d{5}$/.test(a.postcode)) issues.push(`${side}_postcode`);
    if (!validProviderEmail(a.email))
      issues.push(`${side}_email`);
    if (!validProviderPhone(a.telephone1)) issues.push(`${side}_phone`);
  }
  if (!d.carrier_code) issues.push("carrier_required");
  if (
    [parcels[0].box_width, parcels[0].box_height, parcels[0].box_length, parcels[0].box_weight].some((v) =>
      !Number.isFinite(v) || v <= 0
    ) ||
    parcels.some((parcel) => BOX_DIMENSION_FIELDS.some((field) =>
      parcel[field] > SHIPPING_BOX_DIMENSION_MAX_CM
    ))
  )
    issues.push("parcel_required");
  // PromptSpeed rates and shipment readiness use the packed parcel weight.
  // Keep each product's weight in the draft/provider payload for backwards
  // compatibility, but do not require staff to enter it separately.
  if (d.products.some((i) => !i.name || i.qty < 1))
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
function providerAddress(
  { company, telephone1, ...a }: ShippingAddress,
): ShippingAddress {
  const fullname = [company, a.fullname]
    .filter((part, index, parts) => !!part && parts.indexOf(part) === index)
    .join(" / ")
    .slice(0, 150);
  return {
    ...a,
    telephone1: normalizeProviderPhone(telephone1),
    fullname,
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
