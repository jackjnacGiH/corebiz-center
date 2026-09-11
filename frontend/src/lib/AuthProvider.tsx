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
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;
const PROFILE_LOAD_TIMEOUT_MS = 10_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

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
      p = await withTimeout(
        fetchProfile(s.user.id),
        PROFILE_LOAD_TIMEOUT_MS,
        'Profile request timed out'
      );
    } catch {
      // Failed or stalled revalidation must release the spinner without
      // retaining access. ProtectedRoute will fail closed to the login page.
      console.error('[auth] Unable to load profile');
    }
    if (version === profileLoadVersion.current) {
      setProfile(p);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;
    const versions = profileLoadVersion;

    const applySession = (s: Session | null) => {
      if (disposed) return;
      window.clearTimeout(bootstrapTimer);
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
    };

    // Neither a browser-storage lock nor a stalled SDK initialization may keep
    // the application on a permanent loading screen.
    const bootstrapTimer = window.setTimeout(() => {
      if (activeSession.current === undefined) {
        console.error('[auth] Session initialization timed out');
        applySession(null);
      }
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    // Subscribe before reading storage so sign-in/out events cannot be missed
    // while the stored session is being read. Supabase calls remain outside the
    // auth callback to avoid the documented onAuthStateChange deadlock.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // getSession may win the bootstrap race. Ignore the later duplicate
      // INITIAL_SESSION event, but always process real auth changes.
      if (
        event === 'INITIAL_SESSION' &&
        activeSession.current !== undefined &&
        activeSession.current?.access_token === s?.access_token &&
        activeSession.current?.user.id === s?.user.id
      ) return;
      applySession(s);
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        if (activeSession.current === undefined) applySession(data.session);
      })
      .catch(() => {
        if (activeSession.current === undefined) applySession(null);
      });

    return () => {
      disposed = true;
      ++versions.current;
      window.clearTimeout(timer);
      window.clearTimeout(bootstrapTimer);
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
