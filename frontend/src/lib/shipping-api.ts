import { supabase } from "./supabase";
import type {
  Shipment,
  ShippingDraft,
  ShippingAddress,
} from "../../../supabase/functions/_shared/shipping-domain";
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
async function invoke<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("shipping-api", {
    body: { action, ...payload },
  });
  if (error) {
    let code = "shipping_not_installed";
    try {
      const body = await error.context?.json();
      if (typeof body?.error === "string") code = body.error;
    } catch {
      /* Generic error only. */
    }
    throw new Error(code);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}
export const shippingApi = {
  bootstrap: () => invoke<ShippingBootstrap>("bootstrap"),
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
  orderDraft: (order_id: string) =>
    invoke<{
      draft: ShippingDraft;
      order_code: string;
      previous: { reference_no: string; status: string }[];
    }>("order_draft", { order_id }),
  saveSettings: (settings: ShippingSettings) =>
    invoke("save_settings", { settings }),
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
