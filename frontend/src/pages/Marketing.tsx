import { useEffect, useMemo, useState } from 'react';
import {
    Target,
    BarChart2,
    Zap,
    Ticket,
    RefreshCw,
    Play,
    Pause,
    Plus,
    AlertCircle,
    Eye,
    CheckCircle2,
} from 'lucide-react';
import { campaignsApi, couponsApi, type Campaign, type Coupon } from '../lib/api';
import { useLanguage } from '../i18n';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const CAMPAIGN_STATUS_STYLE: Record<Campaign['status'], string> = {
    draft:     'bg-neutral-100 text-neutral-700 border-neutral-200',
    scheduled: 'bg-amber-50    text-amber-700   border-amber-200',
    running:   'bg-emerald-50  text-emerald-700 border-emerald-200',
    paused:    'bg-orange-50   text-orange-700  border-orange-200',
    completed: 'bg-indigo-50   text-indigo-700  border-indigo-200',
    cancelled: 'bg-red-50      text-red-700     border-red-200',
};

const CAMPAIGN_TYPE_LABEL: Record<Campaign['type'], string> = {
    promotion:      'โปรโมชั่น',
    flash_sale:     'Flash Sale',
    popup:          'Pop-up',
    abandoned_cart: 'Abandoned Cart',
    email:          'Email',
    sms:            'SMS',
    banner:         'Banner',
};

const COUPON_TYPE_LABEL: Record<Coupon['discount_type'], string> = {
    percent:       '%',
    fixed:         'บาท',
    free_shipping: 'ส่งฟรี',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Marketing() {
    const { t } = useLanguage();
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newCampaign, setNewCampaign] = useState({
        name: '',
        type: 'promotion' as Campaign['type'],
        description: '',
    });

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const [c, cp] = await Promise.all([campaignsApi.list(), couponsApi.list()]);
            setCampaigns(c);
            setCoupons(cp);
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
        const running = campaigns.filter((c) => c.status === 'running').length;
        const totalImpr = campaigns.reduce((acc, c) => acc + (c.metrics.impressions ?? 0), 0);
        const totalConv = campaigns.reduce((acc, c) => acc + (c.metrics.conversions ?? 0), 0);
        const totalRev = campaigns.reduce((acc, c) => acc + (c.metrics.revenue ?? 0), 0);
        return { running, totalImpr, totalConv, totalRev };
    }, [campaigns]);

    async function handleCreateCampaign() {
        if (!newCampaign.name.trim()) return;
        try {
            await campaignsApi.create({
                name: newCampaign.name,
                type: newCampaign.type,
                description: newCampaign.description || null,
            });
            setIsCreating(false);
            setNewCampaign({ name: '', type: 'promotion', description: '' });
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function toggleStatus(c: Campaign) {
        try {
            await campaignsApi.updateStatus(c.id, c.status === 'running' ? 'paused' : 'running');
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.marketing.title}
                subtitle={t.marketing.subtitle}
                icon={<Target size={20} />}
                actions={
                    <>
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
                        <Button
                            size="sm"
                            onClick={() => setIsCreating(true)}
                            className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                        >
                            <Zap size={14} />
                            {t.marketing.createCampaign}
                        </Button>
                    </>
                }
            />

            {/* ── KPI ──────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    icon={<Zap size={18} />}
                    label="แคมเปญที่ใช้งาน"
                    value={stats.running.toString()}
                    tone="indigo"
                />
                <StatTile
                    icon={<Eye size={18} />}
                    label="Impressions"
                    value={stats.totalImpr.toLocaleString()}
                    tone="blue"
                />
                <StatTile
                    icon={<Target size={18} />}
                    label="Conversions"
                    value={stats.totalConv.toLocaleString()}
                    tone="emerald"
                />
                <StatTile
                    icon={<BarChart2 size={18} />}
                    label="Revenue"
                    value={`฿${stats.totalRev.toLocaleString()}`}
                    tone="amber"
                />
            </div>

            {err && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{err}</span>
                </div>
            )}

            {/* ── Campaigns list ──────────────────────────────────────── */}
            <Card className="gap-4 py-5">
                <CardHeader className="px-5">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                        <Target size={16} className="text-indigo-600" />
                        {t.marketing.activeCampaigns}
                        <span className="text-xs font-normal text-neutral-500 ml-1">
                            ({campaigns.length})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-5 space-y-2.5">
                    {loading && (
                        <div className="text-sm text-neutral-500 py-6 text-center">
                            {t.common.loading}
                        </div>
                    )}
                    {!loading && campaigns.length === 0 && (
                        <div className="text-sm text-neutral-500 py-8 text-center border border-dashed border-neutral-300 rounded-lg">
                            ยังไม่มีแคมเปญ — คลิก "สร้างแคมเปญ" ด้านบน
                        </div>
                    )}
                    {campaigns.map((c) => (
                        <div
                            key={c.id}
                            className="flex items-center justify-between p-4 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300 transition gap-4"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-neutral-900">{c.name}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 uppercase font-medium tracking-wider">
                                        {CAMPAIGN_TYPE_LABEL[c.type]}
                                    </span>
                                </div>
                                {c.description && (
                                    <div className="text-xs text-neutral-500 mt-1">
                                        {c.description}
                                    </div>
                                )}
                                <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500 tabular-nums">
                                    {c.metrics.impressions !== undefined && (
                                        <span className="inline-flex items-center gap-1">
                                            <Eye size={11} />
                                            {c.metrics.impressions.toLocaleString()}
                                        </span>
                                    )}
                                    {c.metrics.conversions !== undefined && (
                                        <span className="inline-flex items-center gap-1 text-emerald-700">
                                            <CheckCircle2 size={11} />
                                            {c.metrics.conversions} conv
                                        </span>
                                    )}
                                    {c.metrics.revenue !== undefined && c.metrics.revenue > 0 && (
                                        <span className="text-emerald-700 font-semibold">
                                            ฿{c.metrics.revenue.toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span
                                    className={cn(
                                        'px-2.5 py-1 rounded-full text-xs font-semibold border',
                                        CAMPAIGN_STATUS_STYLE[c.status],
                                    )}
                                >
                                    {c.status}
                                </span>
                                {(c.status === 'running' || c.status === 'paused') && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => toggleStatus(c)}
                                        className="h-8 w-8"
                                        title={c.status === 'running' ? 'Pause' : 'Resume'}
                                    >
                                        {c.status === 'running' ? (
                                            <Pause size={14} />
                                        ) : (
                                            <Play size={14} />
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* ── Coupons table ──────────────────────────────────────── */}
            <Card className="gap-4 py-5">
                <CardHeader className="px-5">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                        <Ticket size={16} className="text-pink-600" />
                        คูปอง / Discount Codes
                        <span className="text-xs font-normal text-neutral-500 ml-1">
                            ({coupons.length})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                <TableHead className="px-5 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    รหัส
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    รายละเอียด
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ส่วนลด
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ขั้นต่ำ
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    ใช้แล้ว
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    หมดอายุ
                                </TableHead>
                                <TableHead className="px-5 text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    สถานะ
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {coupons.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="text-center text-sm text-neutral-500 py-8"
                                    >
                                        ยังไม่มีคูปอง
                                    </TableCell>
                                </TableRow>
                            )}
                            {coupons.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell className="px-5 font-mono font-bold text-pink-600">
                                        {c.code}
                                    </TableCell>
                                    <TableCell className="text-sm text-neutral-700">
                                        {c.description ?? '—'}
                                    </TableCell>
                                    <TableCell className="text-right text-sm font-semibold text-neutral-900 tabular-nums">
                                        {c.discount_type === 'free_shipping'
                                            ? 'ส่งฟรี'
                                            : c.discount_type === 'percent'
                                              ? `${c.discount_value}%`
                                              : `฿${c.discount_value}`}
                                        <span className="text-[10px] text-neutral-500 ml-1">
                                            {COUPON_TYPE_LABEL[c.discount_type]}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right text-sm text-neutral-700 tabular-nums">
                                        {c.min_purchase > 0
                                            ? `฿${Number(c.min_purchase).toLocaleString()}`
                                            : '—'}
                                    </TableCell>
                                    <TableCell className="text-center text-sm text-neutral-700 tabular-nums">
                                        {c.used_count}
                                        {c.max_uses ? ` / ${c.max_uses}` : ''}
                                    </TableCell>
                                    <TableCell className="text-xs text-neutral-500 tabular-nums">
                                        {c.valid_until
                                            ? new Date(c.valid_until).toLocaleDateString('th-TH')
                                            : '—'}
                                    </TableCell>
                                    <TableCell className="px-5 text-center">
                                        <span
                                            className={cn(
                                                'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border',
                                                c.status === 'active'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : 'bg-neutral-100 text-neutral-600 border-neutral-200',
                                            )}
                                        >
                                            {c.status}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* ── Create Campaign modal ───────────────────────────────── */}
            <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <Plus size={18} className="text-indigo-600" />
                            สร้างแคมเปญใหม่
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="campaign-name">ชื่อแคมเปญ</Label>
                            <Input
                                id="campaign-name"
                                placeholder="เช่น Songkran Promo 2026"
                                value={newCampaign.name}
                                onChange={(e) =>
                                    setNewCampaign({ ...newCampaign, name: e.target.value })
                                }
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="campaign-type">ประเภท</Label>
                            <select
                                id="campaign-type"
                                value={newCampaign.type}
                                onChange={(e) =>
                                    setNewCampaign({
                                        ...newCampaign,
                                        type: e.target.value as Campaign['type'],
                                    })
                                }
                                className="w-full h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            >
                                {Object.entries(CAMPAIGN_TYPE_LABEL).map(([k, v]) => (
                                    <option key={k} value={k}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="campaign-desc">คำอธิบาย (optional)</Label>
                            <textarea
                                id="campaign-desc"
                                rows={3}
                                value={newCampaign.description}
                                onChange={(e) =>
                                    setNewCampaign({
                                        ...newCampaign,
                                        description: e.target.value,
                                    })
                                }
                                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsCreating(false)}
                        >
                            ยกเลิก
                        </Button>
                        <Button
                            onClick={handleCreateCampaign}
                            disabled={!newCampaign.name.trim()}
                            className="bg-indigo-500 hover:bg-indigo-600"
                        >
                            สร้าง
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
