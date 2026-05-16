import { useEffect, useMemo, useState } from 'react';
import { Search, Eye, ShoppingCart, RefreshCw } from 'lucide-react';
import { ordersApi, type OrderWithCustomer } from '../lib/api';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import OrderDetailModal from '../components/OrderDetailModal';
import PageHeader from '../components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';

const STATUS_STYLES: Record<OrderStatus, string> = {
    pending:    'bg-amber-50    text-amber-700   border-amber-200',
    processing: 'bg-indigo-50   text-indigo-700  border-indigo-200',
    shipped:    'bg-sky-50      text-sky-700     border-sky-200',
    delivered:  'bg-emerald-50  text-emerald-700 border-emerald-200',
    cancelled:  'bg-neutral-100 text-neutral-700 border-neutral-200',
    returned:   'bg-red-50      text-red-700     border-red-200',
};

const TIER_STYLES: Record<string, string> = {
    vip:     'bg-purple-50  text-purple-700  border-purple-200',
    gold:    'bg-amber-50   text-amber-800   border-amber-300',
    silver:  'bg-slate-100  text-slate-700   border-slate-300',
    general: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};

const STATUS_ORDER: OrderStatus[] = [
    'pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned',
];

export default function Orders() {
    const { t } = useLanguage();
    const [orders, setOrders] = useState<OrderWithCustomer[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
    const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setOrders(await ordersApi.list());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);
    useRealtimeTable('orders', () => void load());

    const filtered = useMemo(() => {
        return orders.filter((o) => {
            if (statusFilter !== 'all' && o.status !== statusFilter) return false;
            if (!search) return true;
            const s = search.toLowerCase();
            return (
                o.code.toLowerCase().includes(s) ||
                (o.customer?.name.toLowerCase().includes(s) ?? false)
            );
        });
    }, [orders, search, statusFilter]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: orders.length };
        for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
        return counts;
    }, [orders]);

    async function handleStatusChange(o: OrderWithCustomer, newStatus: OrderStatus) {
        try {
            await ordersApi.updateStatus(o.id, newStatus);
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title={t.orders.title}
                subtitle={t.orders.subtitle}
                icon={<ShoppingCart size={20} />}
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
                        <div className="relative">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                            />
                            <Input
                                type="text"
                                placeholder={t.orders.searchPlaceholder}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 w-64"
                            />
                        </div>
                    </>
                }
            />

            {/* Status filter chips */}
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                        statusFilter === 'all'
                            ? 'bg-indigo-500 border-indigo-500 text-white'
                            : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50',
                    )}
                >
                    ทั้งหมด ({statusCounts.all ?? 0})
                </button>
                {STATUS_ORDER.map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        className={cn(
                            'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                            statusFilter === s
                                ? STATUS_STYLES[s] + ' ring-2 ring-offset-1 ring-current'
                                : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50',
                        )}
                    >
                        {t.orders.status[s]} ({statusCounts[s] ?? 0})
                    </button>
                ))}
            </div>

            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    ✗ {err}
                </div>
            )}

            <Card className="gap-0 py-0 overflow-hidden">
                <CardContent className="px-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                                <TableHead className="px-5 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.orders.table.code}
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.orders.table.customer}
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    รายการ
                                </TableHead>
                                <TableHead className="text-right text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.orders.table.total}
                                </TableHead>
                                <TableHead className="text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.common.status}
                                </TableHead>
                                <TableHead className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.orders.table.date}
                                </TableHead>
                                <TableHead className="px-5 text-center text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                                    {t.common.actions}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.loading}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading && filtered.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="text-center text-sm text-neutral-500 py-12"
                                    >
                                        {t.common.noData}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading &&
                                filtered.map((o) => (
                                    <TableRow key={o.id}>
                                        <TableCell className="px-5 font-mono text-sm text-indigo-600">
                                            {o.code}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-semibold text-neutral-900">
                                                {o.customer?.name ?? '—'}
                                            </div>
                                            {o.customer?.tier && (
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border tracking-wider',
                                                        TIER_STYLES[o.customer.tier] ??
                                                            TIER_STYLES.general,
                                                    )}
                                                >
                                                    {o.customer.tier}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center text-sm text-neutral-700 tabular-nums">
                                            {o.item_count ?? 0}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-emerald-700 tabular-nums">
                                            ฿{Number(o.total).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <select
                                                value={o.status}
                                                onChange={(e) =>
                                                    handleStatusChange(
                                                        o,
                                                        e.target.value as OrderStatus,
                                                    )
                                                }
                                                className={cn(
                                                    'text-xs font-semibold px-2.5 py-1 rounded-md border outline-none cursor-pointer',
                                                    STATUS_STYLES[o.status as OrderStatus],
                                                )}
                                            >
                                                {STATUS_ORDER.map((s) => (
                                                    <option
                                                        key={s}
                                                        value={s}
                                                        className="bg-white text-neutral-900"
                                                    >
                                                        {t.orders.status[s]}
                                                    </option>
                                                ))}
                                            </select>
                                        </TableCell>
                                        <TableCell className="text-sm text-neutral-500 tabular-nums">
                                            {new Date(o.created_at).toLocaleDateString('th-TH', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </TableCell>
                                        <TableCell className="px-5 text-center">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setDetailOrderId(o.id)}
                                                className="h-8 gap-1 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                                                title={t.common.details}
                                            >
                                                <Eye size={13} /> {t.common.details}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <OrderDetailModal
                isOpen={detailOrderId !== null}
                orderId={detailOrderId}
                onClose={() => setDetailOrderId(null)}
                onStatusChange={() => void load()}
            />
        </div>
    );
}
