import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  TrendingUp, ShoppingCart, Package, Users, ArrowUpRight, ArrowDownRight, Activity,
  ShoppingBag, UserPlus, Boxes, RefreshCw,
} from 'lucide-react';
import N8nAssistant from '../components/N8nAssistant';
import { dashboardApi, type DashboardKPI, type MonthlyRevenue, type ActivityEvent } from '../lib/api';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { useLanguage } from '../i18n';

function formatTHB(value: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value);
}

const MONTH_LABEL: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
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

const ACTIVITY_STYLE: Record<ActivityEvent['type'], { color: string; Icon: React.ComponentType<{ size?: number }> }> = {
  order:     { color: 'bg-indigo-500',  Icon: ShoppingBag },
  customer:  { color: 'bg-emerald-500', Icon: UserPlus },
  inventory: { color: 'bg-amber-500',   Icon: Boxes },
  system:    { color: 'bg-slate-500',   Icon: Activity },
};

const Dashboard = () => {
  const { t } = useLanguage();
  const [kpi, setKpi] = useState<DashboardKPI | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRevenue[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [k, m, a] = await Promise.all([
        dashboardApi.getKPI(),
        dashboardApi.getMonthlyRevenue(7),
        dashboardApi.getRecentActivity(8),
      ]);
      setKpi(k); setMonthly(m); setActivity(a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  // Realtime refresh on order/customer/inventory changes
  useRealtimeTable('orders', () => void load());
  useRealtimeTable('customers', () => void load());
  useRealtimeTable('inventory', () => void load());

  const chartData = monthly.map(m => {
    const monthCode = m.month.split('-')[1];
    return { name: MONTH_LABEL[monthCode] ?? m.month, sales: m.revenue };
  });

  const kpiCards = kpi ? [
    {
      title: t.dashboard.kpi.revenue,
      value: formatTHB(kpi.total_revenue),
      change: `${kpi.revenue_delta_pct >= 0 ? '+' : ''}${kpi.revenue_delta_pct.toFixed(1)}%`,
      isUp: kpi.revenue_delta_pct >= 0,
      icon: <TrendingUp size={20} />,
      colorCls: 'text-emerald-400',
      bgCls: 'bg-emerald-500/10',
    },
    {
      title: t.dashboard.kpi.activeOrders,
      value: String(kpi.active_orders),
      change: 'active',
      isUp: true,
      icon: <ShoppingCart size={20} />,
      colorCls: 'text-indigo-400',
      bgCls: 'bg-indigo-500/10',
    },
    {
      title: t.dashboard.kpi.lowStock,
      value: String(kpi.low_stock_count),
      change: kpi.low_stock_count > 0 ? 'attention' : 'OK',
      isUp: kpi.low_stock_count === 0,
      icon: <Package size={20} />,
      colorCls: 'text-amber-400',
      bgCls: 'bg-amber-500/10',
    },
    {
      title: t.dashboard.kpi.newCustomers,
      value: String(kpi.new_customers_30d),
      change: '30d',
      isUp: true,
      icon: <Users size={20} />,
      colorCls: 'text-rose-400',
      bgCls: 'bg-rose-500/10',
    },
  ] : [];

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            {t.dashboard.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.dashboard.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-secondary text-sm flex items-center gap-2"
            onClick={() => load()}
            disabled={loading}
            title="Reload"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
          <button className="btn btn-secondary text-sm">{t.dashboard.downloadLogs}</button>
          <button className="btn btn-primary text-sm shadow-lg shadow-indigo-500/20">{t.dashboard.generateReport}</button>
        </div>
      </div>

      <N8nAssistant />

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card animate-pulse">
            <div className="h-12 bg-white/5 rounded mb-3" />
            <div className="h-4 bg-white/5 rounded w-2/3 mb-2" />
            <div className="h-8 bg-white/5 rounded w-1/2" />
          </div>
        ))}
        {!loading && kpiCards.map((c, i) => (
          <div key={i} className="glass-card group hover:translate-y-[-4px] transition-all duration-300">
            <div className="flex justify-between items-start mb-4">
              <div className={`${c.colorCls} ${c.bgCls} p-2.5 rounded-xl`}>{c.icon}</div>
              <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                c.isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}>
                {c.isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {c.change}
              </div>
            </div>
            <h3 className="text-slate-400 text-sm font-medium">{c.title}</h3>
            <div className="text-2xl font-bold mt-1 text-white tracking-tight">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="glass-card xl:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-xl font-bold text-white">{t.dashboard.chart.title}</h2>
              <p className="text-slate-400 text-sm">{t.dashboard.chart.subtitle}</p>
            </div>
          </div>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  tickFormatter={(v) => `฿${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff', fontSize: '14px' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                  formatter={(value) => formatTHB(Number(value))}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  stroke="var(--primary)"
                  strokeWidth={4}
                  dot={{ r: 4, fill: 'var(--primary)', strokeWidth: 2, stroke: '#1e293b' }}
                  activeDot={{ r: 8, strokeWidth: 0 }}
                  animationDuration={1500}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">{t.dashboard.activity.title}</h2>
            <span className="text-indigo-400 bg-indigo-500/10 p-2 rounded-lg">
              <Activity size={18} />
            </span>
          </div>
          <div className="space-y-5 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />
            ))}
            {!loading && activity.length === 0 && (
              <div className="text-sm text-slate-500 py-4">{t.common.noData}</div>
            )}
            {!loading && activity.map(e => {
              const { color, Icon } = ACTIVITY_STYLE[e.type];
              return (
                <div key={e.id} className="flex gap-3 group">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}/20 text-white flex-shrink-0`}>
                    <Icon size={14} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-indigo-400 transition-colors">{e.message}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{relativeTime(e.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
