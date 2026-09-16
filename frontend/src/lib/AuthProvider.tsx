import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchProfile, supabase, type Profile, type Session } from './supabase';
import { clearListCache } from './cache';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  profileIssue: 'missing' | 'unavailable' | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;
const PROFILE_LOAD_TIMEOUT_MS = [6_000, 8_000] as const;
const PROFILE_ERROR_RETRY_DELAY_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout: () => void): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(message));
          onTimeout();
        }, timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileIssue, setProfileIssue] = useState<'missing' | 'unavailable' | null>(null);
  const [loading, setLoading] = useState(true);
  const profileLoadVersion = useRef(0);
  const activeSession = useRef<Session | null | undefined>(undefined);
  const profileLoadingFor = useRef<string | null>(null);
  const profileResolvedFor = useRef<string | null>(null);
  const profileUnavailableAt = useRef(0);
  const profileRequest = useRef<AbortController | null>(null);

  const loadProfile = useCallback(async (s: Session | null, version = ++profileLoadVersion.current) => {
    // An auth event can supersede a deferred query before it even starts.
    if (version !== profileLoadVersion.current) return;
    profileLoadingFor.current = s?.user.id ?? null;
    setLoading(true);

    if (!s) {
      if (version === profileLoadVersion.current) {
        profileResolvedFor.current = null;
        setProfile(null);
        setProfileIssue(null);
        setLoading(false);
      }
      return;
    }

    profileRequest.current?.abort();
    let p: Profile | null = null;
    let issue: 'missing' | 'unavailable' | null = null;
    for (const [attempt, timeoutMs] of PROFILE_LOAD_TIMEOUT_MS.entries()) {
      const controller = new AbortController();
      profileRequest.current = controller;
      try {
        p = await withTimeout(
          fetchProfile(s.user.id, controller.signal),
          timeoutMs,
          'Profile request timed out',
          () => controller.abort()
        );
        issue = p ? null : 'missing';
        break;
      } catch (error) {
        if (version !== profileLoadVersion.current) return;
        if (attempt === 0 && error instanceof Error && error.message === 'Profile request timed out') continue;
        // A genuine failure still denies access until a profile is verified.
        issue = 'unavailable';
        console.error('[auth] Unable to load profile', error);
        break;
      } finally {
        if (profileRequest.current === controller) profileRequest.current = null;
        controller.abort();
      }
    }
    if (version === profileLoadVersion.current) {
      profileLoadingFor.current = null;
      profileResolvedFor.current = issue === 'unavailable' ? null : s.user.id;
      profileUnavailableAt.current = issue === 'unavailable' ? Date.now() : 0;
      setProfile(p);
      setProfileIssue(issue);
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
      profileRequest.current?.abort();
      // List requests are shared only within one authenticated identity. Clear
      // both cached results and pending reads before the next user can mount.
      if (activeSession.current === undefined || activeSession.current?.user.id !== s?.user.id) {
        clearListCache();
      }
      activeSession.current = s;
      profileLoadingFor.current = s?.user.id ?? null;
      profileResolvedFor.current = null;
      profileUnavailableAt.current = 0;
      setSession(s);
      setProfile(null);
      setProfileIssue(null);
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
      // SIGNED_IN can also fire when an existing tab regains focus. Reusing
      // the same verified profile avoids blanking the whole app and repeating
      // a query on every focus; a real token refresh still revalidates it.
      const sameUser = !!s && activeSession.current?.user.id === s.user.id;
      if (sameUser && event !== 'USER_UPDATED' && (
        profileLoadingFor.current === s.user.id ||
        ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
          (profileResolvedFor.current === s.user.id ||
            Date.now() - profileUnavailableAt.current < PROFILE_ERROR_RETRY_DELAY_MS))
      )) {
        activeSession.current = s;
        setSession(s);
        return;
      }
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
      profileRequest.current?.abort();
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      profileIssue,
      loading,
      refresh: () => loadProfile(activeSession.current ?? null),
    }),
    [session, profile, profileIssue, loading, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
