import { supabase } from './supabase';

// App base path ('/center/') — admin app is mounted under /center. Auth
// redirect URLs must include it so OAuth/email links land back in the app.
const BASE = import.meta.env.BASE_URL; // e.g. '/center/'
const appUrl = (p: string) => `${window.location.origin}${BASE}${p.replace(/^\//, '')}`;

const LINE_CHANNEL_ID = import.meta.env.VITE_LINE_CHANNEL_ID as string | undefined;
const LINE_CALLBACK_URL = (import.meta.env.VITE_LINE_CALLBACK_URL as string | undefined)
  ?? appUrl('auth/line-callback');

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string, fullName?: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName ?? null },
      emailRedirectTo: appUrl('auth/callback'),
    },
  });
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: appUrl('auth/callback'),
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
}

/**
 * LINE Login — NOT a native Supabase provider.
 * Flow:
 *   1) Redirect user to LINE authorize endpoint
 *   2) LINE → callback page (frontend) with `code`
 *   3) Frontend posts code to Supabase Edge Function `line-auth`
 *   4) Edge Function exchanges code, gets LINE profile, finds/creates
 *      Supabase user via admin API, returns a Supabase session
 *   5) Frontend stores session via supabase.auth.setSession()
 *
 * Edge function will be added in phase 0.5 (deferred).
 */
export function signInWithLine() {
  if (!LINE_CHANNEL_ID) {
    throw new Error('VITE_LINE_CHANNEL_ID is not configured');
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem('line_oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: LINE_CALLBACK_URL,
    state,
    scope: 'profile openid email',
  });

  window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = appUrl('login');
}
