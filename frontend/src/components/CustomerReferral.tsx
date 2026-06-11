import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, AlertCircle, UserPlus, Gift, Users, Check, Copy, Link2,
  Search, X, Award, Sparkles, Clock, Trophy, Info, Link as LinkIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { referralApi, customersApi, type ReferralRow, type ReferralLeader } from '../lib/api';
import type { Customer } from '../lib/database.types';

export default function CustomerReferral() {
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [leaders, setLeaders] = useState<ReferralLeader[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<ReferralRow | null>(null);

  // record-a-referral form
  const [referrer, setReferrer] = useState<Customer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refName, setRefName] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [refNote, setRefNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [rewardFor, setRewardFor] = useState<ReferralRow | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [r, c, lb] = await Promise.all([referralApi.listOverview(), customersApi.list(), referralApi.leaderboard()]);
      setRows(r);
      setCustomers(c);
      setLeaders(lb);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const filteredCustomers = useMemo(() => {
    const q = pickerQ.trim().toLowerCase();
    const base = customers;
    if (!q) return base.slice(0, 30);
    return base.filter((c) =>
      c.name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q) || c.phone?.includes(q),
    ).slice(0, 30);
  }, [customers, pickerQ]);

  async function pickReferrer(c: Customer) {
    setReferrer(c);
    setPickerOpen(false);
    setPickerQ('');
    setShareCode(null);
    setShareLoading(true);
    try {
      setShareCode(await referralApi.code(c.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setShareLoading(false);
    }
  }

  const shareLink = shareCode ? `${window.location.origin}${import.meta.env.BASE_URL}refer/${shareCode}` : '';

  async function copyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can select manually */ }
  }

  async function saveReferral() {
    if (!referrer || !refName.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await referralApi.create({
        referrerId: referrer.id,
        refereeName: refName.trim(),
        refereePhone: refPhone.trim() || undefined,
        note: refNote.trim() || undefined,
      });
      setRefName(''); setRefPhone(''); setRefNote('');
      await load();
    } catch (e) {
      setErr(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // stats
  const total = rows.length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const rewarded = rows.filter((r) => r.status === 'rewarded').length;
  const pointsGiven = rows.reduce((s, r) => s + (r.status === 'rewarded' ? r.referrer_points : 0), 0);

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        <Loader2 size={18} className="animate-spin inline mr-2" /> กำลังโหลดข้อมูลการแนะนำเพื่อน...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800 leading-relaxed flex items-start gap-2">
        <Gift size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
        <div>
          <b>แนะนำเพื่อน (Referral)</b> — ลูกค้าเก่าแชร์ลิงก์ส่วนตัวให้เพื่อน เพื่อนกรอกข้อมูลผ่านหน้าเว็บ (ไม่ต้องล็อกอิน) ·
          เมื่อเพื่อนสั่งซื้อ ให้กด<b>จ่ายรางวัล</b> ทั้งคู่ได้เลย (ผู้แนะนำได้แต้ม/คูปอง · เพื่อนใหม่ได้คูปองส่วนลด)
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> <span>{err}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat icon={<Users size={14} />} tone="indigo" label="การแนะนำทั้งหมด" value={String(total)} />
        <Stat icon={<Clock size={14} />} tone="amber" label="รอจ่ายรางวัล" value={String(pending)} />
        <Stat icon={<Award size={14} />} tone="emerald" label="จ่ายรางวัลแล้ว" value={String(rewarded)} />
        <Stat icon={<Sparkles size={14} />} tone="violet" label="แต้มที่แจกไป" value={pointsGiven.toLocaleString()} />
      </div>

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
            <Trophy size={13} className="text-amber-500" /> อันดับผู้แนะนำ (Top referrers)
          </div>
          <div className="divide-y divide-neutral-100">
            {leaders.slice(0, 5).map((l, i) => (
              <div key={l.referrer_id} className="flex items-center gap-3 px-3 py-2">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold flex-shrink-0',
                  i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-neutral-100 text-neutral-500')}>
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-neutral-800 truncate">{l.referrer_name ?? '—'}</div>
                  <div className="text-[10px] text-neutral-400">{l.referrer_code ?? ''}</div>
                </div>
                <div className="text-right text-[10px] text-neutral-500 leading-tight">
                  <div><b className="text-emerald-600">{l.rewarded_count}</b> สำเร็จ · {l.total_referrals} ทั้งหมด</div>
                  {l.points_earned > 0 && <div className="text-violet-600">+{l.points_earned.toLocaleString()} แต้ม</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record a referral */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-bold text-neutral-700 flex items-center gap-1.5">
          <UserPlus size={13} className="text-rose-500" /> บันทึกการแนะนำ / ขอลิงก์แชร์
        </div>
        <div className="p-3 flex flex-col gap-3">
          {/* referrer picker */}
          <div className="relative">
            <span className="block text-[11px] font-semibold text-neutral-600 mb-1">ลูกค้าผู้แนะนำ</span>
            {referrer ? (
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-800 truncate">{referrer.name}</div>
                  {referrer.code && <div className="text-[10px] text-neutral-400 font-mono">{referrer.code}</div>}
                </div>
                <button type="button" onClick={() => { setReferrer(null); setShareCode(null); }}
                  className="text-neutral-400 hover:text-neutral-600 p-1"><X size={15} /></button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickerOpen((v) => !v)}
                className="w-full inline-flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:border-rose-300 hover:text-rose-600">
                <Search size={14} /> เลือกลูกค้าผู้แนะนำ...
              </button>
            )}
            {pickerOpen && !referrer && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg overflow-hidden">
                <div className="p-2 border-b border-neutral-100">
                  <input autoFocus value={pickerQ} onChange={(e) => setPickerQ(e.target.value)}
                    placeholder="ค้นหาชื่อ / รหัส / เบอร์..."
                    className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-rose-400" />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-neutral-400">ไม่พบลูกค้า</div>
                  ) : filteredCustomers.map((c) => (
                    <button key={c.id} type="button" onClick={() => void pickReferrer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-rose-50 border-b border-neutral-50 last:border-0">
                      <div className="text-sm text-neutral-800 truncate">{c.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{c.code ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* share link */}
          {referrer && (
            <div className="rounded-lg bg-rose-50/60 border border-rose-100 p-2.5">
              <div className="text-[11px] font-semibold text-rose-700 mb-1 flex items-center gap-1"><Link2 size={12} /> ลิงก์แชร์ของลูกค้ารายนี้</div>
              {shareLoading ? (
                <div className="text-xs text-neutral-400"><Loader2 size={12} className="animate-spin inline mr-1" /> กำลังสร้างลิงก์...</div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] bg-white border border-neutral-200 rounded px-2 py-1.5 truncate text-neutral-700">{shareLink}</code>
                  <button type="button" onClick={() => void copyLink()}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 whitespace-nowrap">
                    {copied ? <><Check size={12} /> คัดลอกแล้ว</> : <><Copy size={12} /> คัดลอก</>}
                  </button>
                </div>
              )}
              <p className="mt-1 text-[10px] text-rose-400">ส่งลิงก์นี้ให้ลูกค้าเอาไปแชร์ต่อให้เพื่อน หรือกรอกข้อมูลเพื่อนด้านล่างเองได้เลย</p>
            </div>
          )}

          {/* referee fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={refName} onChange={(e) => setRefName(e.target.value)} placeholder="ชื่อเพื่อน / บริษัทที่ถูกแนะนำ *"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-rose-400" />
            <input value={refPhone} onChange={(e) => setRefPhone(e.target.value)} placeholder="เบอร์ติดต่อ (ไม่บังคับ)" inputMode="tel"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-rose-400" />
          </div>
          <input value={refNote} onChange={(e) => setRefNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)"
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-rose-400" />

          <button type="button" onClick={() => void saveReferral()} disabled={!referrer || !refName.trim() || saving}
            className="self-start inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50">
            {saving ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : <><UserPlus size={14} /> บันทึกการแนะนำ</>}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-100 bg-neutral-50 text-xs font-semibold text-neutral-600 flex items-center justify-between">
          <span>รายการแนะนำเพื่อน · {rows.length} รายการ</span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
            <RefreshCw size={12} /> รีเฟรช
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-400 leading-relaxed">
            ยังไม่มีการแนะนำเพื่อน<br />
            <span className="text-neutral-300">(เลือกลูกค้าผู้แนะนำด้านบน คัดลอกลิงก์ให้ลูกค้าแชร์ หรือบันทึกข้อมูลเพื่อนเอง)</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">เพื่อนที่ถูกแนะนำ</th>
                  <th className="px-3 py-2 text-left">ผู้แนะนำ</th>
                  <th className="px-3 py-2 text-center">ที่มา</th>
                  <th className="px-3 py-2 text-center">สถานะ</th>
                  <th className="px-3 py-2 text-right">รางวัล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r.id} className={cn('hover:bg-neutral-50/70 transition', r.status === 'rewarded' && 'bg-emerald-50/30')}>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-neutral-800 truncate max-w-[180px]">{r.referee_name}</div>
                      {r.referee_phone && <div className="text-[10px] text-neutral-400">{r.referee_phone}</div>}
                      {r.note && <div className="text-[10px] text-neutral-400 truncate max-w-[180px]">📝 {r.note}</div>}
                      {r.referee_customer_name ? (
                        <div className="text-[10px] text-emerald-600 inline-flex items-center gap-0.5 mt-0.5"><LinkIcon size={9} /> {r.referee_customer_name}</div>
                      ) : r.status !== 'rewarded' ? (
                        <button type="button" onClick={() => setLinkFor(r)} className="text-[10px] text-indigo-500 hover:text-indigo-600 inline-flex items-center gap-0.5 mt-0.5">
                          <LinkIcon size={9} /> ผูกลูกค้า
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-neutral-700 truncate max-w-[150px]">{r.referrer_name ?? '—'}</div>
                      {r.referrer_code && <div className="text-[10px] text-neutral-400 font-mono">{r.referrer_code}</div>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                        r.source === 'public' ? 'bg-sky-100 text-sky-600' : 'bg-neutral-100 text-neutral-500')}>
                        {r.source === 'public' ? 'ลิงก์แชร์' : 'บันทึกเอง'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.status === 'rewarded' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">จ่ายรางวัลแล้ว</span>
                      ) : r.status === 'expired' ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-400">หมดอายุ</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">รอจ่ายรางวัล</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'rewarded' ? (
                        <div className="text-[10px] text-neutral-500 leading-tight">
                          {r.referrer_points > 0 && <div>ผู้แนะนำ +{r.referrer_points} แต้ม</div>}
                          {r.referrer_coupon && <div className="font-mono text-emerald-600">{r.referrer_coupon}</div>}
                          {r.referee_coupon && <div className="font-mono text-rose-600">เพื่อน: {r.referee_coupon}</div>}
                        </div>
                      ) : (
                        <button type="button" onClick={() => setRewardFor(r)}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 ml-auto whitespace-nowrap">
                          <Gift size={12} /> จ่ายรางวัล
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed">
        จ่ายรางวัลเมื่อเพื่อนที่ถูกแนะนำสั่งซื้อจริงครั้งแรก · ผู้แนะนำได้แต้มสะสม (+คูปองได้) · เพื่อนใหม่ได้คูปองส่วนลดใช้ครั้งแรก
      </p>

      {rewardFor && (
        <RewardModal row={rewardFor} onClose={() => setRewardFor(null)} onDone={() => { setRewardFor(null); void load(); }} />
      )}
      {linkFor && (
        <LinkModal row={linkFor} customers={customers} onClose={() => setLinkFor(null)} onDone={() => { setLinkFor(null); void load(); }} />
      )}
    </div>
  );
}

function LinkModal({ row, customers, onClose, onDone }: {
  row: ReferralRow; customers: Customer[]; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers.slice(0, 30);
    return customers.filter((c) => c.name?.toLowerCase().includes(s) || c.code?.toLowerCase().includes(s) || c.phone?.includes(s)).slice(0, 30);
  }, [customers, q]);

  async function pick(c: Customer) {
    setBusy(true);
    setErr(null);
    try {
      await referralApi.linkCustomer(row.id, c.id);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-neutral-800 inline-flex items-center gap-1.5"><LinkIcon size={14} className="text-indigo-500" /> ผูกเพื่อนกับลูกค้า</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={16} /></button>
        </div>
        <div className="p-3">
          <p className="text-[11px] text-neutral-500 mb-2">เพื่อน: <b className="text-neutral-800">{row.referee_name}</b> → เลือกบัญชีลูกค้าที่ตรงกัน (เมื่อผูกแล้ว จ่ายรางวัลเป็นแต้มให้เพื่อนได้)</p>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / เบอร์..."
            className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 mb-2" />
          {err && <div className="text-xs text-red-600 mb-2 flex items-center gap-1"><AlertCircle size={13} /> {err}</div>}
          <div className="max-h-60 overflow-y-auto rounded-lg border border-neutral-100">
            {busy ? (
              <div className="p-4 text-center text-xs text-neutral-400"><Loader2 size={14} className="animate-spin inline mr-1" /> กำลังผูก...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-neutral-400">ไม่พบลูกค้า</div>
            ) : filtered.map((c) => (
              <button key={c.id} type="button" onClick={() => void pick(c)}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-neutral-50 last:border-0">
                <div className="text-sm text-neutral-800 truncate">{c.name}</div>
                <div className="text-[10px] text-neutral-400 font-mono">{c.code ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone: 'indigo' | 'amber' | 'emerald' | 'violet';
}) {
  const cls = tone === 'indigo' ? 'text-indigo-600' : tone === 'amber' ? 'text-amber-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-violet-600';
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 flex flex-col items-center justify-center">
      <div className={cn('text-2xl font-extrabold tabular-nums', cls)}>{value}</div>
      <div className={cn('text-[10px] font-semibold mt-0.5 inline-flex items-center gap-1', cls)}>{icon} {label}</div>
    </div>
  );
}

function RewardModal({ row, onClose, onDone }: { row: ReferralRow; onClose: () => void; onDone: () => void }) {
  const linked = !!row.referee_customer_id;
  const [referrerPoints, setReferrerPoints] = useState(100);
  const [refereeDiscount, setRefereeDiscount] = useState(200);
  const [refereePoints, setRefereePoints] = useState(0);
  const [referrerDiscount, setReferrerDiscount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ referrer_coupon: string | null; referee_coupon: string | null; referee_points: number } | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = await referralApi.reward({
        referralId: row.id, referrerPoints, refereeDiscount, referrerDiscount,
        refereePoints: linked ? refereePoints : 0,
      });
      setResult(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-neutral-800 inline-flex items-center gap-1.5"><Gift size={15} className="text-emerald-500" /> จ่ายรางวัลแนะนำเพื่อน</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={16} /></button>
        </div>

        {result ? (
          <div className="p-5 text-center">
            <Check size={40} className="mx-auto text-emerald-500" />
            <p className="mt-2 text-sm font-semibold text-neutral-800">จ่ายรางวัลเรียบร้อย 🎉</p>
            <div className="mt-3 text-xs text-neutral-600 space-y-1.5">
              {referrerPoints > 0 && <div>ผู้แนะนำ <b>{row.referrer_name}</b> ได้รับ <b>+{referrerPoints}</b> แต้ม</div>}
              {result.referee_points > 0 && <div>เพื่อนใหม่ <b>{row.referee_customer_name}</b> ได้รับ <b>+{result.referee_points}</b> แต้ม</div>}
              {result.referrer_coupon && <div>คูปองผู้แนะนำ: <code className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono">{result.referrer_coupon}</code></div>}
              {result.referee_coupon && <div>คูปองเพื่อนใหม่: <code className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-mono">{result.referee_coupon}</code></div>}
            </div>
            <p className="mt-3 text-[10px] text-neutral-400">แจ้งโค้ดคูปองให้ลูกค้าใช้ตอนสั่งซื้อได้เลย</p>
            <button type="button" onClick={onDone} className="mt-4 w-full h-10 rounded-lg bg-neutral-800 text-white text-sm font-bold hover:bg-neutral-900">เสร็จสิ้น</button>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            <div className="text-xs text-neutral-500">
              เพื่อน: <b className="text-neutral-800">{row.referee_name}</b> · แนะนำโดย <b className="text-neutral-800">{row.referrer_name ?? '—'}</b>
            </div>
            <NumberRow label="แต้มให้ผู้แนะนำ" suffix="แต้ม" value={referrerPoints} onChange={setReferrerPoints} step={50} />
            <NumberRow label="คูปองส่วนลดเพื่อนใหม่" suffix="฿" value={refereeDiscount} onChange={setRefereeDiscount} step={50} />
            {linked ? (
              <NumberRow label="แต้มให้เพื่อนใหม่" suffix="แต้ม" value={refereePoints} onChange={setRefereePoints} step={50} />
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-md px-2 py-1.5">
                <Info size={12} className="flex-shrink-0" /> ผูกเพื่อนกับบัญชีลูกค้าก่อน ถึงจะให้ "แต้ม" กับเพื่อนได้ (ตอนนี้ให้ได้เฉพาะคูปอง)
              </div>
            )}
            <NumberRow label="คูปองส่วนลดผู้แนะนำ (ถ้ามี)" suffix="฿" value={referrerDiscount} onChange={setReferrerDiscount} step={50} />

            {err && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {err}</div>}

            <button type="button" onClick={() => void go()} disabled={busy}
              className="w-full h-10 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy ? <><Loader2 size={15} className="animate-spin" /> กำลังจ่าย...</> : <>ยืนยันจ่ายรางวัล</>}
            </button>
            <p className="text-[10px] text-neutral-400 text-center">แต้มเข้าบัญชีผู้แนะนำทันที · คูปองเป็นโค้ดใช้ครั้งเดียว</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NumberRow({ label, suffix, value, onChange, step }: {
  label: string; suffix: string; value: number; onChange: (n: number) => void; step: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-600">{label}</span>
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onChange(Math.max(0, value - step))}
          className="w-7 h-7 rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 font-bold">−</button>
        <input type="number" value={value} min={0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-16 text-center rounded-md border border-neutral-200 px-1 py-1 text-sm outline-none focus:border-emerald-400 tabular-nums" />
        <span className="text-[10px] text-neutral-400 w-7">{suffix}</span>
        <button type="button" onClick={() => onChange(value + step)}
          className="w-7 h-7 rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 font-bold">+</button>
      </div>
    </div>
  );
}
