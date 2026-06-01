import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Bell, Send, Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reorderApi, type ReorderDue } from '../lib/api';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

const DEFAULT_MSG =
    'สวัสดีค่ะ คุณ{ชื่อ} 😊 จาก JNAC นะคะ — ลูกค้าเคยสั่งสินค้ากับเราไปสักพักแล้ว ของใกล้หมดหรือยังคะ? หากต้องการสั่งเพิ่ม แจ้งเอยได้เลยนะคะ มีราคาพิเศษสำหรับลูกค้าประจำด้วยค่ะ 🙏';

/**
 * Reorder reminders: lists customers who are due to reorder (paid purchase
 * over the interval ago + a linked LINE chat) and lets the admin nudge each
 * one over LINE with one click, using an editable message template. The send
 * reuses the normal chat send (so it shows in Omni-Chat + goes to LINE) and
 * stamps the customer so they drop off the list.
 */
export default function CustomerReorder() {
    const [rows, setRows] = useState<ReorderDue[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [template, setTemplate] = useState(DEFAULT_MSG);
    const [sendingId, setSendingId] = useState<string | null>(null);
    const [sentIds, setSentIds] = useState<Set<string>>(new Set());

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setRows(await reorderApi.listDue());
            setSentIds(new Set());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { void load(); }, []);

    async function send(r: ReorderDue) {
        if (sendingId) return;
        setSendingId(r.id);
        setErr(null);
        try {
            const text = template.replaceAll('{ชื่อ}', r.name).replaceAll('{name}', r.name);
            await reorderApi.sendReminder({ customerId: r.id, conversationId: r.conversation_id, text });
            setSentIds((s) => new Set(s).add(r.id));
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
            {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
                </div>
            )}

            {/* Message template */}
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                    <Bell size={13} className="text-indigo-500" /> ข้อความเตือนซื้อซ้ำ (แก้ได้)
                </div>
                <div className="p-3">
                    <textarea
                        value={template}
                        onChange={(e) => setTemplate(e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                    />
                    <p className="mt-1 text-[10px] text-neutral-400 flex items-center gap-1">
                        <Info size={11} /> ใช้ <code className="font-mono">{'{ชื่อ}'}</code> แทนชื่อลูกค้า · ส่งผ่าน LINE และจะขึ้นใน Omni-Chat ด้วย
                    </p>
                </div>
            </div>

            {/* Due list */}
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
                    <span>ลูกค้าที่ถึงรอบเตือน · {rows.length} ราย</span>
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
                                                        onClick={() => void send(r)}
                                                        disabled={sendingId === r.id}
                                                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 ml-auto"
                                                    >
                                                        {sendingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                                        ส่งเตือน LINE
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
                รอบเตือน = 45 วันนับจากออเดอร์ที่จ่ายเงินล่าสุด (ปรับได้ในฐานข้อมูล: view <code className="font-mono">reorder_due</code>) ·
                เตือนแล้วจะเว้น 30 วันก่อนเตือนอีกครั้ง
            </p>
        </div>
    );
}
