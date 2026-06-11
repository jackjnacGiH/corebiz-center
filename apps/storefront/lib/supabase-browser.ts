import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-side client WITH session persistence for the customer portal.
// Uses the default localStorage key (sb-<ref>-auth-token) — the same one the
// CoreBiz admin app at /center writes on login. Same origin → the session a
// customer gets from /center/login is visible to the storefront automatically.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://owoedccmuqnzdtxvywgt.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

// ── Portal profile (tier + customer) ────────────────────────────────────────
export interface PortalProfile {
  customer_id: string;
  code: string;
  name: string;
  customer_type: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  billing_address: unknown;
  shipping_address: unknown;
  tier: "general" | "silver" | "gold" | "vip";
  tier_label: string;
  discount_percent: number;
  point_multiplier: number;
  loyalty_points: number;
  total_spent: number;
  total_orders: number;
  /** This login's contact person (per-user; a company can have many). */
  contact_name: string | null;
  contact_phone: string | null;
  /**
   * True while a tax-id match against an existing CRM customer awaits
   * Owner/Admin approval — the profile shown is the customer's own typed
   * data at general tier; real tier/history stay hidden until approved.
   */
  pending_verification: boolean;
}

// ── Self-registration ────────────────────────────────────────────────────────
export interface RegisterInput {
  contact_name: string;
  tax_id: string;
  phone: string;
  address: string;
  company_name?: string;
}

/**
 * Register / link the logged-in user to a CRM customer by 13-digit tax id.
 * If the tax id matches an existing customer, this login is attached as a
 * contact and that customer's tier + history apply; otherwise a new customer
 * (tier 'general') is created. Returns the customer id, or throws a coded
 * error: 'tax_id_invalid' | 'contact_name_required' | 'unauthorized'.
 */
export interface UpdateProfileInput {
  contact_name: string;
  contact_phone: string;
  company_name?: string;
  company_phone?: string;
  billing_address?: string;
  shipping_address?: string;
}

/**
 * Edit my own info. Contact name/mobile are per-login; company fields update
 * the CRM customer row only when the link is verified (a pending contact only
 * edits its own claimed data). tax_id / email are not editable from the portal.
 */
export async function updateMyCustomer(input: UpdateProfileInput): Promise<void> {
  const sb = supabaseBrowser();
  const { error } = await sb.rpc("update_my_customer", {
    p_contact_name: input.contact_name,
    p_contact_phone: input.contact_phone,
    p_company_name: input.company_name ?? null,
    p_company_phone: input.company_phone ?? null,
    p_billing_address: input.billing_address ?? null,
    p_shipping_address: input.shipping_address ?? null,
  });
  if (error) throw new Error(error.message || "update_failed");
}

export async function registerMyCustomer(input: RegisterInput): Promise<string> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("register_my_customer", {
    p_contact_name: input.contact_name,
    p_tax_id: input.tax_id,
    p_phone: input.phone,
    p_address: input.address,
    p_company_name: input.company_name ?? null,
  });
  if (error) throw new Error(error.message || "register_failed");
  return data as string;
}

// One in-flight/shared lookup per page load — TierPrice on product pages and
// the nav button both need it; don't hit the RPC repeatedly.
let profilePromise: Promise<PortalProfile | null> | null = null;

export function getPortalProfile(force = false): Promise<PortalProfile | null> {
  if (!profilePromise || force) {
    profilePromise = (async () => {
      const sb = supabaseBrowser();
      const { data: sess } = await sb.auth.getSession();
      if (!sess.session) return null;
      // Idempotent: links this auth user to the CRM customer by e-mail once.
      await sb.rpc("link_my_customer_by_email").then(() => undefined, () => undefined);
      const { data, error } = await sb.rpc("my_customer_profile");
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as PortalProfile | undefined) ?? null;
    })();
  }
  return profilePromise;
}
