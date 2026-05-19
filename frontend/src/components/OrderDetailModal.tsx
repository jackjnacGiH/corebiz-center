import { useEffect, useState, type ReactNode } from 'react';
import { ShoppingBag, User, Calendar, CreditCard, Truck, Loader2 } from 'lucide-react';
import { ordersApi, type OrderWithCustomer } from '../lib/api';
import type { OrderItem } from '../lib/database.types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col">
                {/* ── Header ──────────────────────────────────────────── */}
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <ShoppingBag size={20} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                รายละเอียดคำสั่งซื้อ
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold font-mono">
                                {order?.code ?? 'Loading...'}
                            </p>
                        </div>
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
                            {/* Top metadata */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <InfoTile
                                    icon={<User size={13} />}
                                    label="ลูกค้า"
                                    value={order.customer?.name ?? '—'}
                                />
                                <InfoTile
                                    icon={<Calendar size={13} />}
                                    label="วันที่"
                                    value={new Date(order.created_at).toLocaleDateString('th-TH', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                    })}
                                />
                                <InfoTile
                                    icon={<CreditCard size={13} />}
                                    label="การชำระเงิน"
                                    value={order.payment_status}
                                />
                                <InfoTile
                                    icon={<Truck size={13} />}
                                    label="ช่องทาง"
                                    value={order.channel}
                                />
                            </div>

                            {/* Status selector */}
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

                            {/* Items */}
                            <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-3">
                                    รายการสินค้า ({items.length})
                                </div>
                                {items.length === 0 ? (
                                    <div className="text-sm text-neutral-500 py-2">
                                        ยังไม่มีรายการ
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {items.map((it) => (
                                            <div
                                                key={it.id}
                                                className="flex items-center justify-between gap-4 py-2.5 border-b border-neutral-200 last:border-0"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-semibold text-neutral-900 truncate">
                                                        {it.product_name}
                                                    </div>
                                                    <div className="text-xs text-neutral-500 mt-0.5 tabular-nums">
                                                        {it.sku} × {it.quantity} @{' '}
                                                        {formatTHB(it.unit_price)}
                                                    </div>
                                                </div>
                                                <div className="text-sm font-bold text-emerald-700 tabular-nums">
                                                    {formatTHB(it.total)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Totals */}
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-2">
                                <Row label="ยอดสินค้า" value={formatTHB(order.subtotal)} />
                                {Number(order.discount) > 0 && (
                                    <Row
                                        label="ส่วนลด"
                                        value={`- ${formatTHB(order.discount)}`}
                                    />
                                )}
                                <Row label="ภาษี (VAT)" value={formatTHB(order.vat)} />
                                {Number(order.shipping_fee) > 0 && (
                                    <Row
                                        label="ค่าจัดส่ง"
                                        value={formatTHB(order.shipping_fee)}
                                    />
                                )}
                                <div className="border-t border-neutral-200 pt-2 mt-2">
                                    <Row
                                        label="ยอดสุทธิ"
                                        value={formatTHB(order.total)}
                                        bold
                                    />
                                </div>
                            </div>

                            {order.notes && (
                                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                    <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">
                                        หมายเหตุ
                                    </div>
                                    <div className="text-sm text-neutral-700 leading-relaxed">
                                        {order.notes}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">
                {icon}
                {label}
            </div>
            <div className="text-sm font-semibold text-neutral-900 truncate">{value}</div>
        </div>
    );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
    return (
        <div className="flex justify-between items-baseline text-sm">
            <span className={cn(bold ? 'text-neutral-900 font-bold' : 'text-neutral-600')}>
                {label}
            </span>
            <span
                className={cn(
                    'tabular-nums',
                    bold
                        ? 'text-emerald-700 font-bold text-lg'
                        : 'text-neutral-700 font-medium',
                )}
            >
                {value}
            </span>
        </div>
    );
}
