import React, { useState } from 'react';
import { X, Package, Tag, DollarSign, Hash, ChevronDown, Barcode } from 'lucide-react';
import type { Category } from '../lib/database.types';
import type { ProductWithInventory } from '../lib/api';

export interface ProductFormData {
  sku: string;
  name_th: string;
  name_en: string;
  category_id: string | null;
  brand: string;
  unit: string;
  price: number;
  cost: number;
  status: 'active' | 'draft' | 'archived';
  /** Used only when creating a new product — initial qty in default warehouse */
  initial_quantity: number;
  reorder_level: number;
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void> | void;
  editingProduct?: ProductWithInventory | null;
  categories: Category[];
}

const UNITS = ['ชิ้น', 'กล่อง', 'ชุด', 'คู่', 'ม้วน', 'แพ็ค', 'ลัง'];

function buildInitialForm(p: ProductWithInventory | null | undefined): ProductFormData {
  if (!p) {
    return {
      sku: '',
      name_th: '',
      name_en: '',
      category_id: null,
      brand: '',
      unit: 'ชิ้น',
      price: 0,
      cost: 0,
      status: 'active',
      initial_quantity: 0,
      reorder_level: 10,
    };
  }
  const inv0 = p.inventory[0];
  return {
    sku: p.sku,
    name_th: p.name_th,
    name_en: p.name_en ?? '',
    category_id: p.category_id,
    brand: p.brand ?? '',
    unit: p.unit,
    price: Number(p.price),
    cost: Number(p.cost ?? 0),
    status: p.status as ProductFormData['status'],
    initial_quantity: inv0?.quantity ?? 0,
    reorder_level: inv0?.reorder_level ?? 10,
  };
}

export default function ProductModal(props: ProductModalProps) {
  const { isOpen, editingProduct } = props;
  if (!isOpen) return null;
  return <ProductModalForm key={editingProduct?.id ?? 'new'} {...props} />;
}

function ProductModalForm({ onClose, onSave, editingProduct, categories }: Omit<ProductModalProps, 'isOpen'>) {
  const [form, setForm] = useState<ProductFormData>(() => buildInitialForm(editingProduct));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isNew = !editingProduct;

  async function handleSubmit(e: React.FormEvent) {
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

      <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-br from-indigo-500/10 to-rose-500/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Package size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {isNew ? 'เพิ่มสินค้าใหม่' : 'แก้ไขข้อมูลสินค้า'}
              </h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[0.2em] font-black">
                {isNew ? 'Warehouse Management' : `SKU: ${editingProduct?.sku}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {err && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {err}
            </div>
          )}

          {/* SKU + Status */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Barcode size={12} /> SKU (รหัสสินค้า)
              </label>
              <input
                type="text"
                required
                placeholder="เช่น ABR-001"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.sku}
                onChange={e => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                disabled={!isNew}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                สถานะ
              </label>
              <select
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white"
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as ProductFormData['status'] })}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/* Names */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Tag size={12} /> ชื่อภาษาไทย *
            </label>
            <input
              type="text"
              required
              placeholder="เช่น ใบเจียรเหล็ก 4 นิ้ว"
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
              value={form.name_th}
              onChange={e => setForm({ ...form, name_th: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Tag size={12} /> Name (English) — optional
            </label>
            <input
              type="text"
              placeholder="e.g. Grinding Disc 4 inch"
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
              value={form.name_en}
              onChange={e => setForm({ ...form, name_en: e.target.value })}
            />
          </div>

          {/* Category + Brand */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Package size={12} /> หมวดหมู่
              </label>
              <div className="relative">
                <select
                  className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white appearance-none focus:border-indigo-500 outline-none"
                  value={form.category_id ?? ''}
                  onChange={e => setForm({ ...form, category_id: e.target.value || null })}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name_th}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                แบรนด์
              </label>
              <input
                type="text"
                placeholder="เช่น Bosch, 3M"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.brand}
                onChange={e => setForm({ ...form, brand: e.target.value })}
              />
            </div>
          </div>

          {/* Price + Cost + Unit */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <DollarSign size={12} /> ราคาขาย (฿)
              </label>
              <input
                type="number" required min="0" step="0.01"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.price}
                onChange={e => setForm({ ...form, price: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                ต้นทุน (฿)
              </label>
              <input
                type="number" min="0" step="0.01"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.cost}
                onChange={e => setForm({ ...form, cost: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                หน่วย
              </label>
              <select
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white"
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
              >
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Stock for new products */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Hash size={12} /> {isNew ? 'จำนวนเริ่มต้น' : 'จำนวนคงเหลือ'}
              </label>
              <input
                type="number" required min="0"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.initial_quantity}
                onChange={e => setForm({ ...form, initial_quantity: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                จุดสั่งซื้อใหม่ (Reorder)
              </label>
              <input
                type="number" required min="0"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 px-4 text-white focus:border-indigo-500 outline-none"
                value={form.reorder_level}
                onChange={e => setForm({ ...form, reorder_level: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-3 rounded-xl border border-white/5 bg-white/5 text-slate-400 font-bold hover:bg-white/10 hover:text-white transition-all uppercase tracking-[0.2em] text-[10px] disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-indigo-500 text-white font-black hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/30 uppercase tracking-[0.2em] text-[10px] disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : isNew ? 'เพิ่มสินค้า' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
