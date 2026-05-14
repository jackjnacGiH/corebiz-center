import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/**
 * LINE OAuth callback page.
 *
 * Flow:
 *   1) LINE redirects here with ?code=...&state=...
 *   2) We validate state, then POST { code } to Supabase Edge Function `line-auth`
 *   3) Edge Function exchanges code → LINE access token → LINE profile
 *      → creates/links Supabase user → returns a Supabase access_token + refresh_token
 *   4) We call supabase.auth.setSession() to log in
 *
 * NOTE: The edge function `line-auth` is deferred to phase 0.5.
 * Until deployed, this page will show a setup-required message.
 */
export default function LineCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'error' | 'unconfigured'>('pending');
  const [message, setMessage] = useState<string>('Verifying LINE login...');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const savedState = sessionStorage.getItem('line_oauth_state');
    sessionStorage.removeItem('line_oauth_state');

    if (!code) {
      setStatus('error');
      setMessage('Missing authorization code from LINE.');
      return;
    }
    if (!state || state !== savedState) {
      setStatus('error');
      setMessage('State mismatch — possible CSRF. Please try logging in again.');
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('line-auth', {
          body: { code },
        });

        if (error) {
          if (error.message.includes('not found') || error.message.includes('404')) {
            setStatus('unconfigured');
            setMessage(
              'LINE Edge Function is not deployed yet. ' +
              'See supabase/functions/line-auth/README.md to set it up.'
            );
            return;
          }
          throw error;
        }

        if (!data?.access_token || !data?.refresh_token) {
          throw new Error('Edge function did not return session tokens');
        }

        const { error: sessErr } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (sessErr) throw sessErr;

        navigate('/', { replace: true });
      } catch (err) {
        setStatus('error');
        setMessage((err as Error).message ?? 'LINE login failed');
      }
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 text-center">
      <div className="max-w-md space-y-3">
        <div className={
          status === 'error' ? 'text-rose-400'
          : status === 'unconfigured' ? 'text-amber-400'
          : 'text-slate-300'
        }>
          {message}
        </div>
        {(status === 'error' || status === 'unconfigured') && (
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            ← Back to login
          </button>
        )}
      </div>
    </div>
  );
}
