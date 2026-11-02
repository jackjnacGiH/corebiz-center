import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/lib/AuthProvider';
import { orgSettingsApi } from '@/lib/api';
import { canSeeSettings } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export default function BotMasterSwitch() {
    const { profile } = useAuth();
    if (!profile || !canSeeSettings(profile.role)) return null;
    return <BotMasterSwitchControl key={profile.id} />;
}

function BotMasterSwitchControl() {
    const { t } = useLanguage();
    const labels = t.chat.masterBot;
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<'read' | 'save' | null>(null);
    const requestVersion = useRef(0);
    const savingRef = useRef(false);

    const load = useCallback(async () => {
        if (savingRef.current) return;
        const version = ++requestVersion.current;
        setLoading(true);
        setError(null);
        try {
            const current = await orgSettingsApi.getBotEnabled();
            if (version === requestVersion.current) setEnabled(current);
        } catch {
            if (version === requestVersion.current) {
                setEnabled(null);
                setError('read');
            }
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        const refresh = () => {
            if (document.visibilityState !== 'hidden') void load();
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            requestVersion.current += 1;
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [load]);

    async function toggle() {
        if (enabled === null || loading || savingRef.current) return;
        const next = !enabled;
        if (!next && !window.confirm(labels.confirmOff)) return;
        savingRef.current = true;
        const version = ++requestVersion.current;
        setLoading(false);
        setSaving(true);
        setError(null);
        try {
            await orgSettingsApi.setBotEnabled(next);
            // A zero-row RLS update can return without an error. Confirm the
            // shared flag before claiming that all channels changed state.
            const confirmed = await orgSettingsApi.getBotEnabled();
            if (version !== requestVersion.current) return;
            setEnabled(confirmed);
            if (confirmed !== next) setError('save');
        } catch {
            if (version === requestVersion.current) {
                setEnabled(null);
                setError('save');
            }
        } finally {
            if (version === requestVersion.current) {
                savingRef.current = false;
                setSaving(false);
            }
        }
    }

    const busy = loading || saving;
    const status = saving ? labels.saving : loading ? labels.loading : enabled === null ? labels.unknown : enabled ? labels.on : labels.off;
    return (
        <div className="relative flex shrink-0 items-center">
            <button
                type="button"
                role={enabled === null ? undefined : 'switch'}
                aria-checked={enabled ?? undefined}
                aria-label={`${labels.title}: ${status}`}
                aria-busy={busy}
                title={`${labels.title}: ${status}`}
                disabled={busy || enabled === null}
                onClick={() => void toggle()}
                className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60',
                    enabled === null ? 'border-neutral-200 bg-neutral-50 text-neutral-500' : enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:ring-emerald-500' : 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100 focus-visible:ring-red-500',
                )}
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                <span className="hidden sm:inline xl:hidden">{labels.shortLabel}: {status}</span>
                <span className="hidden xl:inline">{labels.label}: {status}</span>
                <span aria-hidden="true" className={cn('relative h-4 w-7 rounded-full', enabled === null ? 'bg-neutral-300' : enabled ? 'bg-emerald-500' : 'bg-red-500')}>
                    <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', enabled ? 'left-3.5' : 'left-0.5')} />
                </span>
            </button>
            {error && (
                <div role="alert" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-red-200 bg-white p-3 text-xs text-red-700 shadow-lg">
                    <p>{error === 'read' ? labels.readError : labels.saveError}</p>
                    <button type="button" onClick={() => void load()} className="mt-2 rounded border border-red-200 px-2 py-1 font-semibold hover:bg-red-50">
                        {labels.retry}
                    </button>
                </div>
            )}
        </div>
    );
}
