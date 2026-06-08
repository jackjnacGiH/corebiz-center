import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, Loader2, RefreshCw, AlertCircle, ArrowLeft } from 'lucide-react';
import { auditApi, type AuditLog } from '@/lib/api';
import { Button } from '@/components/ui/button';

const ACTION_LABEL: Record<string, string> = {
  'user.create': 'เพิ่มผู้ใช้',
  'user.update': 'แก้ไขผู้ใช้',
  'user.activate': 'เปิดใช้งานบัญชี',
  'user.deactivate': 'ปิดใช้งานบัญชี',
  'user.set_password': 'ตั้งรหัสผ่านใหม่',
  'user.delete': 'ลบผู้ใช้',
  'user.transfer_owner': 'โอนความเป็นเจ้าของ',
};

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

export default function Audit() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setRows(await auditApi.list(300));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <ScrollText size={22} className="text-blue-600" />
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">บันทึกการใช้งาน (Audit Log)</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/users"><ArrowLeft size={15} /> จัดการผู้ใช้</Link></Button>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-4">ประวัติการจัดการผู้ใช้/สิทธิ์ — ใครทำอะไร เมื่อไหร่ (300 รายการล่าสุด)</p>

      {err && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">เวลา</th>
                <th className="text-left font-medium px-4 py-3">ผู้กระทำ</th>
                <th className="text-left font-medium px-4 py-3">การกระทำ</th>
                <th className="text-left font-medium px-4 py-3">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-400"><Loader2 size={20} className="animate-spin inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-400">ยังไม่มีบันทึก</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="px-4 py-3 text-neutral-700">{r.actor?.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 font-mono break-all">
                    {r.detail && Object.keys(r.detail).length > 0 ? JSON.stringify(r.detail) : ''}
                    {r.target_id ? <span className="text-neutral-300"> · {String(r.target_id).slice(0, 8)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
