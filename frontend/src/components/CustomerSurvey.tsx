import { useEffect, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, Send, Check, Info, Clock, Smile,
  Star, ThumbsUp, ThumbsDown, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { surveyApi, type SurveyDue, type SurveyResult } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

/** Survey invite variants. {ชื่อ}=customer name. The rating link is appended
 *  automatically by surveyApi.createAndSend (a fresh token per send). */
const DEFAULT_VARIANTS = [
  'สวัสดีค่ะ คุณ{ชื่อ} 😊 ขอบคุณที่อุดหนุน JNAC นะคะ รบกวนให้คะแนนความพึงพอใจหน่อยได้ไหมคะ จะได้นำไปปรับปรุงบริการให้ดียิ่งขึ้นค่ะ 🙏',
  'คุณ{ชื่อ}คะ 🙏 เอยขอรบกวนนิดเดียวค่ะ ช่วยให้คะแนนการบริการของเราหน่อยนะคะ ความเห็นของคุณมีค่ากับทีมงานมากเลยค่ะ 😊',
  'สวัสดีค่ะคุณ{ชื่อ} เอยจาก JNAC ค่ะ ✨ อยากทราบว่าสินค้า/บริการที่ผ่านมาเป็นยังไงบ้างคะ รบกวนให้คะแนนหน่อยนะคะ ขอบคุณมากค่ะ',
  'คุณ{ชื่อ}คะ 😊 ขอบคุณที่ไว้วางใจ JNAC เสมอมานะคะ ขอเสียงสะท้อนจากคุณหน่อยค่ะ ให้คะแนนความพึงพอใจได้ที่ลิงก์เลยค่ะ 🙏',
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TYPING_MS = () => rand(1600, 4200);
const COOLDOWN_MS = () => rand(14000, 30000);

/** NPS bucket for a 0–10 score. */
function bucket(score: number): 'promoter' | 'passive' | 'detractor' {
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

export default function CustomerSurvey() {
  const [due, setDue] = useState<SurveyDue[]>([]);
  const [results, setResults] = useState<SurveyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [variantsText, setVariantsText] = useState(DEFAULT_VARIANTS.join('\n'));
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  const variantCursor = useRef(0);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [d, r] = await Promise.all([surveyApi.listDue(), surveyApi.listResults()]);
      setDue(d);
      setResults(r);
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
  const cooling = cooldownLeft > 0;

  function nextVariant(): string {
    const variants = variantsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (variants.length === 0) return DEFAULT_VARIANTS[0];
    variantCursor.current = (variantCursor.current + 1 + Math.floor(Math.random() * variants.length)) % variants.length;
    return variants[variantCursor.current];
  }

  async function send(c: SurveyDue) {
    if (sendingId || cooling || !c.conversation_id) return;
    setSendingId(c.id);
    setErr(null);
    try {
      await new Promise((res) => setTimeout(res, TYPING_MS()));
      const text = nextVariant().replaceAll('{ชื่อ}', c.name ?? 'ลูกค้า').replaceAll('{name}', c.name ?? 'ลูกค้า');
      await surveyApi.createAndSend({ customerId: c.id, conversationId: c.conversation_id, text });
      setSentIds((s) => new Set(s).add(c.id));
      setCooldownUntil(Date.now() + COOLDOWN_MS());
    } catch (e) {
      setErr(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSendingId(null);
    }
  }

  // ---- NPS stats from answered responses --------------------------------
  const answered = results.filter((r) => r.score !== null);
  const promoters = answered.filter((r) => bucket(r.score!) === 'promoter').length;
  const passives = answered.filter((r) => bucket(r.score!) === 'passive').length;
  const detractors = answered.filter((r) => bucket(r.score!) === 'detractor').length;
  const nps = answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : null;
  const pending = results.length - answered.length;

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดข้อมูลความพึงพอใจ...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-800 leading-relaxed flex items-start gap-2">
        <Smile size={14} className="mt-0.5 flex-shrink-0 text-violet-500" />
        <div>
          <b>วัดความพึงพอใจ (NPS)</b> — ส่งลิงก์ให้ลูกค้าแตะให้คะแนน 0–10 ผ่าน LINE ลูกค้าตอบในหน้าเว็บ (ไม่ต้องล็อกอิน) ·
          <b>NPS</b> = % ผู้ชื่นชอบ (9–10) − % ผู้ไม่พอใจ (0–6) · คะแนนต่ำจะถูกไฮไลต์ให้ตามดูแลทันที
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* NPS summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-lg border border-neutral-200 bg-white p-3 flex flex-col items-center justify-center">
          <div className={cn('text-3xl font-extrabold tabular-nums',
            nps === null ? 'text-neutral-300' : nps >= 50 ? 'text-emerald-600' : nps >= 0 ? 'text-amber-600' : 'text-red-600')}>
            {nps === null ? '—' : nps > 0 ? `+${nps}` : nps}
          </div>
          <div className="text-[10px] text-neutral-500 font-semibold mt-0.5">คะแนน NPS</div>
          <div className="text-[9px] text-neutral-400">จาก {answered.length} คำตอบ</div>
        </div>
        <StatCard icon={<ThumbsUp size={14} />} tone="emerald" label="ผู้ชื่นชอบ (9–10)" value={promoters} />
        <StatCard icon={<Star size={14} />} tone="amber" label="เฉย ๆ (7–8)" value={passives} />
        <StatCard icon={<ThumbsDown size={14} />} tone="red" label="ไม่พอใจ (0–6)" value={detractors} />
      </div>

      {/* Message variants */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
          <MessageSquare size={13} className="text-violet-500" /> ข้อความเชิญให้คะแนน (บรรทัดละ 1 แบบ)
        </div>
        <div className="p-3">
          <textarea
            value={variantsText}
            onChange={(e) => setVariantsText(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none"
          />
          <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
            <Info size={11} /> ตัวแปร: <code className="font-mono">{'{ชื่อ}'}</code> · ระบบแนบ<b>ลิงก์ให้คะแนน</b>ท้ายข้อความอัตโนมัติ · สุ่มสลับให้แต่ละราย
          </p>
        </div>
      </div>

      {/* Due list */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
          <span>
            ลูกค้าที่ควรขอคะแนน · {due.length} ราย
            {sentIds.size > 0 && <span className="text-emerald-600 ml-1.5">(ส่งแล้ว {sentIds.size})</span>}
          </span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
            <RefreshCw size={12} /> รีเฟรช
          </button>
        </div>

        {due.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
            ยังไม่มีลูกค้าที่ควรขอคะแนนตอนนี้<br />
            <span className="text-neutral-300">(ลูกค้าที่มีออเดอร์ชำระแล้ว + มี LINE และยังไม่ได้ขอคะแนนใน 90 วัน)</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">ลูกค้า</th>
                  <th className="px-3 py-2 text-right">ออเดอร์</th>
                  <th className="px-3 py-2 text-right">ยอดสะสม</th>
                  <th className="px-3 py-2 text-center">เคยขอล่าสุด</th>
                  <th className="px-3 py-2 text-right">ส่งคำขอ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {due.map((c) => {
                  const sent = sentIds.has(c.id);
                  const isSending = sendingId === c.id;
                  return (
                    <tr key={c.id} className={cn('hover:bg-neutral-50/70 transition', sent && 'bg-emerald-50/40')}>
                      <td className="px-3 py-2">
                        <div className="text-xs font-medium text-neutral-800 truncate max-w-[180px]">{c.name}</div>
                        {c.code && <div className="text-[10px] text-neutral-400 font-mono">{c.code}</div>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-600">{c.total_orders}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">{baht(c.total_spent)}</td>
                      <td className="px-3 py-2 text-center text-[11px] text-neutral-400">
                        {c.last_survey_at ? new Date(c.last_survey_at).toLocaleDateString('th-TH') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {sent ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check size={13} /> ส่งแล้ว</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void send(c)}
                            disabled={sendingId !== null || cooling}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-violet-600 text-white text-[11px] font-bold hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto whitespace-nowrap"
                          >
                            {isSending ? <><Loader2 size={12} className="animate-spin" /> กำลังส่ง...</>
                              : cooling ? <><Clock size={12} /> รอ {cooldownLeft}s</>
                                : <><Send size={12} /> ขอคะแนน</>}
                          </button>
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

      {/* Responses */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
          <span>คำตอบล่าสุด · ตอบแล้ว {answered.length} · รอตอบ {pending}</span>
        </div>
        {answered.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
            ยังไม่มีคำตอบกลับมา<br />
            <span className="text-neutral-300">(เมื่อลูกค้าแตะให้คะแนนจากลิงก์ จะแสดงที่นี่ทันที)</span>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {answered.map((r) => {
              const b = bucket(r.score!);
              const tone = b === 'promoter' ? 'emerald' : b === 'passive' ? 'amber' : 'red';
              return (
                <div key={r.id} className={cn('flex items-start gap-3 px-3 py-2.5', b === 'detractor' && 'bg-red-50/40')}>
                  <div className={cn('flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-sm font-extrabold tabular-nums',
                    tone === 'emerald' ? 'bg-emerald-100 text-emerald-700'
                      : tone === 'amber' ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700')}>
                    {r.score}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-neutral-800 truncate">{r.customer_name ?? 'ลูกค้า'}</span>
                      {b === 'detractor' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">⚠ ต้องดูแลด่วน</span>
                      )}
                      {b === 'promoter' && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600">★ ผู้สนับสนุน</span>
                      )}
                    </div>
                    {r.comment ? (
                      <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">“{r.comment}”</p>
                    ) : (
                      <p className="text-[11px] text-neutral-300 mt-0.5">ไม่มีความเห็นเพิ่มเติม</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-[10px] text-neutral-400 text-right whitespace-nowrap">
                    {r.answered_at ? new Date(r.answered_at).toLocaleDateString('th-TH') : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed">
        ส่งทีละราย เว้นจังหวะ เพื่อกัน LINE มองเป็นบอท · คำตอบจากลูกค้าบันทึกผ่านหน้าเว็บสาธารณะแบบไม่ต้องล็อกอิน (ผูกกับโทเคนเฉพาะของแต่ละลิงก์)
      </p>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number; tone: 'emerald' | 'amber' | 'red';
}) {
  const cls = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 flex flex-col items-center justify-center">
      <div className={cn('text-2xl font-extrabold tabular-nums', cls)}>{value}</div>
      <div className={cn('text-[10px] font-semibold mt-0.5 inline-flex items-center gap-1', cls)}>{icon} {label}</div>
    </div>
  );
}
