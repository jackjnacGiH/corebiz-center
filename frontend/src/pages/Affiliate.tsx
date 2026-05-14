import { useEffect, useMemo, useState } from 'react';
import { Handshake, Award, TrendingUp, Link2, Copy, RefreshCw, CheckCircle, Clock, Ban } from 'lucide-react';
import { agentsApi, type Agent, type AgentLink } from '../lib/api';
import { useLanguage } from '../i18n';

const TIER_STYLE: Record<Agent['tier'], string> = {
  starter:  'bg-slate-500/20 text-slate-300 border-slate-500/30',
  silver:   'bg-slate-400/20 text-slate-200 border-slate-400/30',
  gold:     'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  platinum: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

const STATUS_STYLE: Record<Agent['status'], { className: string; Icon: React.ComponentType<{ size?: number }> }> = {
  pending:   { className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',       Icon: Clock },
  active:    { className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', Icon: CheckCircle },
  suspended: { className: 'bg-rose-500/10 text-rose-400 border-rose-500/30',           Icon: Ban },
};

export default function Affiliate() {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [links, setLinks] = useState<AgentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [a, l] = await Promise.all([agentsApi.list(), agentsApi.listLinks()]);
      setAgents(a); setLinks(l);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const active = agents.filter(a => a.status === 'active');
    const totalSales = agents.reduce((acc, a) => acc + Number(a.total_sales), 0);
    const totalCommission = agents.reduce((acc, a) => acc + Number(a.total_commission), 0);
    const pendingCommission = agents.reduce((acc, a) => acc + Number(a.pending_commission), 0);
    return { active: active.length, total: agents.length, totalSales, totalCommission, pendingCommission };
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
    try { await agentsApi.approve(id); await load(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function suspend(id: string) {
    try { await agentsApi.suspend(id); await load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="animate-fade-in p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Handshake className="w-8 h-8 text-indigo-400" />
            {t.affiliate.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.affiliate.subtitle}</p>
        </div>
        <button onClick={() => load()} className="btn btn-secondary flex items-center gap-2" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={<Handshake size={20} />} label="ตัวแทนที่ใช้งาน" value={`${stats.active}/${stats.total}`} color="indigo" />
        <StatTile icon={<TrendingUp size={20} />} label="ยอดขายรวม" value={`฿${stats.totalSales.toLocaleString()}`} color="emerald" />
        <StatTile icon={<Award size={20} />} label="คอมมิชชั่นจ่ายแล้ว" value={`฿${stats.totalCommission.toLocaleString()}`} color="amber" />
        <StatTile icon={<Clock size={20} />} label="ค้างจ่าย" value={`฿${stats.pendingCommission.toLocaleString()}`} color="rose" />
      </div>

      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">✗ {err}</div>}

      <div className="glass-card overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-xl font-bold text-white">ตัวแทนจำหน่าย ({agents.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase">รหัส</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase">ชื่อ / ติดต่อ</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">Tier</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-right">คอม %</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-right">Conversions</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-right">ยอดขาย</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-right">ค้างจ่าย</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">สถานะ</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {loading && <tr><td colSpan={9} className="py-12 text-center text-slate-500">{t.common.loading}</td></tr>}
              {!loading && agents.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-slate-500">{t.common.noData}</td></tr>}
              {agents.map(a => {
                const statusMeta = STATUS_STYLE[a.status];
                const StatusIcon = statusMeta.Icon;
                return (
                  <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-3 px-4 text-sm font-mono text-indigo-400">{a.code}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-100">{a.name}</div>
                      <div className="text-xs text-slate-500">{a.email}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${TIER_STYLE[a.tier]}`}>
                        {a.tier}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-sm font-semibold text-slate-200">{a.commission_rate}%</td>
                    <td className="py-3 px-4 text-right text-sm text-slate-300">
                      {a.total_conversions.toLocaleString()}
                      <span className="text-slate-500 text-xs"> / {a.total_clicks.toLocaleString()} clicks</span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400">
                      ฿{Number(a.total_sales).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-amber-400 font-semibold">
                      ฿{Number(a.pending_commission).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border ${statusMeta.className}`}>
                        <StatusIcon size={11} /> {a.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {a.status === 'pending' && (
                        <button onClick={() => approve(a.id)} className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">
                          อนุมัติ
                        </button>
                      )}
                      {a.status === 'active' && (
                        <button onClick={() => suspend(a.id)} className="text-xs px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20">
                          ระงับ
                        </button>
                      )}
                      {a.status === 'suspended' && (
                        <button onClick={() => approve(a.id)} className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">
                          คืนสถานะ
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
          <Link2 size={20} className="text-indigo-400" />
          Tracking Links ({links.length})
        </h2>
        <div className="space-y-2">
          {links.length === 0 && <div className="text-sm text-slate-500 py-4">ยังไม่มี link</div>}
          {links.map(l => {
            const agent = agents.find(a => a.id === l.agent_id);
            const isCopied = copiedCode === l.short_code;
            return (
              <div key={l.id} className="flex items-center gap-4 p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-indigo-400">/ref/{l.short_code}</code>
                    <span className="text-xs text-slate-500">→ {agent?.name ?? 'Unknown'}</span>
                  </div>
                  {l.label && <div className="text-xs text-slate-400 mt-0.5">{l.label}</div>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>👁 {l.clicks.toLocaleString()} clicks</span>
                    <span className="text-emerald-400">✓ {l.conversions} conv</span>
                    <span className="text-emerald-400">฿{Number(l.revenue).toLocaleString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => copyLink(l.short_code)}
                  className={`text-xs px-3 py-2 rounded flex items-center gap-1.5 font-semibold transition ${
                    isCopied
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {isCopied ? <CheckCircle size={13} /> : <Copy size={13} />}
                  {isCopied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo:  'bg-indigo-500/20 border-indigo-500/30 text-indigo-400',
    emerald: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    amber:   'bg-amber-500/20 border-amber-500/30 text-amber-400',
    rose:    'bg-rose-500/20 border-rose-500/30 text-rose-400',
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
