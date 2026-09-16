import { createClient, type Session, type User } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. ' +
    'Auth and database features will not work. Copy .env.example to .env.local.'
  );
}

export const supabase = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);

export type AppRole = 'owner' | 'admin' | 'staff' | 'agent' | 'viewer' | 'customer';

/**
 * Per-user toggles for which notification categories show in the bell.
 * Stored as jsonb in profiles.notification_prefs.
 */
export interface NotificationPrefs {
  new_order: boolean;
  low_stock: boolean;
  new_customer: boolean;
  weekly_report: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  new_order: true,
  low_stock: true,
  new_customer: true,
  weekly_report: true,
};

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: AppRole;
  language: 'th' | 'en';
  provider: 'email' | 'google' | 'line';
  is_active: boolean;
  notification_prefs: NotificationPrefs;
}

export type { Session, User };

export async function fetchProfile(userId: string, signal: AbortSignal, accessToken: string): Promise<Profile | null> {
  // The Supabase data client awaits auth.getSession() before it starts fetch(),
  // so its abortSignal cannot interrupt a stalled browser session lock.
  // Use the session already verified by AuthProvider; PostgREST still enforces RLS.
  const endpoint = new URL('/rest/v1/profiles', url ?? 'http://localhost:54321');
  endpoint.searchParams.set('select', 'id,email,full_name,phone,avatar_url,role,language,provider,is_active,notification_prefs');
  endpoint.searchParams.set('id', `eq.${userId}`);
  endpoint.searchParams.set('limit', '1');
  const response = await fetch(endpoint, {
    signal,
    cache: 'no-store',
    headers: {
      apikey: anonKey ?? 'public-anon-key',
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Profile request failed (${response.status})`);

  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid profile response');
  const data = rows[0] as Profile | undefined;
  if (!data) return null;
  if (data.id !== userId || typeof data.is_active !== 'boolean') throw new Error('Invalid profile response');
  // Merge defaults so any missing keys (older rows) read as enabled
  const rawPrefs = (data.notification_prefs as Partial<NotificationPrefs> | null) ?? {};
  return {
    ...data,
    notification_prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...rawPrefs },
  } as Profile;
}
