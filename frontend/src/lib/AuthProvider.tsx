import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchProfile, supabase, type Profile, type Session } from './supabase';
import { clearListCache } from './cache';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileLoadVersion = useRef(0);
  const activeSession = useRef<Session | null | undefined>(undefined);

  const loadProfile = useCallback(async (s: Session | null, version = ++profileLoadVersion.current) => {
    // An auth event can supersede a deferred query before it even starts.
    if (version !== profileLoadVersion.current) return;
    setLoading(true);

    if (!s) {
      if (version === profileLoadVersion.current) {
        setProfile(null);
        setLoading(false);
      }
      return;
    }

    let p: Profile | null = null;
    try {
      p = await fetchProfile(s.user.id);
    } catch {
      // Failed revalidation must release the spinner without retaining access.
      console.error('[auth] Unable to load profile');
    }
    if (version === profileLoadVersion.current) {
      setProfile(p);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const versions = profileLoadVersion;
    // INITIAL_SESSION already supplies the stored session. A parallel getSession
    // bootstrap would read the same profile twice and race newer auth events.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const version = ++versions.current;
      // List requests are shared only within one authenticated identity. Clear
      // both cached results and pending reads before the next user can mount.
      if (activeSession.current === undefined || activeSession.current?.user.id !== s?.user.id) {
        clearListCache();
      }
      activeSession.current = s;
      setSession(s);
      setProfile(null);
      // Keep protected routes in their loading state until the matching profile
      // is ready. Supabase calls made directly inside this callback can deadlock,
      // so defer the profile query until after the auth callback returns.
      setLoading(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadProfile(s, version);
      }, 0);
    });

    return () => {
      ++versions.current;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      refresh: () => loadProfile(activeSession.current ?? null),
    }),
    [session, profile, loading, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
