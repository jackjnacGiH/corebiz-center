import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Bell, Send, Check, Info, Clock, ShieldCheck, Wand2, CalendarClock, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reorderApi, type ReorderDue, type ReorderForecast } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

/**
 * Multiple natural message variants. The system rotates randomly among them so
 * no two customers get an identical message — the single biggest signal LINE
 * uses to flag an account as a spam bot. Admins can edit / add lines.
 */
const DEFAULT_VARIANTS = [
    'สวัสดีค่ะ คุณ{ชื่อ} 😊 เอยจาก JNAC นะคะ ของที่เคยสั่งใกล้หมดหรือยังคะ? ถ้าต้องการเติม แจ้งเอยได้เลยค่ะ',
    'คุณ{ชื่อ} สวัสดีค่ะ 🙏 ไม่ได้สั่งของกับเรามาพักนึงแล้ว มีอะไรให้เอยช่วยดูแลไหมคะ? มีราคาพิเศษสำหรับลูกค้าประจำอยู่นะคะ',
    'สวัสดีค่ะคุณ{ชื่อ} เอยจาก JNAC ค่ะ 😊 แวะมาเช็กว่าจานขัด/กระดาษทรายพอใช้ไหมคะ ต้องการสั่งเพิ่มทักได้เลยนะคะ',
    'คุณ{ชื่อ}คะ 🙏 ครบรอบที่เคยสั่งของกับเราพอดี ถ้าของใกล้หมดบอกเอยได้เลยค่ะ เดี๋ยวจัดให้ค่ะ',
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TYPING_MS = () => rand(1600, 4200);     // pause before the message "sends" (human typing)
const COOLDOWN_MS = () => rand(14000, 30000); // gap enforced before the next send (anti-burst)

export default function CustomerReorder() {
    const [mode, setMode] = useState<'forecast' | 'due'>('forecast');
    const [rows, setRows] = useState<ReorderDue[]>([]);
    const [forecast, setForecast] = useState<ReorderForecast[]>([]);
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
            if (mode === 'forecast') setForecast(await reorderApi.listForecast());
            else setRows(await reorderApi.listDue());
            setSentIds(new Set());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { void load(); }, [mode]);

    // Tick once a second only while a cooldown is active (drives the countdown).
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
        // Shuffle-ish: advance a cursor by a random step so consecutive sends
        // don't repeat the same line, but it's not perfectly sequential either.
        variantCursor.current = (variantCursor.current + 1 + Math.floor(Math.random() * variants.length)) % variants.length;
        return variants[variantCursor.current];
    }

    async function send(id: string, name: string, conversationId: string | null) {
        if (sendingId || cooling || !conversationId) return;
        setSendingId(id);
        setErr(null);
        try {
            // Mimic a human pausing to type before the message goes out.
            await new Promise((res) => setTimeout(res, TYPING_MS()));
            const text = nextVariant().replaceAll('{ชื่อ}', name).replaceAll('{name}', name);
            await reorderApi.sendReminder({ customerId: id, conversationId, text });
            setSentIds((s) => new Set(s).add(id));
            setCooldownUntil(Date.now() + COOLDOWN_MS()); // pace the next send
        } catch (e) {
            setErr(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setSendingId(null);
        }
    }

    if (loading) {
        return (
            <div className="p-10 text-center text-sm text-neutral-500">
                <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังหาลูกค้าที่ถึงรอบเตือน...
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Mode toggle: learned-cycle forecast vs simple 45-day due list */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 self-start">
                <button type="button" onClick={() => setMode('forecast')}
                    className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        mode === 'forecast' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100')}>
                    <Wand2 size={14} /> พยากรณ์อัตโนมัติ
                </button>
                <button type="button" onClick={() => setMode('due')}
                    className={cn('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition',
                        mode === 'due' ? 'bg-indigo-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100')}>
                    <Bell size={14} /> ครบกำหนด 45 วัน
                </button>
            </div>

            {/* Anti-spam guidance */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <div>
                    <b>ส่งแบบเหมือนคน กัน LINE มองเป็นบอท:</b> ระบบ<b>สุ่มสลับข้อความหลายแบบ</b> (ไม่ส่งซ้ำกันเป๊ะ) ·
                    <b>หน่วงก่อนส่ง</b>เหมือนคนพิมพ์ · <b>เว้นจังหวะ</b>ระหว่างส่งแต่ละราย (กันส่งรัว) ·
                    แนะนำส่งในเวลาทำการ และไม่ส่งถี่เกินไป (LINE OA มีโควตาข้อความ/เดือน + ระบบกันสแปม)
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
                    <Bell size={13} className="text-indigo-500" /> ข้อความเตือน (ใส่ได้หลายแบบ — บรรทัดละ 1 ข้อความ)
                </div>
                <div className="p-3">
                    <textarea
                        value={variantsText}
                        onChange={(e) => setVariantsText(e.target.value)}
                        rows={5}
                        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                    />
                    <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
                        <Info size={11} /> ใช้ <code className="font-mono">{'{ชื่อ}'}</code> แทนชื่อลูกค้า · ระบบจะ<b>สุ่มสลับ</b>ข้อความให้แต่ละราย ·
                        ส่งผ่าน LINE และจะขึ้นใน Omni-Chat ด้วย
                    </p>
                </div>
            </div>

            {/* Forecast list (auto-draft queue from learned purchase cycle) */}
            {mode === 'forecast' && (
                <ForecastList
                    forecast={forecast} sentIds={sentIds} sendingId={sendingId} cooling={cooling} cooldownLeft={cooldownLeft}
                    onSend={(id, name, conv) => void send(id, name, conv)} onReload={() => void load()}
                />
            )}

            {/* Due list */}
            {mode === 'due' && (
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
                    <span>
                        ลูกค้าที่ถึงรอบเตือน · {rows.length} ราย
                        {sentIds.size > 0 && <span className="text-emerald-600 ml-1.5">(ส่งแล้ว {sentIds.size})</span>}
                    </span>
                    <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
                        <RefreshCw size={12} /> รีเฟรช
                    </button>
                </div>

                {rows.length === 0 ? (
                    <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
                        ยังไม่มีลูกค้าที่ถึงรอบเตือนซื้อซ้ำ<br />
                        <span className="text-neutral-300">(ต้องมีลูกค้าที่ซื้อจริง + ผูก LINE + เกิน 45 วันนับจากซื้อล่าสุด)</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">ลูกค้า</th>
                                    <th className="px-3 py-2 text-right">ห่างหายไป</th>
                                    <th className="px-3 py-2 text-right">ออเดอร์</th>
                                    <th className="px-3 py-2 text-right">ยอดรวม</th>
                                    <th className="px-3 py-2 text-center">เตือนล่าสุด</th>
                                    <th className="px-3 py-2 text-right">ส่งเตือน</th>
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
                                            <td className="px-3 py-2 text-right">
                                                <span className="text-xs font-bold tabular-nums text-amber-600">{r.recency_days} วัน</span>
                                            </td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-700">{r.total_orders}</td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-neutral-900 whitespace-nowrap">{baht(r.total_spent)}</td>
                                            <td className="px-3 py-2 text-center text-[11px] text-neutral-400">
                                                {r.last_reorder_reminder_at
                                                    ? new Date(r.last_reorder_reminder_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
                                                    : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {sent ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                                                        <Check size={13} /> ส่งแล้ว
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void send(r.id, r.name, r.conversation_id)}
                                                        disabled={sendingId !== null || cooling}
                                                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto whitespace-nowrap"
                                                    >
                                                        {isSending ? (
                                                            <><Loader2 size={12} className="animate-spin" /> กำลังส่ง...</>
                                                        ) : cooling ? (
                                                            <><Clock size={12} /> รอ {cooldownLeft}s</>
                                                        ) : (
                                                            <><Send size={12} /> ส่งเตือน LINE</>
                                                        )}
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
            )}

            <p className="text-[10px] text-neutral-400 leading-relaxed">
                {mode === 'forecast'
                    ? 'พยากรณ์อัตโนมัติ = เรียนรู้รอบซื้อจริงของลูกค้าแต่ละราย (เฉลี่ยระยะห่างระหว่างออเดอร์ที่จ่ายเงิน) แล้วคาดวันครบรอบถัดไป · ระบบจัดคิวให้ แอดมินกดส่งเอง (กัน LINE มองเป็นบอท)'
                    : 'รอบเตือน = 45 วันนับจากออเดอร์ที่จ่ายเงินล่าสุด · เตือนแล้วเว้น 30 วันก่อนเตือนอีกครั้ง · ส่งทีละราย เว้นจังหวะ ~15–30 วิ เพื่อให้เป็นธรรมชาติ'}
            </p>
        </div>
    );
}

function ForecastList({ forecast, sentIds, sendingId, cooling, cooldownLeft, onSend, onReload }: {
    forecast: ReorderForecast[];
    sentIds: Set<string>;
    sendingId: string | null;
    cooling: boolean;
    cooldownLeft: number;
    onSend: (id: string, name: string, conv: string | null) => void;
    onReload: () => void;
}) {
    const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
    return (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
                <span>
                    คิวพยากรณ์ซื้อซ้ำ · {forecast.length} ราย
                    {sentIds.size > 0 && <span className="text-emerald-600 ml-1.5">(ส่งแล้ว {sentIds.size})</span>}
                </span>
                <button type="button" onClick={onReload} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
                    <RefreshCw size={12} /> รีเฟรช
                </button>
            </div>

            {forecast.length === 0 ? (
                <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
                    ยังไม่มีข้อมูลพอจะพยากรณ์<br />
                    <span className="text-neutral-300">(ลูกค้าต้องมีออเดอร์ที่จ่ายเงิน ≥ 2 ครั้ง ระบบถึงเรียนรอบซื้อได้)</span>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                            <tr>
                                <th className="px-3 py-2 text-left">ลูกค้า</th>
                                <th className="px-3 py-2 text-center">รอบซื้อ</th>
                                <th className="px-3 py-2 text-left">สินค้าที่ซื้อบ่อย</th>
                                <th className="px-3 py-2 text-center">ครบรอบ</th>
                                <th className="px-3 py-2 text-right">ส่งเตือน</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {forecast.map((f) => {
                                const sent = sentIds.has(f.id);
                                const isSending = sendingId === f.id;
                                const overdue = f.days_until_due < 0;
                                const dueSoon = f.days_until_due >= 0 && f.days_until_due <= 7;
                                const hasLine = !!f.conversation_id;
                                return (
                                    <tr key={f.id} className={cn('hover:bg-neutral-50/70 transition', sent && 'bg-emerald-50/40', overdue && !sent && 'bg-amber-50/30')}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-neutral-900 truncate max-w-[180px]">{f.name}</div>
                                            <div className="text-[10px] text-neutral-400">{f.code ?? '—'} · {f.tier}{hasLine ? ' · LINE' : ''}</div>
                                        </td>
                                        <td className="px-3 py-2 text-center text-[11px] text-neutral-600 whitespace-nowrap">
                                            <CalendarClock size={11} className="inline mr-0.5 text-neutral-400" />ทุก ~{f.avg_cycle_days} วัน
                                            <div className="text-[9px] text-neutral-400">{f.paid_orders} ออเดอร์</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {f.usual_items ? (
                                                <div className="text-[10px] text-neutral-500 truncate max-w-[200px] inline-flex items-center gap-1"><Package size={10} className="flex-shrink-0 text-neutral-300" /> {f.usual_items}</div>
                                            ) : <span className="text-[10px] text-neutral-300">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <div className={cn('text-[11px] font-bold', overdue ? 'text-red-600' : dueSoon ? 'text-amber-600' : 'text-neutral-500')}>
                                                {overdue ? `เลย ${Math.abs(f.days_until_due)} วัน` : f.days_until_due === 0 ? 'วันนี้' : `อีก ${f.days_until_due} วัน`}
                                            </div>
                                            <div className="text-[9px] text-neutral-400">{fmtDate(f.predicted_due_at)}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {sent ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check size={13} /> ส่งแล้ว</span>
                                            ) : !hasLine ? (
                                                <span className="text-[10px] text-neutral-400">ไม่มี LINE</span>
                                            ) : (
                                                <button type="button" onClick={() => onSend(f.id, f.name, f.conversation_id)}
                                                    disabled={sendingId !== null || cooling}
                                                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto whitespace-nowrap">
                                                    {isSending ? <><Loader2 size={12} className="animate-spin" /> กำลังส่ง...</>
                                                        : cooling ? <><Clock size={12} /> รอ {cooldownLeft}s</>
                                                            : <><Send size={12} /> ส่งเตือน LINE</>}
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
    );
}
