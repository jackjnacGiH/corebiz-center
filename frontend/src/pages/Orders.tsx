import { useEffect, useMemo, useState } from 'react';
import { Search, Eye, ShoppingCart, RefreshCw, FileText, CheckCircle2 } from 'lucide-react';
import {
    ordersApi,
    quoteRecordApi,
    type OrderWithCustomer,
    type QuoteListItem,
} from '../lib/api';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import OrderDetailModal from '../components/OrderDetailModal';
import QuoteDetailModal from '../components/QuoteDetailModal';
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

/**
 * A unified row that the table renders, regardless of whether the underlying
 * record is a Quote (waiting for admin approval) or an Order (already a
 * committed sale). Quotes never reach statuses past "pending" — once
 * approved they're converted to an Order which then walks through
 * processing → shipped → delivered.
 */
type UnifiedRow =
    | {
          kind: 'quote';
          id: string;
          code: string;
          customerName: string | null;
          customerTier: string | null;
          itemCount: number;
          total: number;
          createdAt: string;
          // Quotes in 'draft' or 'sent' map to the pending tab so the admin
          // sees both new quotes and new orders in one place. 'accepted'
          // hides because the linked order replaces it.
          tabBucket: OrderStatus | 'accepted' | 'rejected' | 'expired';
          quoteStatus: string;
      }
    | {
          kind: 'order';
          id: string;
          code: string;
          customerName: string | null;
          customerTier: string | null;
          itemCount: number;
          total: number;
          createdAt: string;
          tabBucket: OrderStatus;
          orderStatus: OrderStatus;
      };

const STATUS_STYLES: Record<OrderStatus, string> = {
    pending:    'bg-amber-50    text-amber-700   border-amber-200',
    processing: 'bg-indigo-50   text-indigo-700  border-indigo-200',
    shipped:    'bg-sky-50      text-sky-700     border-sky-200',
    delivered:  'bg-emerald-50  text-emerald-700 border-emerald-200',
    cancelled:  'bg-neutral-100 text-neutral-700 border-neutral-200',
    returned:   'bg-red-50      text-red-700     border-red-200',
};

const QUOTE_STATUS_STYLES: Record<string, string> = {
    draft:    'bg-amber-50    text-amber-700   border-amber-200',
    sent:     'bg-blue-50     text-blue-700    border-blue-200',
    rejected: 'bg-red-50      text-red-700     border-red-200',
    expired:  'bg-neutral-100 text-neutral-700 border-neutral-200',
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
    draft:    'รอดำเนินการ',
    sent:     'ส่งให้ลูกค้าแล้ว',
    rejected: 'ปฏิเสธ',
    expired:  'หมดอายุ',
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
    const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
    const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
    const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            // Pull both in parallel — both are small tables relative to UI
            // page size; we filter / paginate client-side.
            const [o, q] = await Promise.all([
                ordersApi.list(),
                quoteRecordApi.list().catch(() => []),
            ]);
            setOrders(o);
            setQuotes(q);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, []);
    useRealtimeTable('orders', () => void load());
    useRealtimeTable('quotes', () => void load());

    /** Merge orders + quotes into a single, sortable, filterable view. */
    const rows: UnifiedRow[] = useMemo(() => {
        const orderRows: UnifiedRow[] = orders.map((o) => ({
            kind: 'order',
            id: o.id,
            code: o.code,
            customerName: o.customer?.name ?? null,
            customerTier: o.customer?.tier ?? null,
            itemCount: o.item_count ?? 0,
            total: Number(o.total),
            createdAt: o.created_at,
            tabBucket: o.status as OrderStatus,
            orderStatus: o.status as OrderStatus,
        }));

        const quoteRows: UnifiedRow[] = quotes
            // Quotes that were approved into an order are represented by the
            // order side — hide the duplicate to avoid two rows for one sale.
            .filter((q) => !(q.status === 'accepted' && q.converted_to_order_id))
            .map((q) => ({
                kind: 'quote',
                id: q.id,
                code: q.code,
                customerName: q.customer?.name ?? null,
                customerTier: null,
                itemCount: 0, // Quote rows don't carry an item count from list — keep simple
                total: Number(q.total),
                createdAt: q.created_at,
                // draft + sent both fall into "รอดำเนินการ" because that's
                // exactly what the admin needs to act on. rejected/expired
                // get their own tab via the cancelled bucket.
                tabBucket:
                    q.status === 'draft' || q.status === 'sent'
                        ? 'pending'
                        : q.status === 'rejected' || q.status === 'expired'
                          ? 'cancelled'
                          : 'pending',
                quoteStatus: q.status,
            }));

        return [...orderRows, ...quoteRows].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
        );
    }, [orders, quotes]);

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            if (statusFilter !== 'all' && r.tabBucket !== statusFilter) return false;
            if (!search) return true;
            const s = search.toLowerCase();
            return (
                r.code.toLowerCase().includes(s) ||
                (r.customerName?.toLowerCase().includes(s) ?? false)
            );
        });
    }, [rows, search, statusFilter]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: rows.length };
        for (const r of rows) counts[r.tabBucket] = (counts[r.tabBucket] ?? 0) + 1;
        return counts;
    }, [rows]);

    async function handleStatusChange(orderId: string, newStatus: OrderStatus) {
        try {
            await ordersApi.updateStatus(orderId, newStatus);
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
                        <div className="relative w-full sm:w-auto">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                            />
                            <Input
                                type="text"
                                placeholder={t.orders.searchPlaceholder}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 w-full sm:w-64"
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
                                    ประเภท
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
                                    <TableCell colSpan={7} className="text-center text-sm text-neutral-500 py-12">
                                        {t.common.loading}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading && filtered.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-sm text-neutral-500 py-12">
                                        {t.common.noData}
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading &&
                                filtered.map((r) => (
                                    <TableRow
                                        key={`${r.kind}-${r.id}`}
                                        className={r.kind === 'quote' ? 'bg-amber-50/30' : undefined}
                                    >
                                        <TableCell className="px-5 font-mono text-sm">
                                            <span className={r.kind === 'quote' ? 'text-amber-700' : 'text-indigo-600'}>
                                                {r.code}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-semibold text-neutral-900">
                                                {r.customerName ?? '—'}
                                            </div>
                                            {r.customerTier && (
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border tracking-wider',
                                                        TIER_STYLES[r.customerTier] ?? TIER_STYLES.general,
                                                    )}
                                                >
                                                    {r.customerTier}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {r.kind === 'quote' ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                                    <FileText size={10} /> ใบเสนอราคา
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
                                                    <ShoppingCart size={10} /> คำสั่งซื้อ
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-emerald-700 tabular-nums">
                                            ฿{r.total.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {r.kind === 'order' ? (
                                                <select
                                                    value={r.orderStatus}
                                                    onChange={(e) =>
                                                        handleStatusChange(r.id, e.target.value as OrderStatus)
                                                    }
                                                    className={cn(
                                                        'text-xs font-semibold px-2.5 py-1 rounded-md border outline-none cursor-pointer',
                                                        STATUS_STYLES[r.orderStatus],
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
                                            ) : (
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border',
                                                        QUOTE_STATUS_STYLES[r.quoteStatus] ?? QUOTE_STATUS_STYLES.draft,
                                                    )}
                                                >
                                                    {QUOTE_STATUS_LABELS[r.quoteStatus] ?? r.quoteStatus}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-neutral-500 tabular-nums">
                                            {new Date(r.createdAt).toLocaleDateString('th-TH', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </TableCell>
                                        <TableCell className="px-5 text-center">
                                            {r.kind === 'quote' ? (
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => setDetailQuoteId(r.id)}
                                                        className="h-8 gap-1 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                                                        title="ดูใบเสนอราคา"
                                                    >
                                                        <Eye size={13} /> ดู
                                                    </Button>
                                                    {(r.quoteStatus === 'draft' || r.quoteStatus === 'sent') && (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => setDetailQuoteId(r.id)}
                                                            className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
                                                            title="อนุมัติเป็นคำสั่งซื้อ"
                                                        >
                                                            <CheckCircle2 size={13} /> อนุมัติ
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setDetailOrderId(r.id)}
                                                    className="h-8 gap-1 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                                                    title={t.common.details}
                                                >
                                                    <Eye size={13} /> {t.common.details}
                                                </Button>
                                            )}
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

            <QuoteDetailModal
                isOpen={detailQuoteId !== null}
                quoteId={detailQuoteId}
                onClose={() => setDetailQuoteId(null)}
                onChange={() => void load()}
            />
        </div>
    );
}
