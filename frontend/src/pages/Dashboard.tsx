import { useEffect, useState, type ComponentType } from 'react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Area, AreaChart, BarChart, Bar, ReferenceLine,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
    TrendingUp, ShoppingCart, Package, ArrowUpRight, ArrowDownRight,
    Activity, ShoppingBag, UserPlus, Boxes, RefreshCw, FileText,
    AlertCircle, MessageSquare, CheckCircle2, Clock, Target,
} from 'lucide-react';
import N8nAssistant from '../components/N8nAssistant';
import {
    dashboardApi, kpiApi, orgSettingsApi,
    type ActivityEvent,
    type QuoteStats, type AIMetrics, type PaymentBreakdown, type PendingQuote,
} from '../lib/api';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { useLanguage } from '../i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTHB(value: number): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency', currency: 'THB', maximumFractionDigits: 0,
    }).format(value);
}

function formatTHBShort(value: number): string {
    if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `฿${(value / 1_000).toFixed(0)}k`;
    return formatTHB(value);
}

const MONTH_LABEL: Record<string, string> = {
    '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
    '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
    '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'เมื่อกี้';
    if (mins < 60) return `${mins} นาทีที่แล้ว`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`;
    const days = Math.floor(hrs / 24);
    return `${days} วันที่แล้ว`;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    draft:     { label: 'Draft',    cls: 'bg-neutral-100 text-neutral-600' },
    sent:      { label: 'ส่งแล้ว', cls: 'bg-amber-50 text-amber-700' },
    confirmed: { label: 'ยืนยัน',  cls: 'bg-emerald-50 text-emerald-700' },
    cancelled: { label: 'ยกเลิก',  cls: 'bg-red-50 text-red-600' },
};

// ─── Activity ─────────────────────────────────────────────────────────────────

const ACTIVITY_STYLE: Record<
    ActivityEvent['type'],
    { iconBg: string; iconColor: string; Icon: ComponentType<{ size?: number }> }
> = {
    order:     { iconBg: 'bg-indigo-50',   iconColor: 'text-indigo-600',   Icon: ShoppingBag },
    customer:  { iconBg: 'bg-emerald-50',  iconColor: 'text-emerald-600',  Icon: UserPlus },
    inventory: { iconBg: 'bg-amber-50',    iconColor: 'text-amber-700',    Icon: Boxes },
    system:    { iconBg: 'bg-neutral-100', iconColor: 'text-neutral-600',  Icon: Activity },
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiTone { iconBg: string; iconColor: string }
interface KpiCardProps {
    title: string; value: string; icon: React.ReactNode; tone: KpiTone;
    delta?: { label: string; isUp: boolean | null };
    sub?: React.ReactNode;
}

function KpiCard({ title, value, icon, tone, delta, sub }: KpiCardProps) {
    return (
        <Card className="gap-0 py-5 transition hover:shadow-md hover:-translate-y-0.5 duration-200">
            <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                    <div className={cn('w-11 h-11 grid place-items-center rounded-lg', tone.iconBg, tone.iconColor)}>
                        {icon}
                    </div>
                    {delta && (
                        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full',
                            delta.isUp === true  && 'bg-emerald-50 text-emerald-700',
                            delta.isUp === false && 'bg-red-50 text-red-700',
                            delta.isUp === null  && 'bg-neutral-100 text-neutral-600',
                        )}>
                            {delta.isUp === true  && <ArrowUpRight size={12} />}
                            {delta.isUp === false && <ArrowDownRight size={12} />}
                            {delta.label}
                        </span>
                    )}
                </div>
                <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</div>
                    <div className="text-2xl font-bold mt-1 text-neutral-900 tracking-tight tabular-nums">{value}</div>
                </div>
                {sub && <div>{sub}</div>}
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

// ─── Chart Tooltips ───────────────────────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
            <div className="text-sm font-semibold text-neutral-900 mt-0.5 tabular-nums">{formatTHB(Number(payload[0].value))}</div>
        </div>
    );
}

function FunnelTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md">
            <div className="text-[11px] font-medium text-neutral-500">{label}</div>
            <div className="text-sm font-semibold text-neutral-900 mt-0.5">{payload[0].value} รายการ</div>
        </div>
    );
}

const PIE_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
const METHOD_LABEL: Record<string, string> = {
    transfer: 'โอนเงิน', cash: 'เงินสด', credit_card: 'บัตรเครดิต',
    cod: 'COD', bank_transfer: 'โอนธนาคาร',
};

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color = 'bg-indigo-500' }: { value: number; max: number; color?: string }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
        <div className="h-1.5 w-full rounded-full bg-neutral-100 mt-2 overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${pct}%` }} />
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const Dashboard = () => {
    const { t } = useLanguage();
    const [quoteStats, setQuoteStats] = useState<QuoteStats | null>(null);
    const [aiMetrics, setAiMetrics]   = useState<AIMetrics | null>(null);
    const [payments, setPayments]     = useState<PaymentBreakdown[]>([]);
    const [pending, setPending]       = useState<PendingQuote[]>([]);
    const [activity, setActivity]     = useState<ActivityEvent[]>([]);
    const [lowStock, setLowStock]     = useState<number>(0);
    const [target, setTarget]         = useState<number>(2_000_000);
    const [loading, setLoading]       = useState(true);
    const [err, setErr]               = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const [qs, ai, pay, pq, act, kpi, org] = await Promise.all([
                kpiApi.getQuoteStats(),
                kpiApi.getAIMetrics(),
                kpiApi.getPaymentBreakdown(),
                kpiApi.getPendingQuotes(8),
                dashboardApi.getRecentActivity(8),
                dashboardApi.getKPI(),
                orgSettingsApi.get(),
            ]);
            setQuoteStats(qs);
            setAiMetrics(ai);
            setPayments(pay);
            setPending(pq);
            setActivity(act);
            setLowStock(kpi.low_stock_count);
            if (org?.monthly_revenue_target) setTarget(Number(org.monthly_revenue_target));
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, []);
    useRealtimeTable('quotes',    () => void load());
    useRealtimeTable('orders',    () => void load());
    useRealtimeTable('customers', () => void load());
    useRealtimeTable('inventory', () => void load());

    // Chart data
    const chartData = (quoteStats?.monthly_series ?? []).map(m => ({
        name: MONTH_LABEL[m.month.split('-')[1]] ?? m.month,
        sales: m.revenue,
    }));

    const funnelData = quoteStats ? [
        { name: 'Draft',    value: quoteStats.funnel.draft,     fill: '#94A3B8' },
        { name: 'ส่งแล้ว', value: quoteStats.funnel.sent,      fill: '#F59E0B' },
        { name: 'ยืนยัน',  value: quoteStats.funnel.confirmed, fill: '#10B981' },
        { name: 'ยกเลิก',  value: quoteStats.funnel.cancelled,  fill: '#EF4444' },
    ] : [];

    const revThis  = quoteStats?.revenue_this_month  ?? 0;
    const revLast  = quoteStats?.revenue_last_month  ?? 0;
    const revDelta = revLast > 0 ? ((revThis - revLast) / revLast) * 100 : (revThis > 0 ? 100 : 0);
    const convThis = aiMetrics?.conversations_this_month ?? 0;
    const convLast = aiMetrics?.conversations_last_month ?? 0;
    const convDelta = convLast > 0 ? ((convThis - convLast) / convLast) * 100 : (convThis > 0 ? 100 : 0);
    const targetPct = target > 0 ? Math.min((revThis / target) * 100, 100) : 0;

    return (
        <div className="animate-fade-in space-y-6">
            {/* ── Header ─────────────────────────────────────────────── */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-5 border-b border-neutral-200">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t.dashboard.title}</h1>
                    <p className="text-sm text-neutral-500 mt-1">{t.dashboard.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} className="gap-2">
                        <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                        Reload
                    </Button>
                    <Button size="sm" className="gap-2 bg-indigo-500 hover:bg-indigo-600">
                        <FileText size={14} />
                        {t.dashboard.generateReport}
                    </Button>
                </div>
            </header>

            <N8nAssistant />

            {err && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{err}</span>
                </div>
            )}

            {/* ── KPI Cards (6) ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {loading && Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
                {!loading && (<>
                    {/* 1. ยอดขายเดือนนี้ */}
                    <KpiCard
                        title="ยอดขายเดือนนี้"
                        value={formatTHBShort(revThis)}
                        icon={<TrendingUp size={20} />}
                        tone={{ iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' }}
                        delta={{ label: `${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(1)}%`, isUp: revDelta >= 0 }}
                        sub={
                            <div>
                                <div className="flex justify-between text-[10px] text-neutral-400 mb-0.5">
                                    <span>เป้า {formatTHBShort(target)}</span>
                                    <span>{targetPct.toFixed(0)}%</span>
                                </div>
                                <ProgressBar value={revThis} max={target} color={targetPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'} />
                            </div>
                        }
                    />
                    {/* 2. Pipeline */}
                    <KpiCard
                        title="Quote Pipeline"
                        value={formatTHBShort(quoteStats?.pipeline_value ?? 0)}
                        icon={<ShoppingCart size={20} />}
                        tone={{ iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' }}
                        delta={{ label: `${quoteStats?.pipeline_count ?? 0} รายการ`, isUp: null }}
                    />
                    {/* 3. Conversion */}
                    <KpiCard
                        title="อัตราปิดการขาย"
                        value={`${(quoteStats?.conversion_rate ?? 0).toFixed(0)}%`}
                        icon={<Target size={20} />}
                        tone={{ iconBg: 'bg-violet-50', iconColor: 'text-violet-600' }}
                        delta={{ label: `${quoteStats?.funnel.confirmed ?? 0} ยืนยัน`, isUp: (quoteStats?.conversion_rate ?? 0) >= 50 }}
                    />
                    {/* 4. AI Conversations */}
                    <KpiCard
                        title="AI Chat เดือนนี้"
                        value={String(convThis)}
                        icon={<MessageSquare size={20} />}
                        tone={{ iconBg: 'bg-sky-50', iconColor: 'text-sky-600' }}
                        delta={{ label: `${convDelta >= 0 ? '+' : ''}${convDelta.toFixed(0)}%`, isUp: convDelta >= 0 }}
                    />
                    {/* 5. Low Stock */}
                    <KpiCard
                        title="สินค้าใกล้หมด"
                        value={String(lowStock)}
                        icon={<Package size={20} />}
                        tone={{ iconBg: lowStock > 0 ? 'bg-amber-50' : 'bg-neutral-50', iconColor: lowStock > 0 ? 'text-amber-700' : 'text-neutral-500' }}
                        delta={{ label: lowStock > 0 ? 'ต้องสั่งซื้อ' : 'ปกติ', isUp: lowStock === 0 }}
                    />
                    {/* 6. AI Tasks */}
                    <KpiCard
                        title="AI Tasks เดือนนี้"
                        value={String(aiMetrics?.tasks_done_this_month ?? 0)}
                        icon={<CheckCircle2 size={20} />}
                        tone={{ iconBg: 'bg-teal-50', iconColor: 'text-teal-600' }}
                        delta={{ label: `${aiMetrics?.tasks_pending ?? 0} รอดำเนินการ`, isUp: null }}
                    />
                </>)}
            </div>

            {/* ── Charts Row ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Revenue Chart — 2/3 width */}
                <Card className="xl:col-span-2 gap-4 py-5">
                    <CardHeader className="px-5">
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="text-base font-semibold text-neutral-900">ยอดขายรายเดือน (จากคำสั่งซื้อที่จัดส่งแล้ว)</CardTitle>
                                <p className="text-xs text-neutral-500 mt-0.5">6 เดือนล่าสุด (สถานะจัดส่งแล้ว) — เส้นประ = เป้า {formatTHBShort(target)}/เดือน</p>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-1">
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.18} />
                                            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#E5E7EB" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} dy={8} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={(v) => formatTHBShort(v)} width={52} />
                                    <Tooltip cursor={{ stroke: '#6366F1', strokeWidth: 1, strokeDasharray: '4 4' }} content={<RevenueTooltip />} />
                                    <ReferenceLine y={target} stroke="#EF4444" strokeDasharray="6 3" strokeWidth={1.5} />
                                    <Area type="monotone" dataKey="sales" stroke="#6366F1" strokeWidth={2.5} fill="url(#revGrad)"
                                        dot={{ r: 3, fill: '#FFFFFF', strokeWidth: 2, stroke: '#6366F1' }}
                                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#FFFFFF', fill: '#6366F1' }}
                                        animationDuration={600} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Quote Funnel — 1/3 width */}
                <Card className="gap-4 py-5">
                    <CardHeader className="px-5">
                        <CardTitle className="text-base font-semibold text-neutral-900">Quote Funnel</CardTitle>
                        <p className="text-xs text-neutral-500 mt-0.5">สถานะใบเสนอราคาทั้งหมด</p>
                    </CardHeader>
                    <CardContent className="px-3 pb-1">
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={funnelData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#E5E7EB" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} allowDecimals={false} width={28} />
                                    <Tooltip content={<FunnelTooltip />} />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={600}>
                                        {funnelData.map((entry, index) => (
                                            <Cell key={index} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* ── Pending Quotes + Activity + Payment Row ──────────────── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Pending Quotes Table — 2/3 */}
                <Card className="xl:col-span-2 gap-4 py-5">
                    <CardHeader className="px-5 flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base font-semibold text-neutral-900">Quote รอ Follow-up</CardTitle>
                            <p className="text-xs text-neutral-500 mt-0.5">ใบเสนอราคาที่ยังไม่ได้รับการยืนยัน เรียงตามวันเก่าที่สุด</p>
                        </div>
                        <Clock size={16} className="text-amber-500" />
                    </CardHeader>
                    <CardContent className="px-5 pb-2">
                        {loading && <div className="h-32 animate-pulse bg-neutral-50 rounded-lg" />}
                        {!loading && pending.length === 0 && (
                            <div className="text-sm text-neutral-400 py-8 text-center flex flex-col items-center gap-2">
                                <CheckCircle2 size={24} className="text-emerald-400" />
                                ไม่มี Quote ค้างอยู่ 🎉
                            </div>
                        )}
                        {!loading && pending.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-100">
                                            <th className="text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider pb-2">รหัส</th>
                                            <th className="text-left text-[11px] font-medium text-neutral-500 uppercase tracking-wider pb-2">ลูกค้า</th>
                                            <th className="text-right text-[11px] font-medium text-neutral-500 uppercase tracking-wider pb-2">มูลค่า</th>
                                            <th className="text-center text-[11px] font-medium text-neutral-500 uppercase tracking-wider pb-2">สถานะ</th>
                                            <th className="text-right text-[11px] font-medium text-neutral-500 uppercase tracking-wider pb-2">รอ (วัน)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-50">
                                        {pending.map(q => (
                                            <tr key={q.id} className="hover:bg-neutral-50 transition-colors">
                                                <td className="py-2.5 font-mono text-xs text-indigo-600">{q.code}</td>
                                                <td className="py-2.5 text-neutral-800 truncate max-w-[120px]">{q.customer_name}</td>
                                                <td className="py-2.5 text-right font-semibold tabular-nums text-neutral-900">{formatTHBShort(q.total)}</td>
                                                <td className="py-2.5 text-center">
                                                    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_LABEL[q.status]?.cls ?? 'bg-neutral-100 text-neutral-600')}>
                                                        {STATUS_LABEL[q.status]?.label ?? q.status}
                                                    </span>
                                                </td>
                                                <td className={cn('py-2.5 text-right font-semibold tabular-nums', q.days_waiting >= 7 ? 'text-red-600' : q.days_waiting >= 3 ? 'text-amber-600' : 'text-neutral-600')}>
                                                    {q.days_waiting}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Right column: Payment + Activity */}
                <div className="flex flex-col gap-4">
                    {/* Payment Breakdown */}
                    <Card className="gap-4 py-5">
                        <CardHeader className="px-5">
                            <CardTitle className="text-base font-semibold text-neutral-900">ช่องทางชำระเงิน</CardTitle>
                            <p className="text-xs text-neutral-500 mt-0.5">เป้า: เงินสด/โอน 70-80%</p>
                        </CardHeader>
                        <CardContent className="px-3 pb-1">
                            {loading && <div className="h-32 animate-pulse bg-neutral-50 rounded-lg" />}
                            {!loading && payments.length === 0 && (
                                <div className="text-sm text-neutral-400 py-6 text-center">ยังไม่มีข้อมูล</div>
                            )}
                            {!loading && payments.length > 0 && (
                                <div className="h-[140px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={payments} dataKey="count" nameKey="method" cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={2}>
                                                {payments.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip formatter={(v, name) => [v, METHOD_LABEL[name as string] ?? name]} />
                                            <Legend formatter={(v) => METHOD_LABEL[v] ?? v} iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Recent Activity */}
                    <Card className="gap-4 py-5 flex-1">
                        <CardHeader className="flex items-center justify-between gap-2 px-5">
                            <CardTitle className="text-base font-semibold text-neutral-900">{t.dashboard.activity.title}</CardTitle>
                            <span className="grid place-items-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600">
                                <Activity size={16} />
                            </span>
                        </CardHeader>
                        <CardContent className="px-5 pb-2 max-h-[220px] overflow-y-auto">
                            {loading && (
                                <div className="space-y-3">
                                    {Array.from({ length: 4 }).map((_, i) => (
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
                                <div className="text-sm text-neutral-500 py-6 text-center">{t.common.noData}</div>
                            )}
                            {!loading && activity.length > 0 && (
                                <ul className="space-y-3">
                                    {activity.map(e => {
                                        const { iconBg, iconColor, Icon } = ACTIVITY_STYLE[e.type];
                                        return (
                                            <li key={e.id} className="flex gap-3 group">
                                                <div className={cn('w-8 h-8 rounded-lg grid place-items-center flex-shrink-0', iconBg, iconColor)}>
                                                    <Icon size={14} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-neutral-900 leading-tight group-hover:text-indigo-700 transition-colors">{e.message}</p>
                                                    <p className="text-xs text-neutral-500 mt-1 tabular-nums">{relativeTime(e.created_at)}</p>
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
        </div>
    );
};

export default Dashboard;

