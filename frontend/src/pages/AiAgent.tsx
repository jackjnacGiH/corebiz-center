import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, Loader2, RefreshCw, ScanLine, AlertCircle, CheckCircle2,
  Check, X, Clock, ChevronDown, ChevronUp, ExternalLink, AlertTriangle,
  ShoppingCart, Package, Truck, MessageSquare, FileText, PackageX, UserPlus,
} from 'lucide-react';
import { aiAgentApi, type AgentTask, type AgentTaskView, type AgentCategory } from '@/lib/api';
import { Button } from '@/components/ui/button';

// --- labels & styling maps -------------------------------------------------
const CATEGORY_LABEL: Record<AgentCategory, string> = {
  sales: 'ขาย',
  ops: 'ดูแลร้าน',
  content: 'คอนเทนต์',
  seo: 'SEO',
};
const CATEGORY_BADGE: Record<AgentCategory, string> = {
  sales: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ops: 'bg-blue-50 text-blue-700 border-blue-200',
  content: 'bg-violet-50 text-violet-700 border-violet-200',
  seo: 'bg-amber-50 text-amber-700 border-amber-200',
};
const KIND_LABEL: Record<string, string> = {
  'ops.restock': 'เติมสต็อก',
  'ops.outstanding_payment': 'เงินค้างชำระ',
  'ops.daily_report': 'สรุปรายวัน',
  'sales.quote_convert': 'ปิดการขาย',
  'sales.quote_followup': 'ตามใบเสนอราคา',
  'sales.quote_request': 'ขอใบเสนอราคา (จากบอท)',
  'sales.lead': 'Lead จากบอท',
  'sales.abandoned_cart': 'ตะกร้าค้าง',
  'sales.unanswered_chat': 'แชทรอตอบ',
};

// Deep-link to the existing page that handles each kind of work.
function relatedLink(t: AgentTask): { to: string; label: string } | null {
  switch (t.related_type) {
    case 'order': return { to: '/orders', label: 'ไปที่คำสั่งซื้อ' };
    case 'quote': return { to: '/orders', label: 'ไปที่ใบเสนอราคา' };
    case 'customer':
    case 'cart': return { to: '/crm', label: 'ไปที่ลูกค้า' };
    case 'conversation': return { to: '/chat', label: 'ไปที่แชท' };
    case 'inventory': return { to: '/inventory', label: 'ไปที่คลังสินค้า' };
    case 'product': return { to: '/ecommerce', label: 'ไปที่สินค้า' };
    default: return null;
  }
}

function kindIcon(t: AgentTask) {
  switch (t.kind) {
    case 'ops.restock': return <PackageX size={18} />;
    case 'ops.outstanding_payment': return <Truck size={18} />;
    case 'ops.daily_report': return <FileText size={18} />;
    case 'sales.quote_convert':
    case 'sales.quote_followup':
    case 'sales.quote_request': return <ShoppingCart size={18} />;
    case 'sales.lead': return <UserPlus size={18} />;
    case 'sales.unanswered_chat': return <MessageSquare size={18} />;
    default: return <Package size={18} />;
  }
}

const baht = (n: unknown) => Number(n ?? 0).toLocaleString('en-US');

// --- restock digest detail -------------------------------------------------
function RestockDetail({ task }: { task: AgentTask }) {
  const [open, setOpen] = useState(false);
  const items: Array<{ sku: string; name: string; available: number; reorder_level: number }> =
    Array.isArray(task.payload?.items) ? task.payload.items : [];
  if (items.length === 0) return null;
  const shown = open ? items : items.slice(0, 6);
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">SKU</th>
              <th className="text-left font-medium px-3 py-2">สินค้า</th>
              <th className="text-right font-medium px-3 py-2">พร้อมขาย</th>
              <th className="text-right font-medium px-3 py-2">จุดสั่งซื้อ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((it, i) => (
              <tr key={i} className={it.available <= 0 ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-1.5 font-mono text-neutral-500 whitespace-nowrap">{it.sku}</td>
                <td className="px-3 py-1.5 text-neutral-700">{it.name}</td>
                <td className={`px-3 py-1.5 text-right font-semibold ${it.available <= 0 ? 'text-red-600' : 'text-neutral-700'}`}>
                  {it.available <= 0 ? 'หมด' : baht(it.available)}
                </td>
                <td className="px-3 py-1.5 text-right text-neutral-400">{baht(it.reorder_level)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 6 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs font-medium text-blue-600 hover:bg-neutral-50 border-t border-neutral-100"
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? 'ย่อ' : `ดูทั้งหมด (${items.length} รายการ)`}
        </button>
      )}
    </div>
  );
}

function DailyReportDetail({ task }: { task: AgentTask }) {
  const p = task.payload ?? {};
  const chips = [
    { label: 'ยอดขายวันนี้', value: `${baht(p.sales_today)} ฿`, tone: 'text-emerald-700' },
    { label: 'ยอดขายสัปดาห์นี้', value: `${baht(p.sales_week)} ฿`, tone: 'text-emerald-700' },
    { label: 'ใบเสนอราคาค้าง', value: `${baht(p.open_quote_value)} ฿`, tone: 'text-blue-700' },
    { label: 'ต่ำกว่าจุดสั่งซื้อ', value: `${baht(p.low_stock)} รายการ`, tone: 'text-amber-700' },
    { label: 'หมดสต็อก', value: `${baht(p.oos)} รายการ`, tone: 'text-red-600' },
    { label: 'แชทรอตอบ', value: `${baht(p.unanswered_chats)}`, tone: 'text-violet-700' },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {chips.map((c) => (
        <div key={c.label} className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
          <div className="text-[11px] text-neutral-500">{c.label}</div>
          <div className={`text-sm font-bold ${c.tone}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// --- task card -------------------------------------------------------------
function TaskCard({
  task, busy, onApprove, onReject, onSnooze, isHistory,
}: {
  task: AgentTask;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSnooze: () => void;
  isHistory: boolean;
}) {
  const link = relatedLink(task);
  const high = task.priority === 1;
  return (
    <div className={`rounded-xl border bg-white p-4 sm:p-5 ${high ? 'border-red-200' : 'border-neutral-200'}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex-shrink-0 grid place-items-center h-9 w-9 rounded-lg ${high ? 'bg-red-50 text-red-600' : 'bg-neutral-100 text-neutral-500'}`}>
          {kindIcon(task)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${CATEGORY_BADGE[task.category]}`}>
              {CATEGORY_LABEL[task.category]}
            </span>
            <span className="inline-block rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500">
              {KIND_LABEL[task.kind] ?? task.kind}
            </span>
            {high && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                <AlertTriangle size={12} /> ด่วน
              </span>
            )}
            {!task.requires_approval && (
              <span className="inline-block rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-400">
                ข้อมูล/Insight
              </span>
            )}
          </div>

          <h3 className="font-semibold text-neutral-900 leading-snug">{task.title}</h3>
          {task.summary && <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{task.summary}</p>}
          {task.recommendation && (
            <p className="mt-1.5 text-sm text-blue-700">💡 {task.recommendation}</p>
          )}

          {task.kind === 'ops.restock' && <RestockDetail task={task} />}
          {task.kind === 'ops.daily_report' && <DailyReportDetail task={task} />}

          {/* actions */}
          {!isHistory ? (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {task.requires_approval ? (
                <>
                  <Button size="sm" onClick={onApprove} disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} อนุมัติ
                  </Button>
                  <Button size="sm" variant="outline" onClick={onReject} disabled={busy}
                    className="text-red-600 border-red-200 hover:bg-red-50">
                    <X size={14} /> ปฏิเสธ
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={onApprove} disabled={busy}
                  className="bg-neutral-800 hover:bg-neutral-900 text-white">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} รับทราบ
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onSnooze} disabled={busy}>
                <Clock size={14} /> เลื่อน 3 วัน
              </Button>
              {link && (
                <Button asChild size="sm" variant="ghost" className="text-blue-600">
                  <Link to={link.to}><ExternalLink size={14} /> {link.label}</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
              <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                task.status === 'approved' || task.status === 'executed' ? 'bg-emerald-50 text-emerald-600'
                  : task.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-neutral-100 text-neutral-500'
              }`}>
                {task.status === 'approved' ? 'อนุมัติแล้ว'
                  : task.status === 'rejected' ? 'ปฏิเสธแล้ว'
                  : task.status === 'dismissed' ? 'ปิดแล้ว'
                  : task.status === 'executed' ? 'ดำเนินการแล้ว' : task.status}
              </span>
              {task.reviewed_at && <span>· {new Date(task.reviewed_at).toLocaleString('th-TH')}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- page ------------------------------------------------------------------
const VIEWS: { key: AgentTaskView; label: string }[] = [
  { key: 'active', label: 'รออนุมัติ' },
  { key: 'snoozed', label: 'เลื่อนไว้' },
  { key: 'history', label: 'ประวัติ' },
];
const CATS: { key: 'all' | AgentCategory; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'sales', label: 'ขาย' },
  { key: 'ops', label: 'ดูแลร้าน' },
  { key: 'content', label: 'คอนเทนต์' },
  { key: 'seo', label: 'SEO' },
];

export default function AiAgent() {
  const [view, setView] = useState<AgentTaskView>('active');
  const [cat, setCat] = useState<'all' | AgentCategory>('all');
  const [rows, setRows] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const flash = (m: string) => { setOk(m); window.setTimeout(() => setOk(null), 2600); };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setRows(await aiAgentApi.list(view));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => (cat === 'all' ? rows : rows.filter((r) => r.category === cat)),
    [rows, cat],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, high: rows.filter((r) => r.priority === 1).length,
      sales: 0, ops: 0, content: 0, seo: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.category] = (c[r.category] ?? 0) + 1; });
    return c;
  }, [rows]);

  async function act(id: string, fn: () => Promise<void>, msg: string) {
    setBusyId(id);
    setErr(null);
    try {
      await fn();
      setRows((prev) => prev.filter((r) => r.id !== id));
      flash(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function runScan() {
    setScanning(true);
    setErr(null);
    try {
      const res = await aiAgentApi.runScan();
      flash(`สแกนเสร็จ — พบ/อัปเดต ${res.tasks_touched} รายการ`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* header */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <Bot size={24} className="text-blue-600" />
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">AI Agent</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
            <ScanLine size={15} className={scanning ? 'animate-pulse' : ''} /> สแกนใหม่
          </Button>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        ผู้ช่วย AI คอยตรวจร้านและ<strong>เสนองานให้คุณอนุมัติ</strong> — งานที่มีผลจริง (ส่งข้อความ เปลี่ยนราคา) จะทำก็ต่อเมื่อคุณกดอนุมัติเท่านั้น
      </p>

      {/* banners */}
      {ok && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 size={16} /> <span>{ok}</span>
        </div>
      )}
      {err && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* view tabs */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              view === v.key ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {v.label}{v.key === 'active' && counts.all > 0 ? ` (${counts.all})` : ''}
          </button>
        ))}
      </div>

      {/* category filter */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              cat === c.key ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            {c.label}{c.key !== 'all' && counts[c.key] ? ` ${counts[c.key]}` : ''}
          </button>
        ))}
      </div>

      {/* list */}
      {loading ? (
        <div className="py-16 text-center text-neutral-400"><Loader2 size={24} className="animate-spin inline" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-neutral-400">
          <Bot size={32} className="mx-auto mb-2 opacity-40" />
          {view === 'active' ? 'ไม่มีงานรออนุมัติ — ทุกอย่างเรียบร้อย 🎉' : 'ไม่มีรายการ'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              busy={busyId === t.id}
              isHistory={view === 'history'}
              onApprove={() => act(t.id, () => aiAgentApi.setStatus(t.id, t.requires_approval ? 'approved' : 'dismissed'),
                t.requires_approval ? 'อนุมัติแล้ว' : 'รับทราบแล้ว')}
              onReject={() => act(t.id, () => aiAgentApi.setStatus(t.id, 'rejected'), 'ปฏิเสธแล้ว')}
              onSnooze={() => act(t.id, () => aiAgentApi.snooze(t.id, 3), 'เลื่อนออกไป 3 วัน')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
