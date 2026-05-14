import { useEffect, useMemo, useState } from 'react';
import { Search, Eye, ShoppingCart, RefreshCw } from 'lucide-react';
import { ordersApi, type OrderWithCustomer } from '../lib/api';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import OrderDetailModal from '../components/OrderDetailModal';

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending:    'bg-amber-500/10 text-amber-400 border-amber-500/30',
  processing: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  shipped:    'bg-sky-500/10 text-sky-400 border-sky-500/30',
  delivered:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  cancelled:  'bg-slate-500/10 text-slate-400 border-slate-500/30',
  returned:   'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

const TIER_STYLES: Record<string, string> = {
  vip:     'bg-purple-500/20 text-purple-400 border-purple-500/30',
  gold:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  silver:  'bg-slate-400/20 text-slate-300 border-slate-400/30',
  general: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export default function Orders() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<OrderWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      setOrders(await ordersApi.list());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useRealtimeTable('orders', () => void load());

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return o.code.toLowerCase().includes(s)
        || (o.customer?.name.toLowerCase().includes(s) ?? false);
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
    <div className="animate-fade-in p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <ShoppingCart className="w-8 h-8 text-indigo-400" />
            {t.orders.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.orders.subtitle}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => load()}
            className="btn btn-secondary flex items-center gap-2"
            disabled={loading}
            title="Reload"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="relative">
            <input
              type="text"
              placeholder={t.orders.searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800/50 border border-gray-700/50 text-white text-sm rounded-lg pl-10 pr-3 py-2.5 w-64 focus:border-indigo-500 outline-none"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            statusFilter === 'all'
              ? 'bg-indigo-500 border-indigo-500 text-white'
              : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
          }`}
        >
          ทั้งหมด ({statusCounts.all ?? 0})
        </button>
        {(['pending','processing','shipped','delivered','cancelled','returned'] as OrderStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              statusFilter === s
                ? STATUS_STYLES[s] + ' ring-2 ring-offset-1 ring-offset-slate-950 ring-current'
                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
            }`}
          >
            {t.orders.status[s]} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.orders.table.code}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.orders.table.customer}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">รายการ</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-right">{t.orders.table.total}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.common.status}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.orders.table.date}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {loading && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.loading}</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.noData}</td></tr>
              )}
              {!loading && filtered.map(o => (
                <tr key={o.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 px-4 text-sm font-mono text-indigo-400">{o.code}</td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-gray-100">{o.customer?.name ?? '—'}</div>
                    {o.customer?.tier && (
                      <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${TIER_STYLES[o.customer.tier] ?? TIER_STYLES.general}`}>
                        {o.customer.tier}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center text-sm text-slate-300">
                    {o.item_count ?? 0}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-emerald-400">
                    ฿{Number(o.total).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <select
                      value={o.status}
                      onChange={e => handleStatusChange(o, e.target.value as OrderStatus)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded border outline-none cursor-pointer ${STATUS_STYLES[o.status as OrderStatus]}`}
                    >
                      {(['pending','processing','shipped','delivered','cancelled','returned'] as OrderStatus[]).map(s => (
                        <option key={s} value={s} className="bg-slate-900 text-white">
                          {t.orders.status[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-400">
                    {new Date(o.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => setDetailOrderId(o.id)}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium px-3 py-1.5 rounded flex items-center gap-1 mx-auto bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                      title={t.common.details}
                    >
                      <Eye size={14} /> {t.common.details}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <OrderDetailModal
        isOpen={detailOrderId !== null}
        orderId={detailOrderId}
        onClose={() => setDetailOrderId(null)}
        onStatusChange={() => void load()}
      />
    </div>
  );
}
