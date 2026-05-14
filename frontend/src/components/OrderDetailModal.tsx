import { useEffect, useState } from 'react';
import { X, ShoppingBag, User, Calendar, CreditCard, Truck } from 'lucide-react';
import { ordersApi, type OrderWithCustomer } from '../lib/api';
import type { OrderItem } from '../lib/database.types';

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
  delivered:  'ส่งถึงปลายทาง',
  cancelled:  'ยกเลิก',
  returned:   'คืนสินค้า',
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending:    'bg-amber-500/10 text-amber-400 border-amber-500/30',
  processing: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  shipped:    'bg-sky-500/10 text-sky-400 border-sky-500/30',
  delivered:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  cancelled:  'bg-slate-500/10 text-slate-400 border-slate-500/30',
  returned:   'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

function formatTHB(v: number | string): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(v));
}

export default function OrderDetailModal({ isOpen, orderId, onClose, onStatusChange }: Props) {
  const [order, setOrder] = useState<OrderWithCustomer | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !orderId) return;
    setLoading(true); setErr(null);
    ordersApi.getById(orderId)
      .then(({ order, items }) => { setOrder(order); setItems(items); })
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [isOpen, orderId]);

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-gradient-to-br from-indigo-500/10 to-rose-500/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ShoppingBag size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">รายละเอียดคำสั่งซื้อ</h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[0.2em] font-black">
                {order?.code ?? 'Loading...'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}
          {loading && <div className="text-center py-12 text-slate-400">กำลังโหลด...</div>}

          {!loading && order && (
            <>
              {/* Top metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InfoTile icon={<User size={14} />} label="ลูกค้า" value={order.customer?.name ?? '—'} />
                <InfoTile icon={<Calendar size={14} />} label="วันที่"
                  value={new Date(order.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })} />
                <InfoTile icon={<CreditCard size={14} />} label="การชำระเงิน" value={order.payment_status} />
                <InfoTile icon={<Truck size={14} />} label="ช่องทาง" value={order.channel} />
              </div>

              {/* Status selector */}
              <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">เปลี่ยนสถานะ</div>
                <div className="flex flex-wrap gap-2">
                  {(['pending','processing','shipped','delivered','cancelled','returned'] as OrderStatus[]).map(s => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                        order.status === s
                          ? STATUS_STYLES[s] + ' ring-2 ring-current'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items */}
              <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">รายการสินค้า ({items.length})</div>
                {items.length === 0 ? (
                  <div className="text-sm text-slate-500">ยังไม่มีรายการ</div>
                ) : (
                  <div className="space-y-2">
                    {items.map(it => (
                      <div key={it.id} className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{it.product_name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{it.sku} × {it.quantity} @ {formatTHB(it.unit_price)}</div>
                        </div>
                        <div className="text-sm font-bold text-emerald-400">{formatTHB(it.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="rounded-xl border border-white/5 bg-white/5 p-4 space-y-2">
                <Row label="ยอดสินค้า" value={formatTHB(order.subtotal)} />
                {Number(order.discount) > 0 && <Row label="ส่วนลด" value={`- ${formatTHB(order.discount)}`} />}
                <Row label="ภาษี (VAT)" value={formatTHB(order.vat)} />
                {Number(order.shipping_fee) > 0 && <Row label="ค่าจัดส่ง" value={formatTHB(order.shipping_fee)} />}
                <div className="border-t border-white/10 pt-2 mt-2">
                  <Row label="ยอดสุทธิ" value={formatTHB(order.total)} bold />
                </div>
              </div>

              {order.notes && (
                <div className="rounded-xl border border-white/5 bg-white/5 p-4">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">หมายเหตุ</div>
                  <div className="text-sm text-slate-300">{order.notes}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/5 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-white truncate">{value}</div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={bold ? 'text-white font-bold' : 'text-slate-400'}>{label}</span>
      <span className={bold ? 'text-emerald-400 font-bold text-lg' : 'text-slate-300'}>{value}</span>
    </div>
  );
}
