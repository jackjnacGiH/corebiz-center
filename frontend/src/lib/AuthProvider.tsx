import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  const loadProfile = async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(s.user.id);
    setProfile(p);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadProfile(data.session).finally(() => setLoading(false));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s);
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
