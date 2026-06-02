import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Crown, Check, Star, Percent, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tierApi, type TierBenefit } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

const TIER_STYLE: Record<string, { ring: string; chip: string; icon: string }> = {
  general: { ring: 'border-neutral-200', chip: 'bg-neutral-100 text-neutral-600', icon: 'text-neutral-400' },
  silver:  { ring: 'border-slate-200',   chip: 'bg-slate-100 text-slate-600',     icon: 'text-slate-400' },
  gold:    { ring: 'border-amber-200',   chip: 'bg-amber-100 text-amber-700',     icon: 'text-amber-500' },
  vip:     { ring: 'border-violet-200',  chip: 'bg-violet-100 text-violet-700',   icon: 'text-violet-500' },
};

export default function TierBenefits() {
  const [rows, setRows] = useState<TierBenefit[]>([]);
  const [draft, setDraft] = useState<Record<string, { point_multiplier: number; discount_percent: number }>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [savedTier, setSavedTier] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await tierApi.listBenefits();
      setRows(data);
      const d: Record<string, { point_multiplier: number; discount_percent: number }> = {};
      data.forEach((r) => { d[r.tier] = { point_multiplier: Number(r.point_multiplier), discount_percent: Number(r.discount_percent) }; });
      setDraft(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const dirty = (r: TierBenefit) =>
    draft[r.tier] && (draft[r.tier].point_multiplier !== Number(r.point_multiplier) || draft[r.tier].discount_percent !== Number(r.discount_percent));

  async function save(r: TierBenefit) {
    setSavingTier(r.tier);
    setErr(null);
    try {
      await tierApi.updateBenefit(r.tier, draft[r.tier]);
      setRows((rs) => rs.map((x) => x.tier === r.tier ? { ...x, ...draft[r.tier] } : x));
      setSavedTier(r.tier);
      setTimeout(() => setSavedTier((t) => (t === r.tier ? null : t)), 1800);
    } catch (e) {
      setErr(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSavingTier(null);
    }
  }

  function patch(tier: string, key: 'point_multiplier' | 'discount_percent', val: number) {
    setDraft((d) => ({ ...d, [tier]: { ...d[tier], [key]: val } }));
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดสิทธิ์ tier...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed flex items-start gap-2">
        <Crown size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
        <div>
          <b>สิทธิ์ตามระดับลูกค้า (Tier)</b> — ตั้งค่าได้ว่าแต่ละระดับได้สิทธิ์อะไร ·
          <b>ตัวคูณแต้ม</b> = ซื้อแล้วได้แต้มกี่เท่า (ใช้จริงผ่านปุ่ม "ให้แต้มจากยอดซื้อ" ในโปรไฟล์ลูกค้า) ·
          <b>ส่วนลดประจำ</b> = ส่วนลด % ของระดับนั้น (ใช้อ้างอิงตอนออกใบเสนอราคา/ออเดอร์)
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
          <RefreshCw size={12} /> รีเฟรช
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((r) => {
          const st = TIER_STYLE[r.tier] ?? TIER_STYLE.general;
          const d = draft[r.tier];
          return (
            <div key={r.tier} className={cn('rounded-xl border bg-white p-4', st.ring)}>
              <div className="flex items-center justify-between mb-3">
                <div className="inline-flex items-center gap-2">
                  <Crown size={18} className={st.icon} />
                  <span className={cn('text-sm font-bold px-2 py-0.5 rounded', st.chip)}>{r.label}</span>
                  <span className="text-[10px] text-neutral-400 font-mono uppercase">{r.tier}</span>
                </div>
                <span className="text-[10px] text-neutral-400">ถึงระดับนี้เมื่อยอดสะสม ≥ {baht(r.min_spend)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-neutral-600 inline-flex items-center gap-1 mb-1"><Star size={12} className="text-amber-500" /> ตัวคูณแต้ม</span>
                  <div className="inline-flex items-center w-full rounded-lg border border-neutral-200 overflow-hidden">
                    <button type="button" onClick={() => patch(r.tier, 'point_multiplier', Math.max(0, +(d.point_multiplier - 0.5).toFixed(2)))} className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-50 font-bold">−</button>
                    <input type="number" step={0.5} min={0} value={d.point_multiplier}
                      onChange={(e) => patch(r.tier, 'point_multiplier', Math.max(0, Number(e.target.value) || 0))}
                      className="flex-1 w-full text-center py-1.5 text-sm outline-none tabular-nums" />
                    <span className="px-1.5 text-[10px] text-neutral-400">x</span>
                    <button type="button" onClick={() => patch(r.tier, 'point_multiplier', +(d.point_multiplier + 0.5).toFixed(2))} className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-50 font-bold">+</button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-neutral-600 inline-flex items-center gap-1 mb-1"><Percent size={12} className="text-emerald-500" /> ส่วนลดประจำ</span>
                  <div className="inline-flex items-center w-full rounded-lg border border-neutral-200 overflow-hidden">
                    <button type="button" onClick={() => patch(r.tier, 'discount_percent', Math.max(0, d.discount_percent - 1))} className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-50 font-bold">−</button>
                    <input type="number" step={1} min={0} max={100} value={d.discount_percent}
                      onChange={(e) => patch(r.tier, 'discount_percent', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                      className="flex-1 w-full text-center py-1.5 text-sm outline-none tabular-nums" />
                    <span className="px-1.5 text-[10px] text-neutral-400">%</span>
                    <button type="button" onClick={() => patch(r.tier, 'discount_percent', Math.min(100, d.discount_percent + 1))} className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-50 font-bold">+</button>
                  </div>
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">
                  ซื้อ ฿1,000 → ได้ {Math.floor(10 * d.point_multiplier)} แต้ม
                </span>
                <button type="button" onClick={() => void save(r)} disabled={!dirty(r) || savingTier === r.tier}
                  className={cn('inline-flex items-center gap-1 h-7 px-3 rounded-md text-[11px] font-bold transition',
                    savedTier === r.tier ? 'bg-emerald-100 text-emerald-700'
                      : dirty(r) ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-neutral-100 text-neutral-400 cursor-not-allowed')}>
                  {savingTier === r.tier ? <><Loader2 size={12} className="animate-spin" /> บันทึก...</>
                    : savedTier === r.tier ? <><Check size={12} /> บันทึกแล้ว</>
                      : <>บันทึก</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed flex items-start gap-1">
        <Info size={11} className="mt-0.5 flex-shrink-0" />
        เกณฑ์ยอดสะสมเป็นค่าอ้างอิงสำหรับเลื่อนระดับ (ปรับ tier ของลูกค้าได้ที่โปรไฟล์) · ฐานแต้ม = 1 แต้มต่อ ฿100 แล้วคูณตัวคูณของระดับ
      </p>
    </div>
  );
}
