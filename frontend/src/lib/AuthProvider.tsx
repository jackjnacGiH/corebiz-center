import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchProfile, supabase, type Profile, type Session } from './supabase';

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

  const loadProfile = async (s: Session | null) => {
    const version = ++profileLoadVersion.current;
    setLoading(true);

    if (!s) {
      if (version === profileLoadVersion.current) {
        setProfile(null);
        setLoading(false);
      }
      return;
    }

    const p = await fetchProfile(s.user.id);
    if (version === profileLoadVersion.current) {
      setProfile(p);
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadProfile(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Keep protected routes in their loading state until the matching profile
      // is ready. Supabase calls made directly inside this callback can deadlock,
      // so defer the profile query until after the auth callback returns.
      setLoading(true);
      window.setTimeout(() => {
        void loadProfile(s);
      }, 0);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      refresh: () => loadProfile(session),
    }),
    [session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
