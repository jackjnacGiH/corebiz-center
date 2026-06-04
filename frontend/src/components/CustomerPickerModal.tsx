import { useEffect, useMemo, useState } from 'react';
import { Search, X, MapPin, Phone, Mail, User, Crown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Customer } from '../lib/database.types';

const baht = (n: unknown) => '฿' + new Intl.NumberFormat('th-TH').format(Math.round(Number(n) || 0));

const TIER_TH: Record<string, string> = { general: 'ทั่วไป', silver: 'เงิน', gold: 'ทอง', vip: 'วีไอพี' };
const TIER_CLS: Record<string, string> = {
  general: 'bg-neutral-100 text-neutral-600',
  silver: 'bg-slate-100 text-slate-600',
  gold: 'bg-amber-100 text-amber-700',
  vip: 'bg-violet-100 text-violet-700',
};

/** Format a Thai-address jsonb { line, subdistrict, district, province, postcode } */
export function formatThaiAddress(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const parts = [
    s(o.line),
    s(o.subdistrict) && `ต.${s(o.subdistrict)}`,
    s(o.district) && `อ.${s(o.district)}`,
    s(o.province) && `จ.${s(o.province)}`,
    s(o.postcode),
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Full-screen searchable customer picker. Shows rich info per customer
 * (name + tier, code, contact, phone, email, address, lifetime value) so the
 * right account is easy to find when there are many.
 */
export default function CustomerPickerModal({
  open, customers, onSelect, onClose, selectedId,
}: {
  open: boolean;
  customers: Customer[];
  onSelect: (c: Customer) => void;
  onClose: () => void;
  selectedId?: string | null;
}) {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    setQ('');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const rows = useMemo(() => customers.map(c => ({
    c,
    addr: formatThaiAddress((c as unknown as { billing_address?: unknown }).billing_address)
       || formatThaiAddress((c as unknown as { shipping_address?: unknown }).shipping_address),
  })), [customers]);

  const filtered = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return rows;
    return rows.filter(({ c, addr }) => {
      const hay = `${c.name} ${c.code ?? ''} ${c.contact_name ?? ''} ${c.phone ?? ''} ${c.mobile ?? ''} ${c.email ?? ''} ${c.tax_id ?? ''} ${addr}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [rows, q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch sm:items-center justify-center bg-black/50 sm:p-4" onMouseDown={onClose}>
      <div
        className="bg-white w-full sm:max-w-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-screen sm:max-h-[88vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header + search */}
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-3 flex-shrink-0">
          <div className="flex-1">
            <div className="text-base font-bold text-neutral-900">เลือกลูกค้า</div>
            <div className="text-[11px] text-neutral-500">{filtered.length} จาก {customers.length} ราย</div>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1"><X size={20} /></button>
        </div>
        <div className="px-4 py-2.5 border-b border-neutral-100 flex-shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหา ชื่อ / รหัส / ผู้ติดต่อ / เบอร์ / อีเมล / เลขภาษี / จังหวัด..."
              className="w-full pl-9 pr-3 h-10 rounded-lg border border-neutral-200 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 bg-neutral-50/60">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-400">ไม่พบลูกค้าที่ตรงกับคำค้น</div>
          ) : filtered.map(({ c, addr }) => {
            const isSel = selectedId === c.id;
            const tier = c.tier ?? 'general';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  'w-full text-left rounded-xl border bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm',
                  isSel ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-neutral-200',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-neutral-900">{c.name}</span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 font-semibold', TIER_CLS[tier] ?? TIER_CLS.general)}>
                        <Crown size={9} /> {TIER_TH[tier] ?? tier}
                      </span>
                      {isSel && <Check size={14} className="text-indigo-600" />}
                    </div>
                    <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{c.code ?? '—'}{c.tax_id ? ` · เลขภาษี ${c.tax_id}` : ''}</div>

                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-600">
                      {c.contact_name && <div className="inline-flex items-center gap-1 truncate"><User size={11} className="text-neutral-400 flex-shrink-0" /> {c.contact_name}</div>}
                      {(c.phone || c.mobile) && <div className="inline-flex items-center gap-1 truncate"><Phone size={11} className="text-neutral-400 flex-shrink-0" /> {[c.phone, c.mobile].filter(Boolean).join(' · ')}</div>}
                      {c.email && <div className="inline-flex items-center gap-1 truncate"><Mail size={11} className="text-neutral-400 flex-shrink-0" /> {c.email}</div>}
                    </div>
                    {addr && (
                      <div className="mt-1 inline-flex items-start gap-1 text-[11px] text-neutral-500 leading-snug">
                        <MapPin size={11} className="text-neutral-400 flex-shrink-0 mt-0.5" /> <span className="line-clamp-2">{addr}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs font-bold text-neutral-900 tabular-nums">{baht(c.total_spent)}</div>
                    <div className="text-[10px] text-neutral-400">{c.total_orders ?? 0} ออเดอร์</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
