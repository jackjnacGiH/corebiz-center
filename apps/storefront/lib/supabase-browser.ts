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
