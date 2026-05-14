import { useEffect, useMemo, useState } from 'react';
import { Target, BarChart2, Zap, Ticket, RefreshCw, Play, Pause, Plus, X } from 'lucide-react';
import { campaignsApi, couponsApi, type Campaign, type Coupon } from '../lib/api';
import { useLanguage } from '../i18n';

const CAMPAIGN_STATUS_STYLE: Record<Campaign['status'], string> = {
  draft:     'bg-slate-500/10 text-slate-400 border-slate-500/30',
  scheduled: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  running:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  paused:    'bg-orange-500/10 text-orange-400 border-orange-500/30',
  completed: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  cancelled: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
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

export default function Marketing() {
  const { t } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', type: 'promotion' as Campaign['type'], description: '' });

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [c, cp] = await Promise.all([campaignsApi.list(), couponsApi.list()]);
      setCampaigns(c); setCoupons(cp);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const running = campaigns.filter(c => c.status === 'running').length;
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
    <div className="animate-fade-in p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Target className="w-8 h-8 text-indigo-400" />
            {t.marketing.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.marketing.subtitle}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => load()} className="btn btn-secondary flex items-center gap-2" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg shadow-lg shadow-indigo-500/20"
          >
            <Zap size={18} /> {t.marketing.createCampaign}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={<Zap size={20} />} label="แคมเปญที่ใช้งาน" value={stats.running.toString()} color="indigo" />
        <StatTile icon={<BarChart2 size={20} />} label="Impressions" value={stats.totalImpr.toLocaleString()} color="blue" />
        <StatTile icon={<Target size={20} />} label="Conversions" value={stats.totalConv.toLocaleString()} color="emerald" />
        <StatTile icon={<BarChart2 size={20} />} label="Revenue" value={`฿${stats.totalRev.toLocaleString()}`} color="amber" />
      </div>

      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">✗ {err}</div>}

      {/* Campaigns */}
      <div className="glass-card">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
          <Target size={20} className="text-indigo-400" />
          {t.marketing.activeCampaigns}
        </h2>
        <div className="space-y-3">
          {loading && <div className="text-sm text-slate-500 py-4">{t.common.loading}</div>}
          {!loading && campaigns.length === 0 && (
            <div className="text-sm text-slate-500 py-4 text-center">ยังไม่มีแคมเปญ — คลิก "สร้างแคมเปญ" ด้านบน</div>
          )}
          {campaigns.map(c => (
            <div key={c.id} className="flex items-center justify-between p-4 rounded-lg border border-white/5 bg-white/5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 uppercase">
                    {CAMPAIGN_TYPE_LABEL[c.type]}
                  </span>
                </div>
                {c.description && <div className="text-xs text-slate-400 mt-1">{c.description}</div>}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  {c.metrics.impressions !== undefined && (
                    <span>👁 {c.metrics.impressions.toLocaleString()}</span>
                  )}
                  {c.metrics.conversions !== undefined && (
                    <span className="text-emerald-400">✓ {c.metrics.conversions} conv</span>
                  )}
                  {c.metrics.revenue !== undefined && c.metrics.revenue > 0 && (
                    <span className="text-emerald-400">฿{c.metrics.revenue.toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <span className={`px-2.5 py-1 rounded text-xs font-semibold border ${CAMPAIGN_STATUS_STYLE[c.status]}`}>
                  {c.status}
                </span>
                {(c.status === 'running' || c.status === 'paused') && (
                  <button
                    onClick={() => toggleStatus(c)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded"
                    title={c.status === 'running' ? 'Pause' : 'Resume'}
                  >
                    {c.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Coupons */}
      <div className="glass-card">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
          <Ticket size={20} className="text-pink-400" />
          คูปอง / Discount Codes
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="border-b border-white/10">
              <tr>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase">รหัส</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase">รายละเอียด</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase text-right">ส่วนลด</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase text-right">ขั้นต่ำ</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase text-center">ใช้แล้ว</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase">หมดอายุ</th>
                <th className="py-3 px-2 text-xs font-semibold text-gray-300 uppercase text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {coupons.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-500">ยังไม่มีคูปอง</td></tr>
              )}
              {coupons.map(c => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="py-3 px-2 text-sm font-mono font-bold text-pink-400">{c.code}</td>
                  <td className="py-3 px-2 text-sm text-slate-300">{c.description ?? '—'}</td>
                  <td className="py-3 px-2 text-sm text-right font-semibold text-white">
                    {c.discount_type === 'free_shipping' ? 'ส่งฟรี' :
                      c.discount_type === 'percent' ? `${c.discount_value}%` :
                      `฿${c.discount_value}`}
                    {' '}
                    <span className="text-[10px] text-slate-500">{COUPON_TYPE_LABEL[c.discount_type]}</span>
                  </td>
                  <td className="py-3 px-2 text-sm text-right text-slate-300">
                    {c.min_purchase > 0 ? `฿${Number(c.min_purchase).toLocaleString()}` : '—'}
                  </td>
                  <td className="py-3 px-2 text-sm text-center text-slate-300">
                    {c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}
                  </td>
                  <td className="py-3 px-2 text-xs text-slate-400">
                    {c.valid_until ? new Date(c.valid_until).toLocaleDateString('th-TH') : '—'}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      c.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {isCreating && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setIsCreating(false)} />
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Plus size={20} className="text-indigo-400" />
                สร้างแคมเปญใหม่
              </h2>
              <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="ชื่อแคมเปญ"
                value={newCampaign.name}
                onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })}
                className="w-full bg-slate-950 border border-white/5 rounded-lg py-3 px-4 text-white outline-none focus:border-indigo-500"
              />
              <select
                value={newCampaign.type}
                onChange={e => setNewCampaign({ ...newCampaign, type: e.target.value as Campaign['type'] })}
                className="w-full bg-slate-950 border border-white/5 rounded-lg py-3 px-4 text-white"
              >
                {Object.entries(CAMPAIGN_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <textarea
                placeholder="คำอธิบาย (optional)"
                value={newCampaign.description}
                onChange={e => setNewCampaign({ ...newCampaign, description: e.target.value })}
                rows={3}
                className="w-full bg-slate-950 border border-white/5 rounded-lg py-3 px-4 text-white outline-none focus:border-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIsCreating(false)} className="flex-1 py-2.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 font-semibold hover:bg-white/10">
                ยกเลิก
              </button>
              <button onClick={handleCreateCampaign} className="flex-1 py-2.5 rounded-lg bg-indigo-500 text-white font-semibold hover:bg-indigo-600">
                สร้าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo:  'bg-indigo-500/20 border-indigo-500/30 text-indigo-400',
    blue:    'bg-blue-500/20 border-blue-500/30 text-blue-400',
    emerald: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    amber:   'bg-amber-500/20 border-amber-500/30 text-amber-400',
  };
  return (
    <div className="glass-card flex items-center gap-4 py-4 px-5">
      <div className={`p-3 rounded-xl border ${colorMap[color]}`}>{icon}</div>
      <div>
        <p className="text-sm text-slate-400 mb-0.5">{label}</p>
        <h3 className="text-xl font-bold text-white">{value}</h3>
      </div>
    </div>
  );
}
