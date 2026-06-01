import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { customerRfmApi, type CustomerRFM, type RfmSegment } from '../lib/api';

/**
 * RFM customer-segment view for the CRM page. Reads the `customer_rfm` view
 * (migration 0017), groups customers into actionable segments, and shows
 * summary cards + a filterable list with the recommended action per group.
 *
 * Scores come straight from the DB (fixed thresholds, tunable there). This
 * component is presentation-only + self-fetching, so the CRM page just drops
 * in <CustomerSegments />.
 */

const baht = (n: number) => '฿' + new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const SEG_META: Record<RfmSegment, {
  label: string; emoji: string; action: string; order: number;
  card: string; chip: string;
}> = {
  champion:        { label: 'แชมป์ (VIP)',        emoji: '🏆', order: 1, action: 'ดูแลพิเศษ ให้สิทธิ์ก่อนใคร อย่าให้หลุดมือ',           card: 'border-emerald-200 bg-emerald-50 hover:border-emerald-300', chip: 'bg-emerald-100 text-emerald-700' },
  loyal:           { label: 'ขาประจำ',            emoji: '💙', order: 2, action: 'รักษาด้วยแต้ม/ส่วนลด ชวนซื้อเพิ่ม',                    card: 'border-sky-200 bg-sky-50 hover:border-sky-300',             chip: 'bg-sky-100 text-sky-700' },
  cant_lose:       { label: 'กำลังจะหาย (ด่วน!)',  emoji: '⚠️', order: 3, action: 'รีบทัก LINE + เสนอโปร ก่อนเสียให้คู่แข่ง',             card: 'border-rose-200 bg-rose-50 hover:border-rose-300',          chip: 'bg-rose-100 text-rose-700' },
  at_risk:         { label: 'เริ่มห่าง',           emoji: '🔶', order: 4, action: 'เตือนซื้อซ้ำ ส่งโปรกระตุ้น',                          card: 'border-amber-200 bg-amber-50 hover:border-amber-300',       chip: 'bg-amber-100 text-amber-700' },
  new:             { label: 'ลูกค้าใหม่',          emoji: '🆕', order: 5, action: 'ดันให้ซื้อครั้งที่ 2 ให้ติด',                         card: 'border-violet-200 bg-violet-50 hover:border-violet-300',    chip: 'bg-violet-100 text-violet-700' },
  needs_attention: { label: 'ต้องดูแล',            emoji: '👀', order: 6, action: 'ติดตามให้กลับมา active',                            card: 'border-slate-200 bg-slate-50 hover:border-slate-300',       chip: 'bg-slate-100 text-slate-700' },
  hibernating:     { label: 'หลับไปแล้ว',          emoji: '💤', order: 7, action: 'ยิงโปรแรงดึงกลับ (หรือปล่อย)',                       card: 'border-zinc-200 bg-zinc-50 hover:border-zinc-300',          chip: 'bg-zinc-100 text-zinc-600' },
  prospect:        { label: 'ยังไม่เคยซื้อ',       emoji: '👤', order: 8, action: 'ปิดการขายครั้งแรกให้ได้',                           card: 'border-neutral-200 bg-neutral-50 hover:border-neutral-300', chip: 'bg-neutral-100 text-neutral-600' },
};

const SEG_ORDER = (Object.keys(SEG_META) as RfmSegment[]).sort(
  (a, b) => SEG_META[a].order - SEG_META[b].order,
);

export default function CustomerSegments() {
  const [rows, setRows] = useState<CustomerRFM[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<RfmSegment | 'all'>('all');

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setRows(await customerRfmApi.list());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => {
    const m = new Map<RfmSegment, { count: number; value: number }>();
    SEG_ORDER.forEach((s) => m.set(s, { count: 0, value: 0 }));
    for (const r of rows) {
      const e = m.get(r.segment) ?? { count: 0, value: 0 };
      e.count += 1;
      e.value += Number(r.monetary) || 0;
      m.set(r.segment, e);
    }
    return m;
  }, [rows]);

  const totalValue = useMemo(() => rows.reduce((s, r) => s + (Number(r.monetary) || 0), 0), [rows]);
  const shown = useMemo(
    () => (active === 'all' ? rows : rows.filter((r) => r.segment === active)),
    [rows, active],
  );
  // Only segments that actually have customers (keep it tidy as data grows).
  const visibleSegs = SEG_ORDER.filter((s) => (summary.get(s)?.count ?? 0) > 0);
  const hasRealData = rows.some((r) => r.segment !== 'prospect');

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังคำนวณ RFM...
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
        <span>โหลด RFM ไม่สำเร็จ: {err}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!hasRealData && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 leading-relaxed">
          ℹ️ ยังไม่มีลูกค้าที่มีประวัติการซื้อ (จ่ายเงินแล้ว + ผูกออเดอร์กับลูกค้า) — <b>เครื่องคำนวณ RFM พร้อมทำงานแล้ว</b> จะจัดกลุ่มลูกค้าให้อัตโนมัติทันทีที่เริ่มมีการขายจริง
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setActive('all')}
          className={cn(
            'rounded-xl border p-3 text-left transition border-indigo-200 bg-indigo-50 hover:border-indigo-300',
            active === 'all' && 'ring-2 ring-offset-1 ring-indigo-500',
          )}
        >
          <div className="text-sm font-bold text-indigo-900">📒 ทั้งหมด</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-neutral-900">
            {rows.length}<span className="text-xs font-medium text-neutral-500"> ราย</span>
          </div>
          <div className="text-[11px] text-neutral-500 tabular-nums">{baht(totalValue)}</div>
          <div className="mt-1 text-[10px] text-neutral-500">ดูลูกค้าทุกกลุ่ม</div>
        </button>

        {visibleSegs.map((seg) => {
          const s = summary.get(seg)!;
          const meta = SEG_META[seg];
          return (
            <button
              key={seg}
              type="button"
              onClick={() => setActive(seg)}
              className={cn(
                'rounded-xl border p-3 text-left transition',
                meta.card,
                active === seg && 'ring-2 ring-offset-1 ring-indigo-500',
              )}
            >
              <div className="text-sm font-bold text-neutral-800 truncate">{meta.emoji} {meta.label}</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums text-neutral-900">
                {s.count}<span className="text-xs font-medium text-neutral-500"> ราย</span>
              </div>
              <div className="text-[11px] text-neutral-500 tabular-nums">{baht(s.value)}</div>
              <div className="mt-1 text-[10px] text-neutral-500 leading-tight line-clamp-2">{meta.action}</div>
            </button>
          );
        })}
      </div>

      {/* Customer table for the active segment */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
          <span>
            {active === 'all' ? 'ลูกค้าทั้งหมด' : `${SEG_META[active].emoji} ${SEG_META[active].label}`}
            {' · '}{shown.length} ราย
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
          >
            <RefreshCw size={12} /> รีเฟรช
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">ลูกค้า</th>
                <th className="px-3 py-2 text-left">กลุ่ม</th>
                <th className="px-3 py-2 text-center" title="Recency-Frequency-Monetary (1–5)">R-F-M</th>
                <th className="px-3 py-2 text-right">ซื้อล่าสุด</th>
                <th className="px-3 py-2 text-right">ครั้ง</th>
                <th className="px-3 py-2 text-right">ยอดรวม</th>
                <th className="px-3 py-2 text-left">คำแนะนำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-neutral-400 text-xs">
                    ไม่มีลูกค้าในกลุ่มนี้
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const meta = SEG_META[r.segment];
                return (
                  <tr key={r.id} className="hover:bg-neutral-50/70 transition">
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900 truncate max-w-[220px]">{r.name}</div>
                      <div className="text-[10px] text-neutral-400">{r.code ?? '—'} · {r.tier}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap', meta.chip)}>
                        {meta.emoji} {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="font-mono text-xs tabular-nums text-neutral-700">
                        {r.r_score}-{r.f_score}-{r.m_score}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-600 whitespace-nowrap">
                      {r.recency_days == null ? '—' : `${r.recency_days} วัน`}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-700">{r.frequency}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">
                      {baht(Number(r.monetary))}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-neutral-500 max-w-[240px]">
                      <span className="line-clamp-2">{meta.action}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed">
        RFM = Recency (ซื้อล่าสุด) · Frequency (จำนวนครั้ง) · Monetary (ยอดรวม) — ให้คะแนน 1–5 ต่อด้าน แล้วจัดกลุ่มอัตโนมัติ
        (เกณฑ์คะแนนปรับได้ในฐานข้อมูล: view <code className="font-mono">customer_rfm</code>)
      </p>
    </div>
  );
}
