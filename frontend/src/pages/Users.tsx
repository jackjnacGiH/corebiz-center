import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Key, Trash2, Power, Crown, Loader2, RefreshCw, ShieldCheck, AlertCircle, CheckCircle2, ScrollText,
} from 'lucide-react';
import { usersApi, type AdminUser } from '@/lib/api';
import { useAuth } from '@/lib/AuthProvider';
import { useLanguage } from '@/i18n';
import { ASSIGNABLE_ROLES, roleLabel, isOwner as isOwnerRole } from '@/lib/permissions';
import type { AppRole } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

type Form = { id?: string; email: string; full_name: string; phone: string; role: AppRole; password: string };

const roleBadge: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800 border-amber-200',
  admin: 'bg-blue-100 text-blue-800 border-blue-200',
  staff: 'bg-slate-100 text-slate-700 border-slate-200',
  agent: 'bg-violet-100 text-violet-800 border-violet-200',
  customer: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

// --- Role permission guide (reference table shown on the page) ---
type Cell = 'full' | 'limited' | 'edit' | 'view' | 'none';
const CELL: Record<Cell, { label: string; cls: string }> = {
  full: { label: 'จัดการได้เต็ม', cls: 'bg-green-100 text-green-700' },
  limited: { label: 'จัดการได้ (ยกเว้น Owner)', cls: 'bg-green-100 text-green-700' },
  edit: { label: 'เพิ่ม / แก้ไข', cls: 'bg-blue-100 text-blue-700' },
  view: { label: 'ดูอย่างเดียว', cls: 'bg-slate-100 text-slate-600' },
  none: { label: 'ไม่เห็นเมนู', cls: 'bg-red-50 text-red-500' },
};
const MATRIX: { menu: string; owner: Cell; admin: Cell; staff: Cell; agentViewer: Cell }[] = [
  { menu: 'แดชบอร์ด', owner: 'full', admin: 'full', staff: 'view', agentViewer: 'view' },
  { menu: 'รายการสินค้าขาย', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'คลังสินค้า', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'คำสั่งซื้อ', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'ระบบลูกค้า (CRM)', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'แชทรวมช่องทาง', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'การตลาด / พาร์ทเนอร์', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'Knowledge Base', owner: 'full', admin: 'full', staff: 'edit', agentViewer: 'view' },
  { menu: 'AI Agent (คิวอนุมัติ)', owner: 'full', admin: 'full', staff: 'none', agentViewer: 'none' },
  { menu: 'ตั้งค่า (Settings)', owner: 'full', admin: 'full', staff: 'none', agentViewer: 'none' },
  { menu: 'จัดการผู้ใช้', owner: 'full', admin: 'limited', staff: 'none', agentViewer: 'none' },
  { menu: 'บันทึกการใช้งาน (Audit Log)', owner: 'view', admin: 'view', staff: 'none', agentViewer: 'none' },
];
function PermCell({ v }: { v: Cell }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${CELL[v].cls}`}>{CELL[v].label}</span>;
}

export default function Users() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const lang = language as 'th' | 'en';
  const meIsOwner = isOwnerRole(profile?.role);
  const myId = profile?.id;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [createMode, setCreateMode] = useState<'password' | 'invite'>('password');
  const [form, setForm] = useState<Form>({ email: '', full_name: '', phone: '', role: 'staff', password: '' });

  const [pwOpen, setPwOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState<AdminUser | null>(null);
  const [pwValue, setPwValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setUsers(await usersApi.list());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flash = (m: string) => { setOk(m); window.setTimeout(() => setOk(null), 2500); };
  const canManage = (u: AdminUser) => u.role !== 'owner' || meIsOwner;

  // role options for the dropdown (owner only offered to an owner; keep the
  // target's current role visible even if it's a legacy role like agent)
  const roleOptions = (current?: AppRole) =>
    Array.from(new Set([
      ...ASSIGNABLE_ROLES.filter((r) => r !== 'owner' || meIsOwner),
      ...(current ? [current] : []),
    ]));

  function openCreate() {
    setMode('create');
    setCreateMode('password');
    setForm({ email: '', full_name: '', phone: '', role: 'staff', password: '' });
    setErr(null);
    setEditOpen(true);
  }
  function openEdit(u: AdminUser) {
    setMode('edit');
    setForm({ id: u.id, email: u.email, full_name: u.full_name ?? '', phone: u.phone ?? '', role: u.role, password: '' });
    setErr(null);
    setEditOpen(true);
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'create') {
        await usersApi.create({
          email: form.email, role: form.role,
          full_name: form.full_name || undefined, phone: form.phone || undefined,
          mode: createMode,
          ...(createMode === 'password' ? { password: form.password } : {}),
        });
        flash(createMode === 'invite' ? 'ส่งคำเชิญทางอีเมลแล้ว' : 'เพิ่มผู้ใช้เรียบร้อย');
      } else {
        await usersApi.update({
          id: form.id!, full_name: form.full_name, phone: form.phone,
          ...(form.id === myId ? {} : { role: form.role }),
        });
        flash('บันทึกข้อมูลแล้ว');
      }
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      flash(okMsg);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openPw(u: AdminUser) { setPwTarget(u); setPwValue(''); setErr(null); setPwOpen(true); }
  async function submitPw(e: FormEvent) {
    e.preventDefault();
    if (!pwTarget) return;
    setBusy(true);
    setErr(null);
    try {
      await usersApi.setPassword(pwTarget.id, pwValue);
      flash('ตั้งรหัสผ่านใหม่แล้ว');
      setPwOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <ShieldCheck size={22} className="text-blue-600" />
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">จัดการผู้ใช้และสิทธิ์</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/audit"><ScrollText size={15} /> บันทึกการใช้งาน</Link></Button>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading || busy}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </Button>
          <Button size="sm" onClick={openCreate} disabled={busy}>
            <Plus size={16} /> เพิ่มผู้ใช้
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        เพิ่ม / แก้ไข / กำหนดสิทธิ์ (role) ของทีมงาน — Owner ทำได้ทุกอย่าง, Admin จัดการ staff ได้
      </p>

      {/* Alerts */}
      {err && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}
      {ok && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-700">
          <CheckCircle2 size={16} /> <span>{ok}</span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">ผู้ใช้</th>
                <th className="text-left font-medium px-4 py-3">สิทธิ์ (Role)</th>
                <th className="text-left font-medium px-4 py-3">สถานะ</th>
                <th className="text-right font-medium px-4 py-3">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-400">
                  <Loader2 size={20} className="animate-spin inline" /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-neutral-400">ยังไม่มีผู้ใช้</td></tr>
              ) : users.map((u) => {
                const self = u.id === myId;
                const manage = canManage(u);
                return (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">
                        {u.full_name || '—'} {self && <span className="text-[11px] text-blue-600">(คุณ)</span>}
                      </div>
                      <div className="text-xs text-neutral-400 font-mono">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${roleBadge[u.role] ?? roleBadge.customer}`}>
                        {u.role === 'owner' && <Crown size={12} />} {roleLabel(u.role, lang)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active
                        ? <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">● ใช้งานอยู่</span>
                        : <span className="inline-flex items-center gap-1 text-neutral-400 text-xs font-medium">● ปิดใช้งาน</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Button variant="ghost" size="icon-sm" title="แก้ไข" disabled={busy || !manage} onClick={() => openEdit(u)}>
                          <Pencil size={15} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="ตั้งรหัสผ่านใหม่" disabled={busy || !manage} onClick={() => openPw(u)}>
                          <Key size={15} />
                        </Button>
                        {!self && (
                          <Button variant="ghost" size="icon-sm" title={u.is_active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'} disabled={busy || !manage}
                            onClick={() => run(() => usersApi.setActive(u.id, !u.is_active), 'อัปเดตสถานะแล้ว')}>
                            <Power size={15} className={u.is_active ? 'text-amber-600' : 'text-green-600'} />
                          </Button>
                        )}
                        {meIsOwner && !self && u.is_active && u.role !== 'owner' && (
                          <Button variant="ghost" size="icon-sm" title="โอนความเป็นเจ้าของ" disabled={busy}
                            onClick={() => { if (window.confirm(`โอนความเป็นเจ้าของ (Owner) ให้ ${u.email}? คุณจะกลายเป็น Admin`)) run(() => usersApi.transferOwner(u.id), 'โอนความเป็นเจ้าของแล้ว'); }}>
                            <Crown size={15} className="text-amber-600" />
                          </Button>
                        )}
                        {meIsOwner && !self && (
                          <Button variant="ghost" size="icon-sm" title="ลบถาวร" disabled={busy}
                            onClick={() => { if (window.confirm(`ลบผู้ใช้ ${u.email} ถาวร? ย้อนกลับไม่ได้`)) run(() => usersApi.remove(u.id), 'ลบผู้ใช้แล้ว'); }}>
                            <Trash2 size={15} className="text-red-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role permission guide */}
      <details className="mt-5 rounded-xl border border-neutral-200 bg-white overflow-hidden group">
        <summary className="cursor-pointer list-none select-none px-4 py-3 flex items-center justify-between hover:bg-neutral-50">
          <span className="flex items-center gap-2 font-semibold text-neutral-800">
            <ShieldCheck size={16} className="text-blue-600" /> คู่มือสิทธิ์ตามบทบาท (👑 Owner / Admin / Staff / Agent / Viewer)
          </span>
          <span className="text-xs text-neutral-400 group-open:hidden">แตะเพื่อดู ▾</span>
          <span className="text-xs text-neutral-400 hidden group-open:inline">ซ่อน ▴</span>
        </summary>
        <div className="border-t border-neutral-100 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">เมนู / โมดูล</th>
                <th className="text-left font-medium px-4 py-2.5">👑 Owner</th>
                <th className="text-left font-medium px-4 py-2.5">Admin</th>
                <th className="text-left font-medium px-4 py-2.5">Staff</th>
                <th className="text-left font-medium px-4 py-2.5">Agent / Viewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {MATRIX.map((r) => (
                <tr key={r.menu}>
                  <td className="px-4 py-2.5 text-neutral-700">{r.menu}</td>
                  <td className="px-4 py-2.5"><PermCell v={r.owner} /></td>
                  <td className="px-4 py-2.5"><PermCell v={r.admin} /></td>
                  <td className="px-4 py-2.5"><PermCell v={r.staff} /></td>
                  <td className="px-4 py-2.5"><PermCell v={r.agentViewer} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 text-xs text-neutral-500 bg-neutral-50/60 leading-relaxed">
            <p>• <b>👑 Owner</b> ทำได้ทุกอย่าง รวมจัดการผู้ใช้ ตั้งค่า ลบข้อมูล และโอนความเป็นเจ้าของ</p>
            <p>• <b>Admin</b> เหมือน Owner แต่จัดการบัญชี Owner ไม่ได้</p>
            <p>• <b>Staff</b> เพิ่ม/แก้ไขข้อมูลปฏิบัติงานได้ แต่<b>ลบรายการหลักไม่ได้</b> และไม่เห็น “AI Agent / ตั้งค่า / จัดการผู้ใช้”</p>
            <p>• <b>Agent</b> (เซลล์/ดูข้อมูล) และ <b>Viewer</b> เข้าดูข้อมูลได้อย่างเดียว (read-only) — เพิ่ม/แก้/ลบไม่ได้</p>
            <p>• <b>ลูกค้า (Customer)</b> ที่สมัคร/ล็อกอิน จะใช้ได้เฉพาะ<b>หน้าร้าน jnac.online เท่านั้น</b> — เข้าหลังบ้านไม่ได้ ระบบใช้บัญชีเพื่อกำหนดสิทธิ์ตามระดับลูกค้า (Tier: General / Silver / Gold / VIP)</p>
            <p className="mt-1.5 text-neutral-400">หมายเหตุ: สิทธิ์ทั้งหมดบังคับจริงที่ฐานข้อมูล (RLS) ไม่ใช่แค่ซ่อนเมนู — Agent/Viewer เขียนข้อมูลไม่ได้ และการ “ลบ” ถูกจำกัดไว้ที่ Owner/Admin เท่านั้น</p>
          </div>
        </div>
      </details>

      {/* Add / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'เพิ่มผู้ใช้ใหม่' : 'แก้ไขผู้ใช้'}</DialogTitle>
            <DialogDescription>
              {mode === 'create' ? 'สร้างบัญชีทีมงาน + กำหนดสิทธิ์เริ่มต้น' : 'แก้ไขข้อมูลและสิทธิ์ของผู้ใช้'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="space-y-3">
            <div>
              <Label htmlFor="u-email">อีเมล</Label>
              <Input id="u-email" type="email" required value={form.email}
                disabled={mode === 'edit'} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="u-name">ชื่อ-นามสกุล</Label>
                <Input id="u-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="u-phone">เบอร์โทร</Label>
                <Input id="u-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="u-role">สิทธิ์ (Role)</Label>
              <select id="u-role" value={form.role} disabled={form.id === myId}
                onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50">
                {roleOptions(form.role).map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
              </select>
              {form.id === myId && <p className="text-xs text-neutral-400 mt-1">เปลี่ยนสิทธิ์ของตัวเองไม่ได้</p>}
            </div>
            {mode === 'create' && (
              <>
                <div>
                  <Label>วิธีตั้งรหัสผ่าน</Label>
                  <div className="mt-1 inline-flex rounded-lg border border-neutral-200 p-0.5 text-sm">
                    <button type="button" onClick={() => setCreateMode('password')}
                      className={`px-3 py-1.5 rounded-md transition ${createMode === 'password' ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}>
                      ตั้งรหัสผ่านเอง
                    </button>
                    <button type="button" onClick={() => setCreateMode('invite')}
                      className={`px-3 py-1.5 rounded-md transition ${createMode === 'invite' ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}>
                      ส่งคำเชิญทางอีเมล
                    </button>
                  </div>
                </div>
                {createMode === 'password' ? (
                  <div>
                    <Label htmlFor="u-pw">รหัสผ่านเริ่มต้น</Label>
                    <Input id="u-pw" type="text" required minLength={8} value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="อย่างน้อย 8 ตัวอักษร" />
                    <p className="text-xs text-neutral-400 mt-1">แจ้งรหัสนี้ให้ผู้ใช้ แล้วแนะนำให้เปลี่ยนภายหลัง</p>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    ระบบจะส่งอีเมลคำเชิญให้ผู้ใช้ตั้งรหัสผ่านเอง (ต้องตั้งค่าอีเมลของระบบให้ส่งได้)
                  </p>
                )}
              </>
            )}
            {err && <p className="text-sm text-red-600">{err}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>ยกเลิก</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />} บันทึก</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Set password dialog */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ตั้งรหัสผ่านใหม่</DialogTitle>
            <DialogDescription>{pwTarget?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPw} className="space-y-3">
            <div>
              <Label htmlFor="pw-new">รหัสผ่านใหม่</Label>
              <Input id="pw-new" type="text" required minLength={8} value={pwValue}
                onChange={(e) => setPwValue(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)} disabled={busy}>ยกเลิก</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />} ตั้งรหัสผ่าน</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
