/**
 * SyncLogDrawer — slide-in panel showing the recent sheet→inventory sync
 * runs. Useful for confirming the cron is healthy, debugging mismatched
 * SKUs, and seeing per-run counts (matched / updated / skipped).
 *
 * Subscribes to `inventory_sync_logs` realtime so the list updates the
 * moment a new run finishes (no manual refresh needed).
 */
import { useEffect, useState } from 'react';
import {
    History,
    CheckCircle2,
    XCircle,
    Loader2,
    RefreshCw,
    Clock,
    Hand,
    Webhook,
    Package,
} from 'lucide-react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { inventorySyncApi, type InventorySyncLog } from '../lib/api';
import { useRealtimeTable } from '../lib/useRealtimeTable';

interface Props {
    open: boolean;
    onClose: () => void;
}

export default function SyncLogDrawer({ open, onClose }: Props) {
    const [logs, setLogs] = useState<InventorySyncLog[]>([]);
    const [loading, setLoading] = useState(false);

    async function load() {
        setLoading(true);
        try {
            setLogs(await inventorySyncApi.listLogs(50));
        } catch {
            // Drawer is informational; swallow errors and just show empty.
        } finally {
            setLoading(false);
        }
    }

    // Reload whenever the drawer is opened, and whenever a new sync row
    // lands (in case the cron or a manual run completes while it's open).
    useEffect(() => {
        if (open) void load();
    }, [open]);
    useRealtimeTable('inventory_sync_logs', () => {
        if (open) void load();
    });

    return (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="w-full sm:max-w-md p-0 gap-0 flex flex-col">
                <SheetHeader className="px-5 py-4 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500 grid place-items-center flex-shrink-0">
                            <History size={18} className="text-white" />
                        </div>
                        <div>
                            <SheetTitle className="text-base font-bold text-neutral-900">
                                ประวัติ Sync สต็อก
                            </SheetTitle>
                            <SheetDescription className="text-[11px] text-neutral-500 mt-0.5">
                                Google Sheet → Inventory · แสดงล่าสุด {logs.length} รายการ
                            </SheetDescription>
                        </div>
                        <button
                            type="button"
                            onClick={() => void load()}
                            disabled={loading}
                            className="ml-auto h-8 w-8 grid place-items-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-50"
                            title="โหลดใหม่"
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin text-neutral-500' : 'text-neutral-500'} />
                        </button>
                    </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {loading && logs.length === 0 && (
                        <div className="text-center text-sm text-neutral-500 py-12">
                            <Loader2 size={18} className="animate-spin inline mr-2" />
                            กำลังโหลด...
                        </div>
                    )}
                    {!loading && logs.length === 0 && (
                        <div className="text-center text-sm text-neutral-500 py-12">
                            ยังไม่มีประวัติการ sync
                        </div>
                    )}
                    {logs.map((log) => (
                        <LogCard key={log.id} log={log} />
                    ))}
                </div>
            </SheetContent>
        </Sheet>
    );
}

// ─── one row ──────────────────────────────────────────────────────────────

function LogCard({ log }: { log: InventorySyncLog }) {
    const isError = log.status === 'error';
    const isPending = log.status === 'pending';
    const durationMs =
        log.finished_at && log.started_at
            ? new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()
            : null;

    const sourceMeta = getSourceMeta(log.source);
    const SourceIcon = sourceMeta.icon;
    const startedDate = new Date(log.started_at);

    return (
        <div
            className={`rounded-lg border p-3 ${
                isError
                    ? 'border-red-200 bg-red-50/30'
                    : isPending
                      ? 'border-amber-200 bg-amber-50/30'
                      : 'border-neutral-200 bg-white'
            }`}
        >
            {/* Header line: timestamp + source + status */}
            <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-neutral-900 tabular-nums">
                    {formatThaiDateTime(startedDate)}
                </span>
                <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${sourceMeta.cls}`}
                    title={sourceMeta.tooltip}
                >
                    <SourceIcon size={9} />
                    {sourceMeta.label}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold">
                    {isError ? (
                        <>
                            <XCircle size={13} className="text-red-600" />
                            <span className="text-red-700">Error</span>
                        </>
                    ) : isPending ? (
                        <>
                            <Loader2 size={13} className="text-amber-600 animate-spin" />
                            <span className="text-amber-700">Pending</span>
                        </>
                    ) : (
                        <>
                            <CheckCircle2 size={13} className="text-emerald-600" />
                            <span className="text-emerald-700">Success</span>
                        </>
                    )}
                </span>
            </div>

            {/* Stats line: sheet rows → matched · updated · skipped */}
            {!isError ? (
                <div className="grid grid-cols-4 gap-2 text-[11px]">
                    <Stat icon={<Package size={11} className="text-neutral-400" />} label="Sheet rows" value={formatNumber(log.sheet_rows)} />
                    <Stat label="Matched" value={formatNumber(log.matched)} tone="indigo" />
                    <Stat label="Updated" value={formatNumber(log.updated)} tone="emerald" />
                    <Stat label="Skipped" value={formatNumber(log.skipped)} tone="neutral" />
                </div>
            ) : (
                <p className="text-[11px] text-red-700 break-words leading-relaxed">
                    {log.error ?? 'Unknown error'}
                </p>
            )}

            {/* Footer: duration */}
            {durationMs !== null && (
                <div className="flex items-center gap-1 mt-1.5 text-[10px] text-neutral-400">
                    <Clock size={9} />
                    {formatDuration(durationMs)}
                </div>
            )}
        </div>
    );
}

function Stat({
    icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon?: React.ReactNode;
    label: string;
    value: string;
    tone?: 'neutral' | 'indigo' | 'emerald';
}) {
    const valueCls =
        tone === 'indigo'
            ? 'text-indigo-700'
            : tone === 'emerald'
              ? 'text-emerald-700'
              : 'text-neutral-700';
    return (
        <div className="leading-tight">
            <div className="flex items-center gap-1 text-[10px] text-neutral-500 uppercase tracking-wide">
                {icon}
                {label}
            </div>
            <div className={`text-sm font-bold tabular-nums mt-0.5 ${valueCls}`}>
                {value}
            </div>
        </div>
    );
}

// ─── small helpers ────────────────────────────────────────────────────────

function getSourceMeta(source: string) {
    switch (source) {
        case 'cron':
            return {
                label: 'Cron',
                tooltip: 'รันอัตโนมัติทุก 15 นาที',
                icon: Clock,
                cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
            };
        case 'manual':
            return {
                label: 'Manual',
                tooltip: 'กดปุ่ม Sync Sheet จากในระบบ',
                icon: Hand,
                cls: 'bg-amber-100 text-amber-800 border border-amber-200',
            };
        case 'webhook':
            return {
                label: 'Webhook',
                tooltip: 'Trigger จากภายนอก (เช่น Apps Script)',
                icon: Webhook,
                cls: 'bg-purple-100 text-purple-700 border border-purple-200',
            };
        default:
            return {
                label: source.toUpperCase(),
                tooltip: source,
                icon: Webhook,
                cls: 'bg-neutral-100 text-neutral-700 border border-neutral-200',
            };
    }
}

function formatNumber(n: number): string {
    return new Intl.NumberFormat('th-TH').format(n);
}

function formatThaiDateTime(d: Date): string {
    // "17/05 14:32:05" — compact for a tight drawer
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    return `${m}m ${(s % 60).toFixed(0)}s`;
}
