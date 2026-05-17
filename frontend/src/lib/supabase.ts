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

export type AppRole = 'owner' | 'admin' | 'staff' | 'agent' | 'customer';

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
}

export type { Session, User };

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, avatar_url, role, language, provider, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[supabase] fetchProfile error', error);
    return null;
  }
  return data as Profile | null;
}
