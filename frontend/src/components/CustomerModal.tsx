import { useState, type FormEvent } from 'react';
import { X, User, Mail, Phone, Briefcase, Hash, Award } from 'lucide-react';
import type { Customer } from '../lib/database.types';

export interface CustomerFormData {
  code: string;
  name: string;
  customer_type: 'individual' | 'company';
  tier: 'general' | 'silver' | 'gold' | 'vip';
  email: string;
  phone: string;
  tax_id: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CustomerFormData) => Promise<void> | void;
  editing?: Customer | null;
}

function build(c: Customer | null | undefined): CustomerFormData {
  return {
    code: c?.code ?? '',
    name: c?.name ?? '',
    customer_type: (c?.customer_type as 'individual' | 'company') ?? 'individual',
    tier: (c?.tier as CustomerFormData['tier']) ?? 'general',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    tax_id: c?.tax_id ?? '',
    notes: c?.notes ?? '',
  };
}

export default function CustomerModal(props: Props) {
  if (!props.isOpen) return null;
  return <Form key={props.editing?.id ?? 'new'} {...props} />;
}

function Form({ onClose, onSave, editing }: Omit<Props, 'isOpen'>) {
  const [form, setForm] = useState<CustomerFormData>(() => build(editing));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isNew = !editing;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-gradient-to-br from-indigo-500/10 to-rose-500/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <User size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {isNew ? 'เพิ่มลูกค้าใหม่' : 'แก้ไขข้อมูลลูกค้า'}
              </h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[0.2em] font-black">
                {isNew ? 'New Customer' : editing?.code ?? 'Customer'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {err && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Hash size={12} /> รหัสลูกค้า
              </label>
              <input
                type="text" placeholder="CUS-001"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Briefcase size={12} /> ประเภท
              </label>
              <select
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white"
                value={form.customer_type}
                onChange={e => setForm({ ...form, customer_type: e.target.value as CustomerFormData['customer_type'] })}
              >
                <option value="individual">บุคคล</option>
                <option value="company">บริษัท</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Award size={12} /> ระดับ (Tier)
              </label>
              <select
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white"
                value={form.tier}
                onChange={e => setForm({ ...form, tier: e.target.value as CustomerFormData['tier'] })}
              >
                <option value="general">General</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="vip">VIP</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              ชื่อลูกค้า *
            </label>
            <input
              type="text" required placeholder="ชื่อบริษัท / ชื่อบุคคล"
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Mail size={12} /> Email
              </label>
              <input
                type="email"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Phone size={12} /> โทรศัพท์
              </label>
              <input
                type="tel"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              เลขประจำตัวผู้เสียภาษี
            </label>
            <input
              type="text"
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
              value={form.tax_id}
              onChange={e => setForm({ ...form, tax_id: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              หมายเหตุ
            </label>
            <textarea
              rows={3}
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none resize-none"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 py-3 rounded-xl border border-white/5 bg-white/5 text-slate-400 font-bold hover:bg-white/10 hover:text-white transition uppercase tracking-[0.2em] text-[10px] disabled:opacity-50">
              ยกเลิก
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl bg-indigo-500 text-white font-black hover:bg-indigo-600 transition shadow-lg shadow-indigo-500/30 uppercase tracking-[0.2em] text-[10px] disabled:opacity-50">
              {saving ? 'กำลังบันทึก...' : isNew ? 'เพิ่มลูกค้า' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
