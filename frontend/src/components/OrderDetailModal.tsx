import { useEffect, useState } from 'react';
import { ShoppingBag, Loader2, Pencil } from 'lucide-react';
import { ordersApi, orgSettingsApi, productsApi, type OrderWithCustomer, type ProductWithInventory } from '../lib/api';
import type { OrderItem } from '../lib/database.types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import QuoteDocument, { type OrgInfo, formatThaiAddress } from './QuoteDocument';
import EditableQuoteItems, { type EditLine } from './EditableQuoteItems';

interface Props {
    isOpen: boolean;
    orderId: string | null;
    onClose: () => void;
    onStatusChange?: () => void;
}

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';

const STATUS_LABELS: Record<OrderStatus, string> = {
    pending:    'รอดำเนินการ',
    processing: 'กำลังเตรียม',
    shipped:    'จัดส่งแล้ว',
    delivered:  'รับสินค้าแล้ว',
    cancelled:  'ยกเลิก',
    returned:   'คืนสินค้า',
};

const STATUS_STYLES: Record<OrderStatus, string> = {
    pending:    'bg-amber-50    text-amber-700   border-amber-200',
    processing: 'bg-indigo-50   text-indigo-700  border-indigo-200',
    shipped:    'bg-sky-50      text-sky-700     border-sky-200',
    delivered:  'bg-emerald-50  text-emerald-700 border-emerald-200',
    cancelled:  'bg-neutral-100 text-neutral-700 border-neutral-200',
    returned:   'bg-red-50      text-red-700     border-red-200',
};

const STATUS_ORDER: OrderStatus[] = [
    'pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned',
];

function formatTHB(v: number | string): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        maximumFractionDigits: 0,
    }).format(Number(v));
}

export default function OrderDetailModal({
    isOpen,
    orderId,
    onClose,
    onStatusChange,
}: Props) {
    const [order, setOrder] = useState<OrderWithCustomer | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [org, setOrg] = useState<OrgInfo | null>(null);
    const [editing, setEditing] = useState(false);
    const [products, setProducts] = useState<ProductWithInventory[]>([]);
    const [savingItems, setSavingItems] = useState(false);

    useEffect(() => {
        if (!isOpen) { setEditing(false); return; }
        orgSettingsApi.get().then((o) => setOrg(o)).catch(() => setOrg(null));
    }, [isOpen]);

    async function enterEdit() {
        setErr(null);
        try {
            if (products.length === 0) setProducts(await productsApi.list());
            setEditing(true);
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function saveItems(lines: EditLine[], discount: number) {
        if (!order) return;
        setSavingItems(true);
        setErr(null);
        try {
            await ordersApi.updateItems(order.id, lines.map((l) => ({
                product_id: l.product_id ?? undefined, sku: l.sku, product_name: l.product_name,
                quantity: l.quantity, unit_price: l.unit_price, discount: 0,
            })), discount, Number((order as { shipping_fee?: number }).shipping_fee ?? 0));
            const fresh = await ordersApi.getById(order.id);
            setOrder(fresh.order);
            setItems(fresh.items);
            setEditing(false);
            onStatusChange?.();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSavingItems(false);
        }
    }

    useEffect(() => {
        if (!isOpen || !orderId) return;
        setLoading(true);
        setErr(null);
        ordersApi
            .getById(orderId)
            .then(({ order, items }) => {
                setOrder(order);
                setItems(items);
            })
            .catch((e) => setErr((e as Error).message))
            .finally(() => setLoading(false));
    }, [isOpen, orderId]);

    async function handleStatusChange(newStatus: OrderStatus) {
        if (!order) return;
        try {
            await ordersApi.updateStatus(order.id, newStatus);
            setOrder({ ...order, status: newStatus });
            onStatusChange?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    // Once shipped/delivered the document becomes a delivery note (ใบส่งของ)
    // with the same running number, prefix swapped to DN-.
    const isDelivery = order?.status === 'shipped' || order?.status === 'delivered';
    const docTitle = isDelivery ? 'ใบส่งของ' : 'ใบสั่งขาย';
    const docCode = order ? (isDelivery ? order.code.replace(/^(SO|ORD|QT)-/, 'DN-') : order.code) : '';

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-4xl p-0 gap-0 max-h-[90vh] flex flex-col">
                {/* ── Header ──────────────────────────────────────────── */}
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <ShoppingBag size={20} className="text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                รายละเอียดคำสั่งซื้อ
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold font-mono">
                                {order?.code ?? 'Loading...'}
                            </p>
                        </div>
                        {order && (
                            <span className={cn('px-3 py-1.5 rounded-md text-xs font-bold border flex-shrink-0', STATUS_STYLES[order.status as OrderStatus] ?? STATUS_STYLES.pending)}>
                                {STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                            </span>
                        )}
                    </div>
                </DialogHeader>

                {/* ── Body ────────────────────────────────────────────── */}
                <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
                    {err && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            ✗ {err}
                        </div>
                    )}
                    {loading && (
                        <div className="text-center py-12 text-neutral-500 flex items-center justify-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            กำลังโหลด...
                        </div>
                    )}

                    {!loading && order && (
                        <>
                            {/* Payment + channel quick info */}
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="px-2 py-1 rounded bg-neutral-100 text-neutral-600">การชำระเงิน: {order.payment_status}</span>
                                <span className="px-2 py-1 rounded bg-neutral-100 text-neutral-600">ช่องทาง: {order.channel}</span>
                            </div>

                            {/* Status selector (order management) */}
                            <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-3">
                                    เปลี่ยนสถานะ
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {STATUS_ORDER.map((s) => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => handleStatusChange(s)}
                                            className={cn(
                                                'px-3 py-1.5 rounded-full text-xs font-semibold border transition',
                                                order.status === s
                                                    ? STATUS_STYLES[s] + ' ring-2 ring-offset-1 ring-current'
                                                    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50',
                                            )}
                                        >
                                            {STATUS_LABELS[s]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Edit items */}
                            {!editing && (
                                <div className="flex justify-end">
                                    <button type="button" onClick={() => void enterEdit()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-50">
                                        <Pencil size={13} /> แก้ไขรายการ
                                    </button>
                                </div>
                            )}

                            {editing ? (
                                <EditableQuoteItems
                                    initial={items.map((it) => ({
                                        product_id: it.product_id, sku: it.sku, product_name: it.product_name,
                                        quantity: it.quantity, unit_price: Number(it.unit_price), discount: 0,
                                    }))}
                                    initialDiscount={Number(order.discount) || items.reduce((s, it) => s + Number((it as { discount?: number }).discount ?? 0), 0)}
                                    products={products}
                                    format={formatTHB}
                                    onSave={saveItems}
                                    onCancel={() => setEditing(false)}
                                    busy={savingItems}
                                />
                            ) : (
                                /* Same document layout as the quotation — title + SO-/DN- code differ */
                                <QuoteDocument
                                    org={org}
                                    title={docTitle}
                                    code={docCode}
                                    dateLabel={new Date(order.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                                    customerName={order.customer?.name ?? '— ลูกค้าทั่วไป —'}
                                    customerAddress={
                                        formatThaiAddress((order.customer as { billing_address?: unknown } | null)?.billing_address)
                                        || formatThaiAddress((order as { shipping_address?: unknown }).shipping_address)
                                    }
                                    customerTaxId={(order.customer as { tax_id?: string | null } | null)?.tax_id ?? null}
                                    items={items.map((it) => ({
                                        name: it.product_name, sku: it.sku, qty: it.quantity,
                                        unit: Number(it.unit_price),
                                        lineDisc: Number((it as { discount?: number }).discount ?? 0),
                                        total: Number(it.total),
                                    }))}
                                    subtotal={Number(order.subtotal)}
                                    discount={Number(order.discount)}
                                    net={Number(order.subtotal) - Number(order.discount)}
                                    vat={Number(order.vat)}
                                    total={Number(order.total)}
                                    note={order.notes}
                                    format={formatTHB}
                                />
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

