import { useEffect, useState } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, Users, MessageCircle, TrendingUp, Repeat,
  Smile, Sparkles, Ticket, Gift,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '@/lib/utils';
import { crmDashboardApi, type DashboardStats } from '../lib/api';

const nf = (n: number) => new Intl.NumberFormat('th-TH').format(Math.round(n));
const baht = (n: number) => '฿' + nf(n);

const SEG_LABEL: Record<string, string> = {
  champion: 'แชมเปี้ยน', loyal: 'ลูกค้าประจำ', cant_lose: 'กันหลุด', at_risk: 'เริ่มห่าง',
  needs_attention: 'ต้องดูแล', new: 'ลูกค้าใหม่', hibernating: 'หลับไหล', prospect: 'ผู้สนใจ',
};
const TIER_META = [
  { key: 'general', label: 'ทั่วไป', color: '#a3a3a3' },
  { key: 'silver', label: 'เงิน', color: '#94a3b8' },
  { key: 'gold', label: 'ทอง', color: '#f59e0b' },
  { key: 'vip', label: 'วีไอพี', color: '#8b5cf6' },
] as const;
const SEG_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#64748b'];

export default function CrmDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setStats(await crmDashboardApi.stats());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดแดชบอร์ด...
      </div>
    );
  }
  if (err || !stats) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err ?? 'ไม่มีข้อมูล'}</span>
      </div>
    );
  }

  const segData = stats.segments.map((s) => ({
    name: s.segment ? (SEG_LABEL[s.segment] ?? s.segment) : '—', count: s.count, value: s.value,
  }));
  const tierData = TIER_META.map((t) => ({ ...t, count: (stats.customers as unknown as Record<string, number>)[t.key] ?? 0 }));
  const npsTotal = stats.nps.responses || 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-neutral-400 inline-flex items-center gap-1.5">
          <TrendingUp size={13} className="text-indigo-400" /> ภาพรวมสุขภาพลูกค้า · อ่านอย่างเดียว
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
          <RefreshCw size={12} /> รีเฟรช
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <Kpi icon={<Users size={14} />} tone="indigo" label="ลูกค้าทั้งหมด" value={nf(stats.customers.total)} sub={`มี LINE ${nf(stats.customers.with_line)}`} />
        <Kpi icon={<TrendingUp size={14} />} tone="emerald" label="รายได้ (ชำระแล้ว)" value={baht(stats.orders.revenue)} sub={`${nf(stats.orders.paid_orders)} ออเดอร์`} />
        <Kpi icon={<Repeat size={14} />} tone="sky" label="อัตราซื้อซ้ำ" value={`${stats.repeat.rate}%`} sub={`${nf(stats.repeat.repeat_buyers)}/${nf(stats.repeat.buyers)} ราย`} />
        <Kpi icon={<Smile size={14} />} tone={stats.nps.score === null ? 'neutral' : stats.nps.score >= 50 ? 'emerald' : stats.nps.score >= 0 ? 'amber' : 'red'}
          label="คะแนน NPS" value={stats.nps.score === null ? '—' : stats.nps.score > 0 ? `+${stats.nps.score}` : String(stats.nps.score)} sub={`${nf(stats.nps.responses)} คำตอบ`} />
        <Kpi icon={<Sparkles size={14} />} tone="violet" label="แต้มคงค้าง" value={nf(stats.loyalty.points_outstanding)} sub="ทั้งระบบ" />
        <Kpi icon={<Ticket size={14} />} tone="rose" label="คูปองใช้ได้" value={nf(stats.coupons.active)} sub="active" />
        <Kpi icon={<Gift size={14} />} tone="amber" label="แนะนำเพื่อน" value={nf(stats.referrals.total)} sub={`สำเร็จ ${nf(stats.referrals.rewarded)} · รอ ${nf(stats.referrals.pending)}`} />
        <Kpi icon={<MessageCircle size={14} />} tone="neutral" label="ลูกค้ามี LINE" value={nf(stats.customers.with_line)} sub={`จาก ${nf(stats.customers.total)} ราย`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* RFM segments */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3">
          <div className="text-xs font-bold text-neutral-700 mb-2">ลูกค้าตามกลุ่ม RFM (จำนวน)</div>
          {segData.length === 0 || segData.every((d) => d.count === 0) ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(140, segData.length * 34)}>
              <BarChart data={segData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11 }} />
                <Tooltip formatter={((value: number) => [`${value} ราย`, 'ลูกค้า']) as never} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {segData.map((_, i) => <Cell key={i} fill={SEG_COLORS[i % SEG_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tier distribution + NPS */}
        <div className="flex flex-col gap-3">
          <div className="bg-white rounded-lg border border-neutral-200 p-3">
            <div className="text-xs font-bold text-neutral-700 mb-2">สัดส่วนตามระดับ (Tier)</div>
            <div className="flex items-end gap-2 h-24">
              {tierData.map((t) => {
                const max = Math.max(1, ...tierData.map((x) => x.count));
                return (
                  <div key={t.key} className="flex-1 flex flex-col items-center justify-end gap-1">
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: t.color }}>{t.count}</span>
                    <div className="w-full rounded-t" style={{ height: `${(t.count / max) * 100}%`, minHeight: t.count > 0 ? 6 : 2, backgroundColor: t.color, opacity: t.count > 0 ? 1 : 0.25 }} />
                    <span className="text-[10px] text-neutral-500">{t.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-neutral-200 p-3">
            <div className="text-xs font-bold text-neutral-700 mb-2">ความพึงพอใจ (NPS)</div>
            {stats.nps.responses === 0 ? <Empty text="ยังไม่มีคำตอบแบบสอบถาม" /> : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div style={{ width: `${(stats.nps.promoters / npsTotal) * 100}%` }} className="bg-emerald-500" title={`ผู้ชื่นชอบ ${stats.nps.promoters}`} />
                  <div style={{ width: `${(stats.nps.passives / npsTotal) * 100}%` }} className="bg-amber-400" title={`เฉย ๆ ${stats.nps.passives}`} />
                  <div style={{ width: `${(stats.nps.detractors / npsTotal) * 100}%` }} className="bg-red-500" title={`ไม่พอใจ ${stats.nps.detractors}`} />
                </div>
                <div className="flex justify-between text-[10px] mt-1.5">
                  <span className="text-emerald-600">ชื่นชอบ {stats.nps.promoters}</span>
                  <span className="text-amber-600">เฉย ๆ {stats.nps.passives}</span>
                  <span className="text-red-600">ไม่พอใจ {stats.nps.detractors}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-neutral-400">ตัวเลขสรุปจากข้อมูลจริงในระบบ · จะเปลี่ยนตามออเดอร์/คำตอบ/การแนะนำที่เข้ามา</p>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone: 'indigo' | 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | 'red' | 'neutral';
}) {
  const map: Record<string, string> = {
    indigo: 'text-indigo-600', emerald: 'text-emerald-600', sky: 'text-sky-600', amber: 'text-amber-600',
    violet: 'text-violet-600', rose: 'text-rose-600', red: 'text-red-600', neutral: 'text-neutral-600',
  };
  const cls = map[tone];
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className={cn('text-[10px] font-semibold inline-flex items-center gap-1', cls)}>{icon} {label}</div>
      <div className={cn('text-xl font-extrabold tabular-nums mt-0.5', cls)}>{value}</div>
      {sub && <div className="text-[10px] text-neutral-400">{sub}</div>}
    </div>
  );
}

function Empty({ text = 'ยังไม่มีข้อมูล' }: { text?: string }) {
  return <div className="py-8 text-center text-xs text-neutral-300">{text}</div>;
}
