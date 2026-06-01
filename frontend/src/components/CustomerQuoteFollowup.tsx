import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, FileText, Send, Check, Info, Clock, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import { quoteFollowupApi, type OpenQuote } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

/** Follow-up message variants. {ชื่อ}=customer, {เลขที่}=quote code, {ยอด}=total. */
const DEFAULT_VARIANTS = [
    'สวัสดีค่ะ คุณ{ชื่อ} 😊 ใบเสนอราคา {เลขที่} (ยอด {ยอด}) ที่เอยส่งให้ ยังสนใจอยู่ไหมคะ? มีอะไรให้ช่วยตัดสินใจไหมคะ 🙏',
    'คุณ{ชื่อ}คะ 🙏 เรื่องใบเสนอราคา {เลขที่} ที่คุยกันไว้ เป็นยังไงบ้างคะ? ถ้าต้องการปรับราคา/จำนวน แจ้งเอยได้เลยนะคะ',
    'สวัสดีค่ะคุณ{ชื่อ} เอยจาก JNAC ค่ะ 😊 ใบเสนอราคา {เลขที่} ยอด {ยอด} ยังถืออยู่นะคะ สนใจสั่งเลยไหมคะ เดี๋ยวจัดให้ค่ะ',
    'คุณ{ชื่อ}คะ ใบเสนอราคา {เลขที่} ใกล้หมดอายุแล้วนะคะ 🙏 ถ้ายังสนใจรีบแจ้งเอยได้เลยค่ะ จะได้ล็อกราคาไว้ให้',
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TYPING_MS = () => rand(1600, 4200);
const COOLDOWN_MS = () => rand(14000, 30000);

export default function CustomerQuoteFollowup() {
    const [rows, setRows] = useState<OpenQuote[]>([]);
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
            setRows(await quoteFollowupApi.listOpen());
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

    async function send(q: OpenQuote) {
        if (sendingId || cooling || !q.conversation_id) return;
        setSendingId(q.id);
        setErr(null);
        try {
            await new Promise((res) => setTimeout(res, TYPING_MS()));
            const text = nextVariant()
                .replaceAll('{ชื่อ}', q.customer_name ?? 'ลูกค้า')
                .replaceAll('{name}', q.customer_name ?? 'ลูกค้า')
                .replaceAll('{เลขที่}', q.code)
                .replaceAll('{ยอด}', baht(q.total));
            await quoteFollowupApi.sendFollowup({ quoteId: q.id, conversationId: q.conversation_id, text });
            setSentIds((s) => new Set(s).add(q.id));
            setCooldownUntil(Date.now() + COOLDOWN_MS());
        } catch (e) {
            setErr(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setSendingId(null);
        }
    }

    if (loading) {
        return (
            <div className="p-10 text-center text-sm text-neutral-500">
                <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังหาใบเสนอราคาที่ค้าง...
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-800 leading-relaxed flex items-start gap-2">
                <FileText size={14} className="mt-0.5 flex-shrink-0 text-sky-500" />
                <div>
                    <b>กู้ตะกร้า = ตามปิดใบเสนอราคาที่ค้าง</b> (ส่งแล้วยังไม่กลายเป็นออเดอร์) เรียงยอดสูงก่อน ·
                    ส่งติดตามผ่าน LINE ได้ถ้า<b>ใบเสนอราคาผูกกับลูกค้า</b>แล้ว (ถ้ายังไม่ผูก ให้ไปผูกลูกค้าในใบเสนอราคาก่อน)
                </div>
            </div>

            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
                </div>
            )}

            {/* Message variants */}
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                    <FileText size={13} className="text-sky-500" /> ข้อความติดตาม (บรรทัดละ 1 แบบ)
                </div>
                <div className="p-3">
                    <textarea
                        value={variantsText}
                        onChange={(e) => setVariantsText(e.target.value)}
                        rows={5}
                        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none"
                    />
                    <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
                        <Info size={11} /> ตัวแปร: <code className="font-mono">{'{ชื่อ}'}</code> <code className="font-mono">{'{เลขที่}'}</code> <code className="font-mono">{'{ยอด}'}</code> · ระบบสุ่มสลับให้แต่ละราย
                    </p>
                </div>
            </div>

            {/* Open quotes */}
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
                    <span>
                        ใบเสนอราคาที่ค้าง · {rows.length} ใบ
                        {sentIds.size > 0 && <span className="text-emerald-600 ml-1.5">(ติดตามแล้ว {sentIds.size})</span>}
                    </span>
                    <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
                        <RefreshCw size={12} /> รีเฟรช
                    </button>
                </div>

                {rows.length === 0 ? (
                    <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
                        ไม่มีใบเสนอราคาที่ค้าง<br />
                        <span className="text-neutral-300">(ต้องเป็นใบเสนอราคาที่ส่งแล้ว ยังไม่แปลงเป็นออเดอร์ และไม่ถูกปฏิเสธ)</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">ใบเสนอราคา</th>
                                    <th className="px-3 py-2 text-left">ลูกค้า</th>
                                    <th className="px-3 py-2 text-right">ยอด</th>
                                    <th className="px-3 py-2 text-right">ค้างมา</th>
                                    <th className="px-3 py-2 text-center">สถานะ</th>
                                    <th className="px-3 py-2 text-right">ติดตาม</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {rows.map((q) => {
                                    const sent = sentIds.has(q.id);
                                    const isSending = sendingId === q.id;
                                    const linked = !!q.conversation_id;
                                    return (
                                        <tr key={q.id} className={cn('hover:bg-neutral-50/70 transition', sent && 'bg-emerald-50/40')}>
                                            <td className="px-3 py-2 font-mono text-xs text-indigo-600 font-semibold">{q.code}</td>
                                            <td className="px-3 py-2">
                                                {q.customer_name ? (
                                                    <div className="text-xs text-neutral-800 truncate max-w-[180px]">{q.customer_name}</div>
                                                ) : (
                                                    <span className="text-[10px] text-amber-600 inline-flex items-center gap-1"><Link2Off size={11} /> ยังไม่ผูกลูกค้า</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">{baht(q.total)}</td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums text-amber-600 whitespace-nowrap">{q.age_days} วัน</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{q.status}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {sent ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check size={13} /> ติดตามแล้ว</span>
                                                ) : !linked ? (
                                                    <span className="text-[10px] text-neutral-400">ผูกลูกค้า + LINE ก่อน</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void send(q)}
                                                        disabled={sendingId !== null || cooling}
                                                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto whitespace-nowrap"
                                                    >
                                                        {isSending ? <><Loader2 size={12} className="animate-spin" /> กำลังส่ง...</>
                                                            : cooling ? <><Clock size={12} /> รอ {cooldownLeft}s</>
                                                                : <><Send size={12} /> ส่งติดตาม</>}
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

            <p className="text-[10px] text-neutral-400 leading-relaxed">
                แสดงใบเสนอราคาที่ยังไม่ปิดการขาย (ไม่รวมฉบับร่าง/ถูกปฏิเสธ) · ติดตามแล้วเว้น 7 วันก่อนเตือนอีก ·
                ส่งทีละราย เว้นจังหวะ เพื่อกัน LINE มองเป็นบอท
            </p>
        </div>
    );
}
