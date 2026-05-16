import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * LINE OAuth callback page.
 *
 * Flow:
 *   1) LINE redirects here with ?code=...&state=...
 *   2) We validate state, then POST { code } to Supabase Edge Function `line-auth`
 *   3) Edge Function exchanges code → LINE access token → LINE profile
 *      → creates/links Supabase user → returns a Supabase access_token + refresh_token
 *   4) We call supabase.auth.setSession() to log in
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
                                'See supabase/functions/line-auth/README.md to set it up.',
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

    const iconColor =
        status === 'error'
            ? 'text-red-600'
            : status === 'unconfigured'
              ? 'text-amber-600'
              : 'text-indigo-600';

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-12">
            <Card className="w-full max-w-md gap-0 py-0 overflow-hidden">
                <CardContent className="px-6 py-8 text-center space-y-4">
                    <div
                        className={cn(
                            'mx-auto w-14 h-14 rounded-full grid place-items-center',
                            status === 'pending' && 'bg-indigo-50',
                            status === 'error' && 'bg-red-50',
                            status === 'unconfigured' && 'bg-amber-50',
                        )}
                    >
                        {status === 'pending' && (
                            <Loader2 size={26} className={cn('animate-spin', iconColor)} />
                        )}
                        {status === 'error' && (
                            <AlertCircle size={26} className={iconColor} />
                        )}
                        {status === 'unconfigured' && (
                            <AlertTriangle size={26} className={iconColor} />
                        )}
                    </div>

                    <div>
                        <h1 className="text-base font-semibold text-neutral-900">
                            {status === 'pending'
                                ? 'กำลังเข้าสู่ระบบด้วย LINE'
                                : status === 'error'
                                  ? 'LINE Login ผิดพลาด'
                                  : 'ยังไม่ได้ตั้งค่า LINE Login'}
                        </h1>
                        <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                            {message}
                        </p>
                    </div>

                    {(status === 'error' || status === 'unconfigured') && (
                        <Button
                            variant="outline"
                            onClick={() => navigate('/login')}
                            className="gap-2"
                        >
                            <ArrowLeft size={14} />
                            กลับไปหน้าเข้าสู่ระบบ
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
