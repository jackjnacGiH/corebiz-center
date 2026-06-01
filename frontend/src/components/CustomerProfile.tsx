import { useEffect, useState, type ReactNode } from 'react';
import {
    X, Loader2, AlertCircle, ShoppingCart, FileText, Award, MessageSquare,
    MapPin, Phone, Mail, Smartphone, Building2, Tag, Hash, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    customerProfileApi,
    type CustomerProfileBundle,
    type RfmSegment,
} from '../lib/api';
import type { Json } from '../lib/database.types';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const SEG_LABEL: Record<RfmSegment, { label: string; emoji: string; chip: string }> = {
    champion:        { label: 'แชมป์ (VIP)',       emoji: '🏆', chip: 'bg-emerald-100 text-emerald-700' },
    loyal:           { label: 'ขาประจำ',           emoji: '💙', chip: 'bg-sky-100 text-sky-700' },
    cant_lose:       { label: 'กำลังจะหาย (ด่วน!)', emoji: '⚠️', chip: 'bg-rose-100 text-rose-700' },
    at_risk:         { label: 'เริ่มห่าง',          emoji: '🔶', chip: 'bg-amber-100 text-amber-700' },
    new:             { label: 'ลูกค้าใหม่',         emoji: '🆕', chip: 'bg-violet-100 text-violet-700' },
    needs_attention: { label: 'ต้องดูแล',           emoji: '👀', chip: 'bg-slate-100 text-slate-700' },
    hibernating:     { label: 'หลับไปแล้ว',         emoji: '💤', chip: 'bg-zinc-100 text-zinc-600' },
    prospect:        { label: 'ยังไม่เคยซื้อ',      emoji: '👤', chip: 'bg-neutral-100 text-neutral-600' },
};

const TIER_CHIP: Record<string, string> = {
    vip: 'bg-purple-100 text-purple-700', gold: 'bg-amber-100 text-amber-800',
    silver: 'bg-slate-100 text-slate-700', general: 'bg-neutral-100 text-neutral-600',
};

const ORDER_STATUS: Record<string, { label: string; chip: string }> = {
    pending:    { label: 'รอดำเนินการ',  chip: 'bg-amber-100 text-amber-700' },
    processing: { label: 'กำลังเตรียม',   chip: 'bg-blue-100 text-blue-700' },
    shipped:    { label: 'จัดส่งแล้ว',    chip: 'bg-sky-100 text-sky-700' },
    delivered:  { label: 'ส่งถึงแล้ว',    chip: 'bg-emerald-100 text-emerald-700' },
    completed:  { label: 'สำเร็จ',        chip: 'bg-emerald-100 text-emerald-700' },
    cancelled:  { label: 'ยกเลิก',        chip: 'bg-rose-100 text-rose-700' },
    returned:   { label: 'คืนสินค้า',     chip: 'bg-zinc-100 text-zinc-600' },
};

const PAY_STATUS: Record<string, { label: string; chip: string }> = {
    paid:    { label: 'จ่ายแล้ว', chip: 'bg-emerald-100 text-emerald-700' },
    unpaid:  { label: 'ค้างจ่าย', chip: 'bg-rose-100 text-rose-700' },
    partial: { label: 'จ่ายบางส่วน', chip: 'bg-amber-100 text-amber-700' },
    refunded:{ label: 'คืนเงิน', chip: 'bg-zinc-100 text-zinc-600' },
};

const LOYALTY_REASON: Record<string, string> = {
    earn_order: 'ได้จากการสั่งซื้อ', redeem: 'แลกแต้ม', adjust: 'ปรับปรุงแต้ม',
    signup_bonus: 'โบนัสสมัครสมาชิก', referral: 'แนะนำเพื่อน', expire: 'แต้มหมดอายุ',
};

const CHANNEL_LABEL: Record<string, string> = {
    line: 'LINE', messenger: 'Facebook', instagram: 'Instagram',
    whatsapp: 'WhatsApp', livechat: 'เว็บแชท', email: 'Email',
};

function Section({ icon, title, count, children }: { icon: ReactNode; title: string; count?: number; children: ReactNode }) {
    return (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 flex items-center gap-2 text-xs font-bold text-neutral-700">
                {icon} {title}
                {count != null && <span className="ml-auto text-neutral-400 font-medium tabular-nums">{count}</span>}
            </div>
            <div className="divide-y divide-neutral-100">{children}</div>
        </div>
    );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="bg-white rounded-lg border border-neutral-200 p-3">
            <div className="text-[10px] text-neutral-500">{label}</div>
            <div className="text-lg font-extrabold tabular-nums text-neutral-900 leading-tight">{value}</div>
            {sub && <div className="text-[10px] text-neutral-400">{sub}</div>}
        </div>
    );
}

function fmtAddress(a: Json | null | undefined): string | null {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    const o = a as Record<string, unknown>;
    const parts = [o.line, o.subdistrict, o.district, o.province, o.postcode]
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    return parts.length ? parts.join(' ') : null;
}

const empty = (msg: string) => <div className="px-3 py-4 text-center text-xs text-neutral-400">{msg}</div>;

export default function CustomerProfile({ customerId, onClose }: { customerId: string; onClose: () => void }) {
    const [data, setData] = useState<CustomerProfileBundle | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setErr(null);
        customerProfileApi.get(customerId)
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setErr((e as Error).message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [customerId]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const c = data?.customer;
    const rfm = data?.rfm;
    const billing = fmtAddress(c?.billing_address);
    const shipping = fmtAddress(c?.shipping_address);

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <button type="button" aria-label="ปิด" className="absolute inset-0 bg-black/40" onClick={onClose} />
            <aside className="relative w-full max-w-2xl bg-neutral-50 h-full shadow-2xl overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white border-b border-neutral-200 px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">โปรไฟล์ลูกค้า 360°</div>
                        <h2 className="text-base font-bold text-neutral-900 truncate">{c?.name ?? 'กำลังโหลด...'}</h2>
                        {c && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {c.code && <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 font-mono"><Hash size={9} />{c.code}</span>}
                                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', TIER_CHIP[c.tier] ?? TIER_CHIP.general)}>{c.tier.toUpperCase()}</span>
                                {rfm && (
                                    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded', SEG_LABEL[rfm.segment].chip)}>
                                        {SEG_LABEL[rfm.segment].emoji} {SEG_LABEL[rfm.segment].label}
                                    </span>
                                )}
                                {rfm && (
                                    <span className="text-[10px] font-mono text-neutral-500" title="Recency-Frequency-Monetary">
                                        R-F-M {rfm.r_score}-{rfm.f_score}-{rfm.m_score}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 flex-shrink-0" title="ปิด (Esc)">
                        <X size={20} />
                    </button>
                </div>

                {loading && (
                    <div className="p-10 text-center text-sm text-neutral-500">
                        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดข้อมูลลูกค้า...
                    </div>
                )}
                {err && (
                    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>โหลดไม่สำเร็จ: {err}</span>
                    </div>
                )}

                {data && c && (
                    <div className="p-4 flex flex-col gap-3">
                        {/* Key stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Stat label="ยอดซื้อสะสม" value={baht(c.total_spent)} />
                            <Stat label="จำนวนออเดอร์" value={`${c.total_orders}`} sub="ครั้ง" />
                            <Stat label="ซื้อล่าสุด" value={rfm?.recency_days == null ? '—' : `${rfm.recency_days} วัน`} sub={fmtDate(rfm?.last_purchase_at)} />
                            <Stat label="แต้มสะสม" value={`${c.loyalty_points}`} sub="แต้ม" />
                        </div>

                        {/* Contact */}
                        <Section icon={<Building2 size={13} className="text-indigo-500" />} title="ข้อมูลติดต่อ">
                            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                                {c.contact_name && <Row icon={<Building2 size={12} />} text={c.contact_name} />}
                                {c.mobile && <Row icon={<Smartphone size={12} />} text={c.mobile} />}
                                {c.phone && <Row icon={<Phone size={12} />} text={c.phone} />}
                                {c.email && <Row icon={<Mail size={12} />} text={c.email} />}
                                {c.tax_id && <Row icon={<Hash size={12} />} text={`เลขภาษี ${c.tax_id}`} />}
                                {billing && <Row icon={<MapPin size={12} />} text={billing} full />}
                                {shipping && shipping !== billing && <Row icon={<MapPin size={12} className="text-emerald-500" />} text={`ส่ง: ${shipping}`} full />}
                                {!c.contact_name && !c.mobile && !c.phone && !c.email && !billing && (
                                    <span className="text-neutral-400">— ยังไม่มีข้อมูลติดต่อ</span>
                                )}
                            </div>
                            {Array.isArray(c.tags) && c.tags.length > 0 && (
                                <div className="px-3 pb-3 flex flex-wrap items-center gap-1">
                                    <Tag size={11} className="text-neutral-400" />
                                    {c.tags.map((t) => (
                                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
                                    ))}
                                </div>
                            )}
                        </Section>

                        {/* Orders */}
                        <Section icon={<ShoppingCart size={13} className="text-indigo-500" />} title="ประวัติการสั่งซื้อ" count={data.orders.length}>
                            {data.orders.length === 0 && empty('ยังไม่มีออเดอร์')}
                            {data.orders.slice(0, 15).map((o) => {
                                const st = ORDER_STATUS[o.status] ?? { label: o.status, chip: 'bg-neutral-100 text-neutral-600' };
                                const pay = PAY_STATUS[o.payment_status] ?? { label: o.payment_status, chip: 'bg-neutral-100 text-neutral-500' };
                                return (
                                    <div key={o.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                                        <div className="flex-1 min-w-0">
                                            <span className="font-mono text-indigo-600 font-semibold">{o.code}</span>
                                            <span className="text-neutral-400 ml-2">{fmtDate(o.created_at)}</span>
                                        </div>
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', st.chip)}>{st.label}</span>
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', pay.chip)}>{pay.label}</span>
                                        <span className="font-bold tabular-nums text-neutral-900 w-20 text-right">{baht(o.total)}</span>
                                    </div>
                                );
                            })}
                        </Section>

                        {/* Quotes */}
                        <Section icon={<FileText size={13} className="text-indigo-500" />} title="ใบเสนอราคา" count={data.quotes.length}>
                            {data.quotes.length === 0 && empty('ยังไม่มีใบเสนอราคา')}
                            {data.quotes.slice(0, 10).map((q) => (
                                <div key={q.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                                    <div className="flex-1 min-w-0">
                                        <span className="font-mono text-indigo-600 font-semibold">{q.code}</span>
                                        <span className="text-neutral-400 ml-2">{fmtDate(q.created_at)}</span>
                                    </div>
                                    {q.converted_to_order_id && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">→ เปิดบิลแล้ว</span>}
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-600">{q.status}</span>
                                    <span className="font-bold tabular-nums text-neutral-900 w-20 text-right">{baht(q.total)}</span>
                                </div>
                            ))}
                        </Section>

                        {/* Loyalty */}
                        <Section icon={<Award size={13} className="text-indigo-500" />} title="แต้มสะสม" count={data.loyalty.length}>
                            {data.loyalty.length === 0 && empty('ยังไม่มีรายการแต้ม')}
                            {data.loyalty.slice(0, 12).map((l) => (
                                <div key={l.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                                    <Star size={12} className={l.points >= 0 ? 'text-amber-400' : 'text-neutral-300'} />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-neutral-700">{LOYALTY_REASON[l.reason] ?? l.reason}</span>
                                        {l.note && <span className="text-neutral-400 ml-1.5">· {l.note}</span>}
                                    </div>
                                    <span className="text-neutral-400">{fmtDate(l.created_at)}</span>
                                    <span className={cn('font-bold tabular-nums w-12 text-right', l.points >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                        {l.points >= 0 ? '+' : ''}{l.points}
                                    </span>
                                </div>
                            ))}
                        </Section>

                        {/* Chats */}
                        <Section icon={<MessageSquare size={13} className="text-indigo-500" />} title="แชต" count={data.chats.length}>
                            {data.chats.length === 0 && empty('ยังไม่มีแชตที่ผูกกับลูกค้านี้')}
                            {data.chats.slice(0, 8).map((ch) => (
                                <div key={ch.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-600 flex-shrink-0">{CHANNEL_LABEL[ch.channel] ?? ch.channel}</span>
                                    <span className="flex-1 min-w-0 truncate text-neutral-600">{ch.last_message_preview ?? ch.display_name}</span>
                                    <span className="text-neutral-400 flex-shrink-0">{fmtDate(ch.last_message_at)}</span>
                                </div>
                            ))}
                        </Section>

                        {/* Branches */}
                        {data.branches.length > 0 && (
                            <Section icon={<MapPin size={13} className="text-indigo-500" />} title="สาขา" count={data.branches.length}>
                                {data.branches.map((b) => (
                                    <div key={b.id} className="px-3 py-2 text-xs">
                                        <span className="font-medium text-neutral-800">{b.branch_name}</span>
                                        {b.branch_code && <span className="text-[10px] text-neutral-400 font-mono ml-1.5">{b.branch_code}</span>}
                                        {fmtAddress(b.address) && <span className="text-neutral-400 ml-2">{fmtAddress(b.address)}</span>}
                                    </div>
                                ))}
                            </Section>
                        )}

                        {c.notes && (
                            <Section icon={<FileText size={13} className="text-indigo-500" />} title="โน้ต">
                                <div className="p-3 text-xs text-neutral-600 whitespace-pre-wrap">{c.notes}</div>
                            </Section>
                        )}
                    </div>
                )}
            </aside>
        </div>
    );
}

function Row({ icon, text, full }: { icon: ReactNode; text: string; full?: boolean }) {
    return (
        <div className={cn('flex items-start gap-1.5 text-neutral-700', full && 'sm:col-span-2')}>
            <span className="text-neutral-400 mt-0.5 flex-shrink-0">{icon}</span>
            <span className="min-w-0">{text}</span>
        </div>
    );
}
