import { useState } from 'react';
import { X, Loader2, Gift, Plus, Minus, Check, Copy, AlertCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loyaltyApi } from '../lib/api';

const baht = (n: number) => '฿' + new Intl.NumberFormat('th-TH').format(n);
const nf = (n: number) => new Intl.NumberFormat('th-TH').format(n);

/**
 * Reward tiers for redeeming loyalty points → a fixed-baht discount coupon.
 * Higher tiers give better value (encourages saving). Adjust here as needed.
 */
const REWARD_TIERS: { points: number; discount: number }[] = [
    { points: 500, discount: 50 },
    { points: 1000, discount: 120 },
    { points: 2000, discount: 280 },
    { points: 5000, discount: 800 },
];

function translateErr(msg: string): string {
    if (msg.includes('insufficient_points')) return 'แต้มสะสมไม่พอ';
    if (msg.includes('forbidden')) return 'ไม่มีสิทธิ์ทำรายการนี้';
    if (msg.includes('invalid_amount')) return 'จำนวนไม่ถูกต้อง';
    if (msg.includes('customer_not_found')) return 'ไม่พบลูกค้า';
    return msg;
}

export default function LoyaltyActionsModal({
    customerId,
    customerName,
    balance,
    onClose,
    onDone,
}: {
    customerId: string;
    customerName: string;
    balance: number;
    onClose: () => void;
    onDone: () => void;
}) {
    const [tab, setTab] = useState<'redeem' | 'adjust'>('redeem');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [coupon, setCoupon] = useState<{ code: string; discount: number; points: number } | null>(null);
    const [copied, setCopied] = useState(false);

    const [adjSign, setAdjSign] = useState<1 | -1>(1);
    const [adjPoints, setAdjPoints] = useState('');
    const [adjNote, setAdjNote] = useState('');

    async function doRedeem(points: number, discount: number) {
        if (busy) return;
        setBusy(true);
        setErr(null);
        try {
            const res = await loyaltyApi.redeem(customerId, points, discount, `แลก ${points} แต้ม → ส่วนลด ฿${discount}`);
            setCoupon({ code: res.coupon_code, discount, points });
            onDone();
        } catch (e) {
            setErr(translateErr((e as Error).message));
        } finally {
            setBusy(false);
        }
    }

    async function doAdjust() {
        const n = parseInt(adjPoints.replace(/\D/g, ''), 10);
        if (!n || busy) return;
        setBusy(true);
        setErr(null);
        try {
            await loyaltyApi.adjust(customerId, n * adjSign, adjNote.trim() || undefined);
            onDone();
            onClose();
        } catch (e) {
            setErr(translateErr((e as Error).message));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/50" onMouseDown={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-neutral-900 inline-flex items-center gap-1.5">
                            <Sparkles size={15} className="text-amber-500" /> จัดการแต้มสะสม
                        </div>
                        <div className="text-[11px] text-neutral-500 truncate">{customerName}</div>
                    </div>
                    <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
                </div>

                {/* Balance */}
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-center">
                    <div className="text-[11px] text-amber-700">แต้มคงเหลือ</div>
                    <div className="text-2xl font-extrabold tabular-nums text-amber-900">{nf(balance)} <span className="text-sm font-medium">แต้ม</span></div>
                </div>

                {coupon ? (
                    /* ── Redeem success ─────────────────────────────── */
                    <div className="p-5 flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-emerald-100 grid place-items-center text-emerald-600"><Check size={26} /></div>
                        <div className="text-center">
                            <div className="text-sm font-bold text-neutral-900">แลกแต้มสำเร็จ!</div>
                            <div className="text-xs text-neutral-500">ใช้ {nf(coupon.points)} แต้ม เป็นส่วนลด {baht(coupon.discount)}</div>
                        </div>
                        <div className="w-full rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 p-3 text-center">
                            <div className="text-[10px] text-indigo-500 mb-0.5">โค้ดส่วนลด (ใช้ได้ 90 วัน · ครั้งเดียว)</div>
                            <div className="flex items-center justify-center gap-2">
                                <span className="text-lg font-mono font-extrabold tracking-wider text-indigo-700">{coupon.code}</span>
                                <button
                                    type="button"
                                    onClick={() => { void navigator.clipboard?.writeText(coupon.code); setCopied(true); }}
                                    className="text-indigo-500 hover:text-indigo-700"
                                    title="คัดลอกโค้ด"
                                >
                                    {copied ? <Check size={15} /> : <Copy size={15} />}
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] text-neutral-400 text-center">ส่งโค้ดนี้ให้ลูกค้า แล้วใช้ตอนเปิดบิลครั้งถัดไป</p>
                        <button type="button" onClick={onClose} className="h-9 px-5 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">เสร็จสิ้น</button>
                    </div>
                ) : (
                    <>
                        {/* Tabs */}
                        <div className="flex border-b border-neutral-100">
                            <button type="button" onClick={() => { setTab('redeem'); setErr(null); }}
                                className={cn('flex-1 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5', tab === 'redeem' ? 'text-indigo-700 border-b-2 border-indigo-500' : 'text-neutral-500')}>
                                <Gift size={14} /> แลกแต้ม
                            </button>
                            <button type="button" onClick={() => { setTab('adjust'); setErr(null); }}
                                className={cn('flex-1 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5', tab === 'adjust' ? 'text-indigo-700 border-b-2 border-indigo-500' : 'text-neutral-500')}>
                                <Plus size={14} /> ปรับแต้ม
                            </button>
                        </div>

                        {err && (
                            <div className="m-3 mb-0 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-1.5">
                                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
                            </div>
                        )}

                        {tab === 'redeem' ? (
                            <div className="p-3 grid grid-cols-2 gap-2">
                                {REWARD_TIERS.map((r) => {
                                    const ok = balance >= r.points;
                                    return (
                                        <button
                                            key={r.points}
                                            type="button"
                                            disabled={!ok || busy}
                                            onClick={() => void doRedeem(r.points, r.discount)}
                                            className={cn(
                                                'rounded-lg border p-3 text-center transition',
                                                ok ? 'border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50' : 'border-neutral-100 bg-neutral-50 opacity-50 cursor-not-allowed',
                                            )}
                                        >
                                            <div className="text-lg font-extrabold text-indigo-700 tabular-nums">{baht(r.discount)}</div>
                                            <div className="text-[11px] text-neutral-500">ใช้ {nf(r.points)} แต้ม</div>
                                            {!ok && <div className="text-[9px] text-rose-400 mt-0.5">แต้มไม่พอ</div>}
                                        </button>
                                    );
                                })}
                                {busy && <div className="col-span-2 text-center text-xs text-neutral-500 py-1"><Loader2 size={14} className="animate-spin inline mr-1" /> กำลังแลกแต้ม...</div>}
                            </div>
                        ) : (
                            <div className="p-3 flex flex-col gap-2.5">
                                <div className="flex items-center gap-2">
                                    <div className="inline-flex rounded-md border border-neutral-200 overflow-hidden">
                                        <button type="button" onClick={() => setAdjSign(1)} className={cn('h-9 w-10 grid place-items-center', adjSign === 1 ? 'bg-emerald-500 text-white' : 'text-neutral-500 hover:bg-neutral-100')} title="เพิ่มแต้ม"><Plus size={16} /></button>
                                        <button type="button" onClick={() => setAdjSign(-1)} className={cn('h-9 w-10 grid place-items-center', adjSign === -1 ? 'bg-rose-500 text-white' : 'text-neutral-500 hover:bg-neutral-100')} title="ลดแต้ม"><Minus size={16} /></button>
                                    </div>
                                    <input
                                        type="text" inputMode="numeric" value={adjPoints}
                                        onChange={(e) => setAdjPoints(e.target.value.replace(/\D/g, '').slice(0, 7))}
                                        placeholder="จำนวนแต้ม"
                                        className="flex-1 h-9 rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                                <input
                                    type="text" value={adjNote} onChange={(e) => setAdjNote(e.target.value)}
                                    placeholder="หมายเหตุ (เช่น โบนัสพิเศษ, แก้ไขยอด)" maxLength={120}
                                    className="h-9 rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                />
                                <button
                                    type="button"
                                    onClick={() => void doAdjust()}
                                    disabled={busy || !adjPoints}
                                    className="h-9 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                    {adjSign === 1 ? 'เพิ่มแต้ม' : 'ลดแต้ม'} {adjPoints && `${nf(parseInt(adjPoints, 10) || 0)} แต้ม`}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
