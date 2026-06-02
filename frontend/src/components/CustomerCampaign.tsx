import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, Megaphone, Send, Check, Info, Clock,
  ShieldCheck, Play, Square, Filter, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { segmentCampaignApi, type CampaignRecipient } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

const SEG_LABEL: Record<string, string> = {
  champion: 'แชมเปี้ยน', loyal: 'ลูกค้าประจำ', cant_lose: 'กันหลุด', at_risk: 'เริ่มห่าง',
  needs_attention: 'ต้องดูแล', new: 'ลูกค้าใหม่', hibernating: 'หลับไหล', prospect: 'ผู้สนใจ',
};
const TIER_LABEL: Record<string, string> = { general: 'ทั่วไป', silver: 'เงิน', gold: 'ทอง', vip: 'วีไอพี' };

const DEFAULT_VARIANTS = [
  'สวัสดีค่ะ คุณ{ชื่อ} 😊 JNAC มีโปรโมชั่นพิเศษสำหรับลูกค้าคนสำคัญเดือนนี้ค่ะ สนใจให้เอยส่งรายละเอียดไหมคะ?',
  'คุณ{ชื่อ}คะ 🙏 ทาง JNAC มีดีลพิเศษสำหรับวัสดุขัด/เจียรอยู่ค่ะ อยากให้คุณได้ราคาดี ๆ ก่อนใคร สนใจสอบถามได้เลยนะคะ',
  'สวัสดีค่ะคุณ{ชื่อ} เอยจาก JNAC ค่ะ ✨ เดือนนี้มีโปรสำหรับลูกค้าประจำ แจ้งความต้องการมาได้เลย เดี๋ยวเอยจัดให้ค่ะ',
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TYPING_MS = () => rand(1600, 4200);
const COOLDOWN_MS = () => rand(14000, 30000);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function CustomerCampaign() {
  const [all, setAll] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [segFilter, setSegFilter] = useState<string>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [variantsText, setVariantsText] = useState(DEFAULT_VARIANTS.join('\n'));
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  const cancelRef = useRef(false);
  const variantCursor = useRef(0);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setAll(await segmentCampaignApi.listRecipients());
      setSentIds(new Set());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 500);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - nowTs) / 1000));

  const segments = useMemo(() => Array.from(new Set(all.map((r) => r.segment).filter(Boolean))) as string[], [all]);

  const filtered = useMemo(() => all.filter((r) =>
    (segFilter === 'all' || r.segment === segFilter) && (tierFilter === 'all' || r.tier === tierFilter),
  ), [all, segFilter, tierFilter]);

  const pending = filtered.filter((r) => !sentIds.has(r.id));

  function nextVariant(): string {
    const variants = variantsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (variants.length === 0) return DEFAULT_VARIANTS[0];
    variantCursor.current = (variantCursor.current + 1 + Math.floor(Math.random() * variants.length)) % variants.length;
    return variants[variantCursor.current];
  }

  async function startBlast() {
    if (running || pending.length === 0) return;
    setRunning(true);
    setErr(null);
    cancelRef.current = false;
    const targets = [...pending];
    for (const r of targets) {
      if (cancelRef.current) break;
      setCurrentId(r.id);
      await sleep(TYPING_MS());                 // human typing pause
      if (cancelRef.current) break;
      try {
        const text = nextVariant().replaceAll('{ชื่อ}', r.name).replaceAll('{name}', r.name);
        await segmentCampaignApi.send(r.conversation_id, text);
        setSentIds((s) => new Set(s).add(r.id));
      } catch (e) {
        setErr(`ส่งถึง ${r.name} ไม่สำเร็จ: ${(e as Error).message}`);
      }
      // paced cooldown before the next recipient (cancellable)
      const until = Date.now() + COOLDOWN_MS();
      setCooldownUntil(until);
      while (Date.now() < until && !cancelRef.current) await sleep(300);
    }
    setRunning(false);
    setCurrentId(null);
    setCooldownUntil(0);
  }

  function stopBlast() {
    cancelRef.current = true;
    setRunning(false);
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดผู้รับแคมเปญ...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-800 leading-relaxed flex items-start gap-2">
        <Megaphone size={14} className="mt-0.5 flex-shrink-0 text-sky-500" />
        <div>
          <b>แคมเปญยิงตามกลุ่ม</b> — เลือกกลุ่มลูกค้า (RFM) และ/หรือระดับ (Tier) แล้วส่งข้อความผ่าน LINE ·
          ส่ง<b>ทีละราย เว้นจังหวะ</b> สุ่มสลับข้อความ (กัน LINE มองเป็นบอท) · กด "เริ่มส่ง" แล้วระบบทยอยส่งให้ หยุดได้ตลอด
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg border border-neutral-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <span className="block text-[11px] font-semibold text-neutral-600 mb-1 inline-flex items-center gap-1"><Filter size={12} /> กลุ่ม RFM</span>
          <select value={segFilter} onChange={(e) => setSegFilter(e.target.value)} disabled={running}
            className="h-9 rounded-md border border-neutral-200 px-2.5 text-sm outline-none focus:border-sky-400 bg-white disabled:opacity-50">
            <option value="all">ทุกกลุ่ม</option>
            {segments.map((s) => <option key={s} value={s}>{SEG_LABEL[s] ?? s}</option>)}
          </select>
        </div>
        <div>
          <span className="block text-[11px] font-semibold text-neutral-600 mb-1">ระดับ Tier</span>
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} disabled={running}
            className="h-9 rounded-md border border-neutral-200 px-2.5 text-sm outline-none focus:border-sky-400 bg-white disabled:opacity-50">
            <option value="all">ทุกระดับ</option>
            {(['general', 'silver', 'gold', 'vip'] as const).map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11px] text-neutral-500 inline-flex items-center gap-1"><Users size={12} /> เป้าหมาย</div>
          <div className="text-lg font-extrabold text-sky-600 tabular-nums">{filtered.length} <span className="text-xs font-medium text-neutral-400">ราย</span></div>
        </div>
      </div>

      {/* Compose */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
          <Megaphone size={13} className="text-sky-500" /> ข้อความแคมเปญ (บรรทัดละ 1 แบบ — สุ่มสลับ)
        </div>
        <div className="p-3">
          <textarea value={variantsText} onChange={(e) => setVariantsText(e.target.value)} rows={4} disabled={running}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none disabled:opacity-60" />
          <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
            <Info size={11} /> ใช้ <code className="font-mono">{'{ชื่อ}'}</code> แทนชื่อลูกค้า · ส่งผ่าน LINE และขึ้นใน Omni-Chat
          </p>
        </div>
      </div>

      {/* Anti-spam + controls */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start gap-2">
        <ShieldCheck size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div>หน่วงก่อนส่งเหมือนคนพิมพ์ + เว้นจังหวะ ~15–30 วิ ต่อราย · แนะนำส่งในเวลาทำการ และไม่เกินโควตา LINE OA</div>
      </div>

      <div className="flex items-center gap-3">
        {running ? (
          <button type="button" onClick={stopBlast}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700">
            <Square size={15} /> หยุดส่ง
          </button>
        ) : (
          <button type="button" onClick={() => void startBlast()} disabled={pending.length === 0}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-sky-600 text-white text-sm font-bold hover:bg-sky-700 disabled:opacity-50">
            <Play size={15} /> เริ่มส่ง ({pending.length} ราย)
          </button>
        )}
        {(running || sentIds.size > 0) && (
          <div className="text-xs text-neutral-600">
            ส่งแล้ว <b className="text-emerald-600">{sentIds.size}</b> / {filtered.length}
            {running && cooldownLeft > 0 && <span className="text-amber-600 ml-2"><Clock size={11} className="inline" /> เว้นจังหวะ {cooldownLeft}s</span>}
            {running && <span className="text-sky-600 ml-2"><Loader2 size={11} className="inline animate-spin" /> กำลังส่ง...</span>}
          </div>
        )}
        <button type="button" onClick={() => void load()} disabled={running} className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40">
          <RefreshCw size={12} /> รีเฟรช
        </button>
      </div>

      {/* Recipient list */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
            ไม่มีลูกค้าในกลุ่มนี้<br />
            <span className="text-neutral-300">(ต้องเป็นลูกค้าที่ผูก LINE แล้ว · ปรับตัวกรองด้านบน)</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">ลูกค้า</th>
                  <th className="px-3 py-2 text-center">กลุ่ม</th>
                  <th className="px-3 py-2 text-center">ระดับ</th>
                  <th className="px-3 py-2 text-right">ยอดสะสม</th>
                  <th className="px-3 py-2 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((r) => {
                  const sent = sentIds.has(r.id);
                  const isCurrent = currentId === r.id;
                  return (
                    <tr key={r.id} className={cn('hover:bg-neutral-50/70 transition', sent && 'bg-emerald-50/40', isCurrent && 'bg-sky-50/60')}>
                      <td className="px-3 py-2">
                        <div className="text-xs font-medium text-neutral-800 truncate max-w-[180px]">{r.name}</div>
                        <div className="text-[10px] text-neutral-400">{r.code ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.segment ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{SEG_LABEL[r.segment] ?? r.segment}</span> : <span className="text-[10px] text-neutral-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center text-[10px] text-neutral-500">{TIER_LABEL[r.tier] ?? r.tier}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">{baht(r.total_spent)}</td>
                      <td className="px-3 py-2 text-center">
                        {sent ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check size={12} /> ส่งแล้ว</span>
                        ) : isCurrent ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600"><Send size={12} /> กำลังส่ง</span>
                        ) : (
                          <span className="text-[10px] text-neutral-400">รอส่ง</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
