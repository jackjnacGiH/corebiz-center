import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  hasSupabaseAuthConfig,
  hasSupabaseServiceConfig,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/config";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export async function getSupabaseServerClient() {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  const cookieStore = await cookies();
  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always set cookies. Route handlers can.
          }
        },
      },
    },
  );
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseServiceConfig()) {
    return null;
  }

  if (!adminClient) {
    adminClient = createClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return adminClient;
}

export function getSupabasePublicClient() {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  if (!publicClient) {
    publicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return publicClient;
}
