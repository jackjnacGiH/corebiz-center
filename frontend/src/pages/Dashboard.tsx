import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Area,
    AreaChart,
} from 'recharts';
import {
    TrendingUp,
    ShoppingCart,
    Package,
    Users,
    ArrowUpRight,
    ArrowDownRight,
    Activity,
    ShoppingBag,
    UserPlus,
    Boxes,
    RefreshCw,
    Download,
    FileText,
    AlertCircle,
} from 'lucide-react';
import N8nAssistant from '../components/N8nAssistant';
import {
    dashboardApi,
    type DashboardKPI,
    type MonthlyRevenue,
    type ActivityEvent,
} from '../lib/api';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { useLanguage } from '../i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTHB(value: number): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        maximumFractionDigits: 0,
    }).format(value);
}

const MONTH_LABEL: Record<string, string> = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
    '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ─── Activity icon palette ────────────────────────────────────────────────────

const ACTIVITY_STYLE: Record<
    ActivityEvent['type'],
    { iconBg: string; iconColor: string; Icon: ComponentType<{ size?: number }> }
> = {
    order:     { iconBg: 'bg-indigo-50',   iconColor: 'text-indigo-600',   Icon: ShoppingBag },
    customer:  { iconBg: 'bg-emerald-50',  iconColor: 'text-emerald-600',  Icon: UserPlus },
    inventory: { iconBg: 'bg-amber-50',    iconColor: 'text-amber-700',    Icon: Boxes },
    system:    { iconBg: 'bg-neutral-100', iconColor: 'text-neutral-600',  Icon: Activity },
};

// ─── KPI sub-components ───────────────────────────────────────────────────────

interface KpiTone {
    iconBg: string;
    iconColor: string;
}

const KPI_TONES = {
    revenue:   { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' } as KpiTone,
    orders:    { iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600'  } as KpiTone,
    lowStock:  { iconBg: 'bg-amber-50',   iconColor: 'text-amber-700'   } as KpiTone,
    customers: { iconBg: 'bg-violet-50',  iconColor: 'text-violet-600'  } as KpiTone,
};

interface KpiCardProps {
    title: string;
    value: string;
    icon: ReactNode;
    tone: KpiTone;
    delta?: { label: string; isUp: boolean | null };
}

function KpiCard({ title, value, icon, tone, delta }: KpiCardProps) {
    return (
        <Card className="gap-0 py-5 transition hover:shadow-md hover:-translate-y-0.5 duration-200">
            <CardContent className="flex flex-col gap-4">
                <div className="flex items-start justify-between">
                    <div className={cn('w-11 h-11 grid place-items-center rounded-lg', tone.iconBg, tone.iconColor)}>
                        {icon}
                    </div>
                    {delta && (
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full',
                                delta.isUp === true && 'bg-emerald-50 text-emerald-700',
                                delta.isUp === false && 'bg-red-50 text-red-700',
                                delta.isUp === null && 'bg-neutral-100 text-neutral-600',
                            )}
                        >
                            {delta.isUp === true && <ArrowUpRight size={12} />}
                            {delta.isUp === false && <ArrowDownRight size={12} />}
                            {delta.label}
                        </span>
                    )}
                </div>
                <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                        {title}
                    </div>
                    <div className="text-2xl font-bold mt-1.5 text-neutral-900 tracking-tight tabular-nums">
                        {value}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function KpiSkeleton() {
    return (
        <Card className="gap-0 py-5">
            <CardContent className="flex flex-col gap-4">
                <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-lg bg-neutral-100 animate-pulse" />
                    <div className="w-14 h-5 rounded-full bg-neutral-100 animate-pulse" />
                </div>
                <div>
                    <div className="h-3 w-20 rounded bg-neutral-100 animate-pulse" />
                    <div className="h-7 w-28 mt-2 rounded bg-neutral-100 animate-pulse" />
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Chart tooltip (light theme) ──────────────────────────────────────────────

function ChartTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
}) {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                {label}
            </div>
            <div className="text-sm font-semibold text-neutral-900 mt-0.5 tabular-nums">
                {formatTHB(Number(payload[0].value))}
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const Dashboard = () => {
    const { t } = useLanguage();
    const [kpi, setKpi] = useState<DashboardKPI | null>(null);
    const [monthly, setMonthly] = useState<MonthlyRevenue[]>([]);
    const [activity, setActivity] = useState<ActivityEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const [k, m, a] = await Promise.all([
                dashboardApi.getKPI(),
                dashboardApi.getMonthlyRevenue(7),
                dashboardApi.getRecentActivity(8),
            ]);
            setKpi(k);
            setMonthly(m);
            setActivity(a);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    // Realtime refresh on data changes
    useRealtimeTable('orders', () => void load());
    useRealtimeTable('customers', () => void load());
    useRealtimeTable('inventory', () => void load());

    const chartData = monthly.map((m) => {
        const monthCode = m.month.split('-')[1];
        return { name: MONTH_LABEL[monthCode] ?? m.month, sales: m.revenue };
    });

    const kpiCards = kpi
        ? [
              {
                  key: 'revenue',
                  title: t.dashboard.kpi.revenue,
                  value: formatTHB(kpi.total_revenue),
                  icon: <TrendingUp size={20} />,
                  tone: KPI_TONES.revenue,
                  delta: {
                      label: `${kpi.revenue_delta_pct >= 0 ? '+' : ''}${kpi.revenue_delta_pct.toFixed(1)}%`,
                      isUp: kpi.revenue_delta_pct >= 0,
                  },
              },
              {
                  key: 'orders',
                  title: t.dashboard.kpi.activeOrders,
                  value: String(kpi.active_orders),
                  icon: <ShoppingCart size={20} />,
                  tone: KPI_TONES.orders,
                  delta: { label: 'active', isUp: null },
              },
              {
                  key: 'lowStock',
                  title: t.dashboard.kpi.lowStock,
                  value: String(kpi.low_stock_count),
                  icon: <Package size={20} />,
                  tone: KPI_TONES.lowStock,
                  delta: {
                      label: kpi.low_stock_count > 0 ? 'attention' : 'OK',
                      isUp: kpi.low_stock_count === 0,
                  },
              },
              {
                  key: 'customers',
                  title: t.dashboard.kpi.newCustomers,
                  value: String(kpi.new_customers_30d),
                  icon: <Users size={20} />,
                  tone: KPI_TONES.customers,
                  delta: { label: '30d', isUp: null },
              },
          ]
        : [];

    return (
        <div className="animate-fade-in space-y-6 max-w-[1440px] mx-auto">
            {/* ── Page header ─────────────────────────────────────────────── */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-5 border-b border-neutral-200">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
                        {t.dashboard.title}
                    </h1>
                    <p className="text-sm text-neutral-500 mt-1">{t.dashboard.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => load()}
                        disabled={loading}
                        className="gap-2"
                    >
                        <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                        Reload
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2">
                        <Download size={14} />
                        {t.dashboard.downloadLogs}
                    </Button>
                    <Button size="sm" className="gap-2 bg-indigo-500 hover:bg-indigo-600">
                        <FileText size={14} />
                        {t.dashboard.generateReport}
                    </Button>
                </div>
            </header>

            {/* ── n8n widget (kept untouched) ─────────────────────────────── */}
            <N8nAssistant />

            {/* ── Error banner ────────────────────────────────────────────── */}
            {err && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{err}</span>
                </div>
            )}

            {/* ── KPI cards ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {loading &&
                    Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
                {!loading &&
                    kpiCards.map((c) => (
                        <KpiCard
                            key={c.key}
                            title={c.title}
                            value={c.value}
                            icon={c.icon}
                            tone={c.tone}
                            delta={c.delta}
                        />
                    ))}
            </div>

            {/* ── Chart + Activity row ────────────────────────────────────── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Revenue chart — 2/3 */}
                <Card className="xl:col-span-2 gap-4 py-5">
                    <CardHeader className="flex items-start justify-between gap-2 px-5">
                        <div>
                            <CardTitle className="text-base font-semibold text-neutral-900">
                                {t.dashboard.chart.title}
                            </CardTitle>
                            <p className="text-xs text-neutral-500 mt-0.5">
                                {t.dashboard.chart.subtitle}
                            </p>
                        </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-1">
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={chartData}
                                    margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366F1" stopOpacity={0.18} />
                                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid
                                        strokeDasharray="4 4"
                                        vertical={false}
                                        stroke="#E5E7EB"
                                    />
                                    <XAxis
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#6B7280', fontSize: 11 }}
                                        dy={8}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#6B7280', fontSize: 11 }}
                                        tickFormatter={(v) => `฿${Math.round(v / 1000)}k`}
                                        width={50}
                                    />
                                    <Tooltip
                                        cursor={{
                                            stroke: '#6366F1',
                                            strokeWidth: 1,
                                            strokeDasharray: '4 4',
                                        }}
                                        content={<ChartTooltip />}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="sales"
                                        stroke="#6366F1"
                                        strokeWidth={2.5}
                                        fill="url(#revGradient)"
                                        dot={{
                                            r: 3,
                                            fill: '#FFFFFF',
                                            strokeWidth: 2,
                                            stroke: '#6366F1',
                                        }}
                                        activeDot={{
                                            r: 5,
                                            strokeWidth: 2,
                                            stroke: '#FFFFFF',
                                            fill: '#6366F1',
                                        }}
                                        animationDuration={600}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Activity — 1/3 */}
                <Card className="gap-4 py-5">
                    <CardHeader className="flex items-center justify-between gap-2 px-5">
                        <CardTitle className="text-base font-semibold text-neutral-900">
                            {t.dashboard.activity.title}
                        </CardTitle>
                        <span className="grid place-items-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600">
                            <Activity size={16} />
                        </span>
                    </CardHeader>
                    <CardContent className="px-5 pb-2 max-h-[280px] overflow-y-auto">
                        {loading && (
                            <div className="space-y-3">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="flex gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-neutral-100 animate-pulse flex-shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-3 w-3/4 rounded bg-neutral-100 animate-pulse" />
                                            <div className="h-2.5 w-1/3 rounded bg-neutral-100 animate-pulse" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {!loading && activity.length === 0 && (
                            <div className="text-sm text-neutral-500 py-8 text-center">
                                {t.common.noData}
                            </div>
                        )}
                        {!loading && activity.length > 0 && (
                            <ul className="space-y-3">
                                {activity.map((e) => {
                                    const { iconBg, iconColor, Icon } = ACTIVITY_STYLE[e.type];
                                    return (
                                        <li key={e.id} className="flex gap-3 group">
                                            <div
                                                className={cn(
                                                    'w-8 h-8 rounded-lg grid place-items-center flex-shrink-0',
                                                    iconBg,
                                                    iconColor,
                                                )}
                                            >
                                                <Icon size={14} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-neutral-900 leading-tight group-hover:text-indigo-700 transition-colors">
                                                    {e.message}
                                                </p>
                                                <p className="text-xs text-neutral-500 mt-1 tabular-nums">
                                                    {relativeTime(e.created_at)}
                                                </p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>

        </div>
    );
};

export default Dashboard;
