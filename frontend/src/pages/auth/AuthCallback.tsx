import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase processes the URL hash on the client (detectSessionInUrl=true).
    // We just wait for the session to settle then redirect.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate('/', { replace: true });
      } else {
        navigate('/login?error=callback', { replace: true });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen text-slate-400 text-sm">
      Signing you in...
    </div>
  );
}
