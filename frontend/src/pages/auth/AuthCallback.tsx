import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
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
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
            <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 size={28} className="animate-spin text-indigo-600" />
                <div className="text-sm font-medium text-neutral-700">
                    Signing you in...
                </div>
                <div className="text-xs text-neutral-500">
                    กำลังตรวจสอบสถานะการเข้าสู่ระบบ
                </div>
            </div>
        </div>
    );
}
