import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
    Handshake,
    Award,
    TrendingUp,
    Link2,
    Copy,
    RefreshCw,
    CheckCircle,
    Clock,
    Ban,
    AlertCircle,
    Eye,
} from 'lucide-react';
import { agentsApi, type Agent, type AgentLink } from '../lib/api';
import { useLanguage } from '../i18n';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── Lookup tables ────────────────────────────────────────────────────────────

const TIER_STYLE: Record<Agent['tier'], string> = {
    starter:  'bg-neutral-100 text-neutral-700 border-neutral-200',
    silver:   'bg-slate-100   text-slate-700   border-slate-300',
    gold:     'bg-amber-50    text-amber-800   border-amber-300',
    platinum: 'bg-cyan-50     text-cyan-700    border-cyan-200',
};

const STATUS_STYLE: Record<
    Agent['status'],
    { className: string; Icon: ComponentType<{ size?: number }> }
> = {
    pending:   { className: 'bg-amber-50   text-amber-700   border-amber-200',   Icon: Clock },
    active:    { className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle },
    suspended: { className: 'bg-red-50     text-red-700     border-red-200',     Icon: Ban },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Affiliate() {
    const { t } = useLanguage();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [links, setLinks] = useState<AgentLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const [a, l] = await Promise.all([agentsApi.list(), agentsApi.listLinks()]);
            setAgents(a);
            setLinks(l);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    const stats = useMemo(() => {
        const active = agents.filter((a) => a.status === 'active');
        const totalSales = agents.reduce((acc, a) => acc + Number(a.total_sales), 0);
        const totalCommission = agents.reduce((acc, a) => acc + Number(a.total_commission), 0);
        const pendingCommission = agents.reduce(
            (acc, a) => acc + Number(a.pending_commission),
            0,
        );
        return {
            active: active.length,
            total: agents.length,
            totalSales,
            totalCommission,
            pendingCommission,
        };
    }, [agents]);

    async function copyLink(short: string) {
        const url = `https://www.corebiz.online/ref/${short}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedCode(short);
            setTimeout(() => setCopiedCode(null), 2000);
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function approve(id: string) {
        try {
            await agentsApi.approve(id);
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function suspend(id: string) {
        try {
            await agentsApi.suspend(id);
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.affiliate.title}
                subtitle={t.affiliate.subtitle}
                icon={<Handshake size={20} />}
                actions={
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
                }
            />

            {/* ── KPI ──────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    icon={<Handshake size={18} />}
                    label="ตัวแทนที่ใช้งาน"
                    value={`${stats.active}/${stats.total}`}
                    tone="indigo"
                />
                <StatTile
                    icon={<TrendingUp size={18} />}
                    label="ยอดขายรวม"
                    value={`฿${stats.totalSales.toLocaleString()}`}
                    tone="emerald"
                />
                <StatTile
                    icon={<Award size={18} />}
                    label="คอมมิชชั่นจ่ายแล้ว"
                    value={`฿${stats.totalCommission.toLocaleString()}`}
                    tone="amber"
                />
                <StatTile
                    icon={<Clock size={18} />}
                    label="ค้างจ่าย"
                    value={`฿${stats.pendingCommission.toLocaleString()}`}
                    tone="rose"
                />
            </div>

            {err && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{err}</span>
                </div>
            )}

            {/* ── Agents table ───────────────────────────────────────── */}
            <Card className="gap-4 py-5">
                <CardHeader className="px-5">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                        <Handshake size={16} className="text-indigo-600" />
                        ตัวแทนจำหน่าย
                        <span className="text-xs font-normal text-neutral-500 ml-1">
                            ({agents.length})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                <TableHead className="px-5 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    รหัส
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ชื่อ / ติดต่อ
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    Tier
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    คอม %
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    Conversions
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ยอดขาย
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ค้างจ่าย
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    สถานะ
                                </TableHead>
                                <TableHead className="px-5 text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    จัดการ
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && (
                                <TableRow>
                                    <TableCell
                                        colSpan={9}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.loading}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading && agents.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={9}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.noData}
                                    </TableCell>
                                </TableRow>
                            )}
                            {agents.map((a) => {
                                const statusMeta = STATUS_STYLE[a.status];
                                const StatusIcon = statusMeta.Icon;
                                return (
                                    <TableRow key={a.id}>
                                        <TableCell className="px-5 font-mono text-sm text-indigo-600">
                                            {a.code}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium text-neutral-900">
                                                {a.name}
                                            </div>
                                            <div className="text-xs text-neutral-500">{a.email}</div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase border tracking-wider',
                                                    TIER_STYLE[a.tier],
                                                )}
                                            >
                                                {a.tier}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-semibold text-neutral-900 tabular-nums">
                                            {a.commission_rate}%
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums">
                                            <span className="text-neutral-700">
                                                {a.total_conversions.toLocaleString()}
                                            </span>
                                            <span className="text-neutral-400 text-xs">
                                                {' '}
                                                / {a.total_clicks.toLocaleString()} clicks
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-bold text-emerald-700 tabular-nums">
                                            ฿{Number(a.total_sales).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right text-sm font-semibold text-amber-700 tabular-nums">
                                            ฿{Number(a.pending_commission).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border',
                                                    statusMeta.className,
                                                )}
                                            >
                                                <StatusIcon size={11} /> {a.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="px-5 text-center">
                                            {a.status === 'pending' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => approve(a.id)}
                                                    className="h-7 text-xs border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                                                >
                                                    อนุมัติ
                                                </Button>
                                            )}
                                            {a.status === 'active' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => suspend(a.id)}
                                                    className="h-7 text-xs border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                                                >
                                                    ระงับ
                                                </Button>
                                            )}
                                            {a.status === 'suspended' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => approve(a.id)}
                                                    className="h-7 text-xs border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                                                >
                                                    คืนสถานะ
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ── Tracking Links ──────────────────────────────────────── */}
            <Card className="gap-4 py-5">
                <CardHeader className="px-5">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                        <Link2 size={16} className="text-indigo-600" />
                        Tracking Links
                        <span className="text-xs font-normal text-neutral-500 ml-1">
                            ({links.length})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-5 space-y-2">
                    {links.length === 0 && (
                        <div className="text-sm text-neutral-500 py-8 text-center border border-dashed border-neutral-300 rounded-lg">
                            ยังไม่มี link
                        </div>
                    )}
                    {links.map((l) => {
                        const agent = agents.find((a) => a.id === l.agent_id);
                        const isCopied = copiedCode === l.short_code;
                        return (
                            <div
                                key={l.id}
                                className="flex items-center gap-4 p-3.5 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300 transition"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <code className="text-sm font-mono text-indigo-600 font-semibold">
                                            /ref/{l.short_code}
                                        </code>
                                        <span className="text-xs text-neutral-500">
                                            → {agent?.name ?? 'Unknown'}
                                        </span>
                                    </div>
                                    {l.label && (
                                        <div className="text-xs text-neutral-500 mt-0.5">
                                            {l.label}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500 tabular-nums">
                                        <span className="inline-flex items-center gap-1">
                                            <Eye size={11} />
                                            {l.clicks.toLocaleString()} clicks
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-emerald-700">
                                            <CheckCircle size={11} />
                                            {l.conversions} conv
                                        </span>
                                        <span className="text-emerald-700 font-semibold">
                                            ฿{Number(l.revenue).toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyLink(l.short_code)}
                                    className={cn(
                                        'gap-1.5',
                                        isCopied &&
                                            'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800',
                                    )}
                                >
                                    {isCopied ? (
                                        <CheckCircle size={13} />
                                    ) : (
                                        <Copy size={13} />
                                    )}
                                    {isCopied ? 'Copied!' : 'Copy link'}
                                </Button>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
}
