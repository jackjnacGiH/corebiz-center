import { supabase } from "./supabase";
import type { ShippingRate } from "../../../supabase/functions/_shared/shipping-rates";
import {
  isShippingProviderIssue,
  type ShippingProviderIssue,
} from "../../../supabase/functions/_shared/shipping-errors";
import type {
  Shipment,
  ShippingDraft,
  ShippingAddress,
  ShippingDraftFieldIssue,
} from "../../../supabase/functions/_shared/shipping-domain";
import { isShippingDraftFieldIssue } from "../../../supabase/functions/_shared/shipping-domain";
export type {
  Shipment,
  ShippingDraft,
  ShippingAddress,
} from "../../../supabase/functions/_shared/shipping-domain";
export interface ShippingSettings {
  environment: "uat" | "production";
  billing_mode: "unconfirmed" | "prepaid" | "postpaid";
  merchant_code: string;
  origin: ShippingAddress;
}
export interface CodAccount {
  id: string;
  label: string;
  provider_account_id?: string;
  active?: boolean;
}
export interface ShippingBootstrap {
  manager: boolean;
  settings: ShippingSettings;
  brand: { name: string; logo_url: string | null };
  accounts: CodAccount[];
  readReady: boolean;
  sendReady: boolean;
}
export interface ShippingInitial {
  bootstrap: ShippingBootstrap;
  shipments: Shipment[];
  count: number;
}
export interface ShippingConnectionTest {
  environment: "uat" | "production";
  checked_at: string;
  hmac: { ok: boolean; message?: string };
  merchant: { ok: boolean; code?: string; message?: string };
  carriers: { ok: boolean; count: number; message?: string };
  rate_test: {
    ok: boolean;
    carrier_code?: string;
    total?: string;
    currency?: string;
    message?: string;
  };
  blockers: {
    billing: boolean;
    wallet: boolean | null;
    carrier: boolean | null;
    mutations: boolean;
    details?: string[];
  };
  ready: boolean;
}
export interface ShippingUser {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
}
export interface ShippingEvent {
  operation: string;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
}
export interface ShippingRecipientOption {
  id: string;
  source: "history" | "customer";
  address: ShippingAddress;
}
export interface ShippingProductOption {
  id: string;
  code: string;
  name: string;
  weight: number;
}
export class ShippingApiError extends Error {
  shipment: Shipment | null;
  detail: ShippingProviderIssue | null;
  fieldIssue: ShippingDraftFieldIssue | null;
  constructor(
    code: string,
    shipment: Shipment | null = null,
    detail: ShippingProviderIssue | null = null,
    fieldIssue: ShippingDraftFieldIssue | null = null,
  ) {
    super(code);
    this.name = "ShippingApiError";
    this.shipment = shipment;
    this.detail = detail;
    this.fieldIssue = fieldIssue;
  }
}
const shipmentFromError = (value: unknown): Shipment | null => {
  if (!value || typeof value !== "object") return null;
  const shipment = (value as { shipment?: unknown }).shipment;
  if (
    !shipment || typeof shipment !== "object" ||
    typeof (shipment as Shipment).id !== "string" ||
    !Number.isInteger((shipment as Shipment).version) ||
    typeof (shipment as Shipment).status !== "string" ||
    !(shipment as Shipment).draft || typeof (shipment as Shipment).draft !== "object"
  ) return null;
  return shipment as Shipment;
};
const detailFromError = (value: unknown): ShippingProviderIssue | null => {
  if (!value || typeof value !== "object") return null;
  const detail = (value as { detail?: unknown }).detail;
  return isShippingProviderIssue(detail) ? detail : null;
};
const fieldIssueFromError = (value: unknown): ShippingDraftFieldIssue | null => {
  if (!value || typeof value !== "object") return null;
  const issue = (value as { field_issue?: unknown }).field_issue;
  if (!isShippingDraftFieldIssue(issue)) return null;
  return {
    field: issue.field,
    reason: issue.reason,
    ...(issue.index === undefined ? {} : { index: issue.index }),
    ...(issue.limit === undefined ? {} : { limit: issue.limit }),
  };
};
async function invoke<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("shipping-api", {
    body: { action, ...payload },
  });
  if (error) {
    let code = "shipping_not_installed";
    let responseBody: unknown = null;
    try {
      const body = await error.context?.json();
      responseBody = body;
      if (typeof body?.error === "string") code = body.error;
    } catch {
      /* Generic error only. */
    }
    throw new ShippingApiError(
      code,
      shipmentFromError(responseBody),
      detailFromError(responseBody),
      fieldIssueFromError(responseBody),
    );
  }
  if (data?.error)
    throw new ShippingApiError(
      String(data.error),
      shipmentFromError(data),
      detailFromError(data),
      fieldIssueFromError(data),
    );
  return data as T;
}
export const shippingApi = {
  initial: (page: number, search: string) =>
    invoke<ShippingInitial>("initial", { page, search }),
  bootstrap: () => invoke<ShippingBootstrap>("bootstrap"),
  compare: (draft: ShippingDraft) => invoke<{ rates: ShippingRate[]; parcel_count: number; quoted_at: string }>("compare_rates", { draft }),
  list: (page: number, search: string) =>
    invoke<{ shipments: Shipment[]; count: number }>("list", { page, search }),
  get: (id: string) =>
    invoke<{ shipment: Shipment; events: ShippingEvent[] }>("get", { id }),
  create: (id: string, draft: ShippingDraft, order_id: string | null) =>
    invoke<{ shipment: Shipment }>("create_draft", { id, draft, order_id }),
  save: (s: Shipment, draft: ShippingDraft) =>
    invoke<{ shipment: Shipment }>("save_draft", {
      id: s.id,
      version: s.version,
      draft,
    }),
  action: (action: "archive" | "submit" | "refresh_status", s: Shipment) =>
    invoke<{ shipment: Shipment }>(action, { id: s.id, version: s.version }),
  print: (s: Shipment) => invoke<{ link: string }>("print", { id: s.id }),
  quote: (s: Shipment) =>
    invoke<{
      rates: {
        carrier: string;
        carrier_code: string;
        total: string;
        delivery_time: string;
      }[];
    }>("quote", { id: s.id }),
  orderOptions: (search: string) =>
    invoke<{ orders: { id: string; code: string }[] }>("order_options", {
      search,
    }),
  recipientOptions: (search: string) =>
    invoke<{ recipients: ShippingRecipientOption[] }>("recipient_options", {
      search,
    }),
  productOptions: (search: string) =>
    invoke<{ products: ShippingProductOption[] }>("product_options", {
      search,
    }),
  orderDraft: (order_id: string) =>
    invoke<{
      draft: ShippingDraft;
      order_code: string;
      previous: { reference_no: string; status: string }[];
    }>("order_draft", { order_id }),
  saveSettings: (settings: ShippingSettings) =>
    invoke("save_settings", { settings }),
  connectionTest: () =>
    invoke<ShippingConnectionTest>("connection_test"),
  admin: (page: number) =>
    invoke<{
      users: ShippingUser[];
      grants: { user_id: string }[];
      accounts: CodAccount[];
    }>("admin_data", { page }),
  permission: (user_id: string, enabled: boolean) =>
    invoke(enabled ? "grant" : "revoke", { user_id }),
  saveCod: (account: CodAccount) => invoke("save_cod", { account }),
};
