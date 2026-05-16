import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'blue' | 'neutral';

const TONE_MAP: Record<StatTone, { bg: string; fg: string }> = {
    indigo:  { bg: 'bg-indigo-50',  fg: 'text-indigo-600' },
    emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   fg: 'text-amber-700' },
    rose:    { bg: 'bg-rose-50',    fg: 'text-rose-600' },
    violet:  { bg: 'bg-violet-50',  fg: 'text-violet-600' },
    blue:    { bg: 'bg-blue-50',    fg: 'text-blue-600' },
    neutral: { bg: 'bg-neutral-100', fg: 'text-neutral-700' },
};

export interface StatTileProps {
    icon: ReactNode;
    label: string;
    value: string;
    tone?: StatTone;
    sublabel?: string;
    /** Compact mode (smaller icon + value) */
    compact?: boolean;
}

/**
 * Reusable KPI/stat card with color-tinted icon + label + value.
 *
 * Pattern: bg-{tone}-50 + text-{tone}-600 (matches Dashboard KpiCard).
 *
 * @example
 *   <StatTile icon={<Zap size={20} />} label="Active" value="12" tone="indigo" />
 */
export default function StatTile({
    icon,
    label,
    value,
    tone = 'indigo',
    sublabel,
    compact = false,
}: StatTileProps) {
    const { bg, fg } = TONE_MAP[tone];

    return (
        <Card className="gap-0 py-4">
            <CardContent className="flex items-center gap-3.5 px-5">
                <div
                    className={cn(
                        'grid place-items-center rounded-lg flex-shrink-0',
                        bg,
                        fg,
                        compact ? 'w-10 h-10' : 'w-11 h-11',
                    )}
                >
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-neutral-500 truncate">{label}</div>
                    <div
                        className={cn(
                            'font-bold text-neutral-900 tabular-nums tracking-tight',
                            compact ? 'text-lg' : 'text-xl',
                        )}
                    >
                        {value}
                    </div>
                    {sublabel && (
                        <div className="text-[11px] text-neutral-500 mt-0.5 truncate">{sublabel}</div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
