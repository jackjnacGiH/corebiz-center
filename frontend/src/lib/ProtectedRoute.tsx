import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { ReactNode } from 'react';
import type { AppRole } from './supabase';

interface Props {
  children: ReactNode;
  /** If set, only these roles can access. Otherwise any authenticated staff. */
  roles?: AppRole[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { session, profile, loading } = useAuth();
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

  if (!profile?.is_active) {
    return <Navigate to="/login?error=inactive" replace />;
  }

  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" state={{ error: 'forbidden' }} replace />;
  }

  return <>{children}</>;
}
