import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, CalendarClock, Send, X, Search,
  Clock, Trash2, BellRing,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { scheduleApi, segmentCampaignApi, type ScheduledMessage, type CampaignRecipient } from '../lib/api';

const fmt = (s: string) => new Date(s).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function CustomerSchedule() {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create form
  const [cust, setCust] = useState<CampaignRecipient | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [when, setWhen] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [its, recs] = await Promise.all([scheduleApi.listOverview(), segmentCampaignApi.listRecipients()]);
      setItems(its);
      setRecipients(recs);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const filteredRecs = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return recipients.slice(0, 30);
    return recipients.filter((r) => r.name?.toLowerCase().includes(s) || r.code?.toLowerCase().includes(s)).slice(0, 30);
  }, [recipients, q]);

  const due = items.filter((i) => i.status === 'pending' && i.is_due);
  const upcoming = items.filter((i) => i.status === 'pending' && !i.is_due);
  const history = items.filter((i) => i.status !== 'pending').slice(0, 20);

  async function create() {
    if (!cust || !when || !text.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await scheduleApi.create({
        customerId: cust.id, conversationId: cust.conversation_id,
        text: text.trim(), scheduledAt: new Date(when).toISOString(),
      });
      setText(''); setWhen(''); setCust(null);
      await load();
    } catch (e) {
      setErr(`ตั้งเวลาไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function sendNow(item: ScheduledMessage) {
    setBusyId(item.id);
    setErr(null);
    try {
      await scheduleApi.sendNow(item);
      await load();
    } catch (e) {
      setErr(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await scheduleApi.cancel(id);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-sm text-neutral-500"><Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดตารางนัดส่ง...</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-[11px] text-teal-800 leading-relaxed flex items-start gap-2">
        <CalendarClock size={14} className="mt-0.5 flex-shrink-0 text-teal-500" />
        <div>
          <b>ตารางนัดส่ง</b> — ตั้งเวลาส่งข้อความ LINE ล่วงหน้า ระบบจัดคิวตามวันเวลา · เมื่อ<b>ถึงกำหนด</b> จะขึ้นเตือนให้<b>กดยืนยันส่งเอง</b> (กัน LINE มองเป็นบอท ไม่ส่งอัตโนมัติ)
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* Create */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
          <CalendarClock size={13} className="text-teal-500" /> ตั้งนัดส่งใหม่
        </div>
        <div className="p-3 flex flex-col gap-2.5">
          <div className="relative">
            {cust ? (
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
                <div className="min-w-0"><div className="text-sm font-medium text-neutral-800 truncate">{cust.name}</div><div className="text-[10px] text-neutral-400 font-mono">{cust.code ?? '—'} · LINE</div></div>
                <button type="button" onClick={() => setCust(null)} className="text-neutral-400 hover:text-neutral-600 p-1"><X size={15} /></button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickerOpen((v) => !v)} className="w-full inline-flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:border-teal-300 hover:text-teal-600">
                <Search size={14} /> เลือกลูกค้า (ต้องมี LINE)...
              </button>
            )}
            {pickerOpen && !cust && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg overflow-hidden">
                <div className="p-2 border-b border-neutral-100">
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา..." className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-teal-400" />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {filteredRecs.length === 0 ? <div className="p-3 text-center text-xs text-neutral-400">ไม่พบลูกค้าที่มี LINE</div>
                    : filteredRecs.map((r) => (
                      <button key={r.id} type="button" onClick={() => { setCust(r); setPickerOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-teal-50 border-b border-neutral-50 last:border-0">
                        <div className="text-sm text-neutral-800 truncate">{r.name}</div>
                        <div className="text-[10px] text-neutral-400 font-mono">{r.code ?? '—'}</div>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold text-neutral-600">เวลาส่ง</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-teal-400" />
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="ข้อความที่จะส่ง..."
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 resize-none" />
          <button type="button" onClick={() => void create()} disabled={!cust || !when || !text.trim() || saving}
            className="self-start inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 disabled:opacity-50">
            {saving ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : <><CalendarClock size={14} /> ตั้งเวลาส่ง</>}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"><RefreshCw size={12} /> รีเฟรช</button>
      </div>

      {/* Due now */}
      {due.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <BellRing size={13} /> ถึงกำหนดส่งแล้ว · {due.length} รายการ
          </div>
          <div className="divide-y divide-amber-100">
            {due.map((i) => (
              <Row key={i.id} item={i} busy={busyId === i.id} onSend={() => void sendNow(i)} onCancel={() => void cancel(i.id)} due />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600">รอส่งตามกำหนด · {upcoming.length} รายการ</div>
        {upcoming.length === 0 ? (
          <div className="p-5 text-center text-xs text-neutral-400">ยังไม่มีรายการนัดส่ง</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {upcoming.map((i) => (
              <Row key={i.id} item={i} busy={busyId === i.id} onSend={() => void sendNow(i)} onCancel={() => void cancel(i.id)} />
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600">ประวัติ</div>
          <div className="divide-y divide-neutral-100">
            {history.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-3 py-2 text-[11px]">
                <span className={cn('px-1.5 py-0.5 rounded font-bold', i.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-400')}>
                  {i.status === 'sent' ? 'ส่งแล้ว' : 'ยกเลิก'}
                </span>
                <span className="text-neutral-700 truncate flex-1">{i.customer_name ?? '—'}: {i.text}</span>
                <span className="text-neutral-400 whitespace-nowrap">{fmt(i.scheduled_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ item, busy, onSend, onCancel, due }: {
  item: ScheduledMessage; busy: boolean; onSend: () => void; onCancel: () => void; due?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-neutral-800 truncate">{item.customer_name ?? '—'} {item.customer_code && <span className="text-[10px] text-neutral-400 font-mono">{item.customer_code}</span>}</div>
        <div className="text-[11px] text-neutral-600 mt-0.5 line-clamp-2">{item.text}</div>
        <div className={cn('text-[10px] mt-0.5 inline-flex items-center gap-1', due ? 'text-amber-600 font-semibold' : 'text-neutral-400')}>
          <Clock size={10} /> {fmt(item.scheduled_at)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button type="button" onClick={onSend} disabled={busy}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-green-600 text-white text-[11px] font-bold hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <><Send size={12} /> ส่งตอนนี้</>}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} title="ยกเลิก"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 disabled:opacity-50">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
