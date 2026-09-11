import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { ReactNode } from 'react';
import type { AppRole } from './supabase';
import { useLanguage } from '../i18n';

interface Props {
  children: ReactNode;
  /** If set, only these roles can access. Otherwise any authenticated staff. */
  roles?: AppRole[];
}

/** Back-office roles. Anyone else (e.g. role 'customer') is shop-only: their
 *  account exists to drive customer-tier (Tier) benefits on the storefront —
 *  the /center admin app stays off-limits even when logged in. */
const STAFF_ROLES: AppRole[] = ['owner', 'admin', 'staff', 'agent', 'viewer'];

function ProfileAccessMessage({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div role="alert" className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-[var(--primary-500)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          {retryLabel}
        </button>
      </div>
    </main>
  );
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, profileIssue, loading, refresh } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-400 text-sm">
        Loading...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profileIssue === 'unavailable') {
    return (
      <ProfileAccessMessage
        title={t.auth.profileUnavailableTitle}
        message={t.auth.profileUnavailable}
        retryLabel={t.auth.tryAgain}
        onRetry={() => void refresh()}
      />
    );
  }

  if (profileIssue === 'missing') {
    return (
      <ProfileAccessMessage
        title={t.auth.profileMissingTitle}
        message={t.auth.profileMissing}
        retryLabel={t.auth.tryAgain}
        onRetry={() => void refresh()}
      />
    );
  }

  if (profile?.is_active === false) {
    return <Navigate to="/login?error=inactive" replace />;
  }

  // A signed-in request must never enter the admin application until a
  // positive, active profile has been loaded.
  if (!profile) return null;

  if (!STAFF_ROLES.includes(profile.role)) {
    // Customer (or unknown role): straight to their portal ("บัญชีของฉัน") so
    // logging in lands them somewhere useful, not the shop home page.
    // Full-page redirect — Navigate can't escape the /center router basename.
    window.location.replace('/account');
    return null;
  }

  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" state={{ error: 'forbidden' }} replace />;
  }

  return <>{children}</>;
}
