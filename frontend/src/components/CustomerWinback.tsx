import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, HeartHandshake, Send, Check, Info, Clock, ShieldCheck, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { winbackApi, type WinbackDue } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

/** Win-back message variants (stronger than a reorder nudge — "we miss you"
 *  + an offer). Rotated randomly so no two customers get the same text. */
const DEFAULT_VARIANTS = [
    'สวัสดีค่ะ คุณ{ชื่อ} 😊 ไม่ได้สั่งของกับ JNAC มานานเลยนะคะ คิดถึงลูกค้าค่ะ 🙏 กลับมาช้อปรับสิทธิพิเศษได้เลยนะคะ',
    'คุณ{ชื่อ}คะ 🙏 หายไปนานเลย เอยมีข้อเสนอพิเศษมาฝากค่ะ กลับมาสั่งจานขัด/กระดาษทรายกับเราอีกครั้งนะคะ',
    'สวัสดีค่ะคุณ{ชื่อ} เอยจาก JNAC ค่ะ 😊 นานๆ ทีได้ทักนะคะ มีโปรพิเศษสำหรับลูกค้าเก่าให้ด้วยค่ะ สนใจทักกลับได้เลยนะคะ',
    'คุณ{ชื่อ} สบายดีไหมคะ 🙏 ไม่ได้เจอกันนานเลย JNAC มีของใหม่ + ส่วนลดพิเศษรออยู่นะคะ กลับมาเยี่ยมกันบ้างนะคะ 😊',
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TYPING_MS = () => rand(1600, 4200);
const COOLDOWN_MS = () => rand(14000, 30000);

export default function CustomerWinback() {
    const [rows, setRows] = useState<WinbackDue[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [variantsText, setVariantsText] = useState(DEFAULT_VARIANTS.join('\n'));
    const [discount, setDiscount] = useState('100');
    const [sendingId, setSendingId] = useState<string | null>(null);
    const [sentIds, setSentIds] = useState<Set<string>>(new Set());
    const [cooldownUntil, setCooldownUntil] = useState(0);
    const [nowTs, setNowTs] = useState(0);
    const variantCursor = useRef(0);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setRows(await winbackApi.listDue());
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
    const discountNum = parseInt(discount.replace(/\D/g, ''), 10) || 0;

    function nextVariant(): string {
        const variants = variantsText.split('\n').map((s) => s.trim()).filter(Boolean);
        if (variants.length === 0) return DEFAULT_VARIANTS[0];
        variantCursor.current = (variantCursor.current + 1 + Math.floor(Math.random() * variants.length)) % variants.length;
        return variants[variantCursor.current];
    }

    async function send(r: WinbackDue) {
        if (sendingId || cooling) return;
        setSendingId(r.id);
        setErr(null);
        try {
            await new Promise((res) => setTimeout(res, TYPING_MS()));
            const text = nextVariant().replaceAll('{ชื่อ}', r.name).replaceAll('{name}', r.name);
            await winbackApi.send({
                customerId: r.id,
                conversationId: r.conversation_id,
                text,
                discount: discountNum > 0 ? discountNum : undefined,
            });
            setSentIds((s) => new Set(s).add(r.id));
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
                <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังหาลูกค้าที่หายไปนาน...
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800 leading-relaxed flex items-start gap-2">
                <HeartHandshake size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                <div>
                    <b>ดึงลูกค้าที่หายไปนาน (≥ 90 วัน) กลับมา</b> — เรียง<b>ลูกค้ามูลค่าสูงก่อน</b> (คุ้มที่สุดที่จะรักษา) ·
                    แนบ<b>ส่วนลดพิเศษ</b>เพื่อจูงใจให้กลับมา · ส่งแบบเหมือนคน (สลับข้อความ + เว้นจังหวะ)
                </div>
            </div>

            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
                </div>
            )}

            {/* Message + offer */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 bg-white rounded-lg border border-neutral-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                        <HeartHandshake size={13} className="text-rose-500" /> ข้อความ Win-back (บรรทัดละ 1 แบบ)
                    </div>
                    <div className="p-3">
                        <textarea
                            value={variantsText}
                            onChange={(e) => setVariantsText(e.target.value)}
                            rows={5}
                            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 resize-none"
                        />
                        <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
                            <Info size={11} /> ใช้ <code className="font-mono">{'{ชื่อ}'}</code> แทนชื่อลูกค้า · ระบบสุ่มสลับให้แต่ละราย
                        </p>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                        <Gift size={13} className="text-indigo-500" /> แนบส่วนลด
                    </div>
                    <div className="p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-neutral-500">฿</span>
                            <input
                                type="text" inputMode="numeric" value={discount}
                                onChange={(e) => setDiscount(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="0 = ไม่แนบ"
                                className="flex-1 h-9 rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <p className="text-[10px] text-neutral-400 leading-relaxed">
                            {discountNum > 0
                                ? `จะสร้างโค้ดส่วนลด ฿${discountNum} (ใช้ครั้งเดียว 60 วัน) แนบท้ายข้อความให้ลูกค้าแต่ละราย`
                                : 'ใส่จำนวนเงินเพื่อแนบโค้ดส่วนลดอัตโนมัติ (เว้นว่าง/0 = ส่งข้อความอย่างเดียว)'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Lapsed list */}
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
                    <span>
                        ลูกค้าที่หายไปนาน · {rows.length} ราย
                        {sentIds.size > 0 && <span className="text-emerald-600 ml-1.5">(ส่งแล้ว {sentIds.size})</span>}
                    </span>
                    <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
                        <RefreshCw size={12} /> รีเฟรช
                    </button>
                </div>

                {rows.length === 0 ? (
                    <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
                        ยังไม่มีลูกค้าที่ถึงเกณฑ์ดึงกลับ<br />
                        <span className="text-neutral-300">(ต้องเคยซื้อจริง + ผูก LINE + หายไปเกิน 90 วัน)</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">ลูกค้า</th>
                                    <th className="px-3 py-2 text-right">หายไป</th>
                                    <th className="px-3 py-2 text-right">เคยซื้อ</th>
                                    <th className="px-3 py-2 text-right">มูลค่ารวม</th>
                                    <th className="px-3 py-2 text-center">ดึงล่าสุด</th>
                                    <th className="px-3 py-2 text-right">ส่ง Win-back</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {rows.map((r) => {
                                    const sent = sentIds.has(r.id);
                                    const isSending = sendingId === r.id;
                                    return (
                                        <tr key={r.id} className={cn('hover:bg-neutral-50/70 transition', sent && 'bg-emerald-50/40')}>
                                            <td className="px-3 py-2">
                                                <div className="font-medium text-neutral-900 truncate max-w-[220px]">{r.name}</div>
                                                <div className="text-[10px] text-neutral-400">{r.code ?? '—'} · {r.tier} · LINE</div>
                                            </td>
                                            <td className="px-3 py-2 text-right"><span className="text-xs font-bold tabular-nums text-rose-600">{r.recency_days} วัน</span></td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-700">{r.total_orders}</td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">{baht(r.total_spent)}</td>
                                            <td className="px-3 py-2 text-center text-[11px] text-neutral-400">
                                                {r.last_winback_at ? new Date(r.last_winback_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }) : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {sent ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check size={13} /> ส่งแล้ว</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void send(r)}
                                                        disabled={sendingId !== null || cooling}
                                                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto whitespace-nowrap"
                                                    >
                                                        {isSending ? <><Loader2 size={12} className="animate-spin" /> กำลังส่ง...</>
                                                            : cooling ? <><Clock size={12} /> รอ {cooldownLeft}s</>
                                                                : <><Send size={12} /> ส่ง Win-back</>}
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

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[10px] text-amber-800 leading-relaxed flex items-start gap-1.5">
                <ShieldCheck size={12} className="mt-0.5 flex-shrink-0 text-amber-600" />
                ลูกค้าหายไป ≥ 90 วัน · ดึงแล้วเว้น 60 วันก่อนดึงอีก (ปรับได้ใน view <code className="font-mono">winback_due</code>) ·
                ส่งทีละราย เว้นจังหวะ เพื่อกัน LINE มองเป็นบอท
            </div>
        </div>
    );
}
