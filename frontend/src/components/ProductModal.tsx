import React, { useState } from 'react';
import { X, Package, Tag, DollarSign, Hash, ChevronDown } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
  editingProduct?: Product | null;
}

const CATEGORIES = ['Abrasives', 'Power Tools', 'Hand Tools', 'Safety', 'Adhesives', 'Cutting', 'General'];

const EMPTY_PRODUCT_FORM: Partial<Product> = { name: '', price: 0, stock: 0, category: 'General' };

export default function ProductModal(props: ProductModalProps) {
  const { isOpen, editingProduct } = props;
  if (!isOpen) return null;

  return <ProductModalForm key={editingProduct?.id ?? 'new-product'} {...props} />;
}

function ProductModalForm({ onClose, onSave, editingProduct }: Omit<ProductModalProps, 'isOpen'>) {
  const [formData, setFormData] = useState<Partial<Product>>(() => editingProduct ?? EMPTY_PRODUCT_FORM);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: editingProduct?.id || Date.now().toString(),
      name: formData.name || '',
      price: Number(formData.price) || 0,
      stock: Number(formData.stock) || 0,
      category: formData.category || 'General',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-br from-indigo-500/10 to-rose-500/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Package size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white leading-tight">
                {editingProduct ? 'แก้ไขข้อมูลสินค้า' : 'เพิ่มสินค้าใหม่'}
              </h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[0.2em] font-black">
                {editingProduct ? `Stock ID: #${editingProduct.id.padStart(4,'0')}` : 'Warehouse Management System'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
            title="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {/* Product Name */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Tag size={12} /> ชื่อรายการสินค้า
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="เช่น ใบเจียรเหล็ก 4 นิ้ว..."
              className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-white focus:border-indigo-500 outline-none transition-all placeholder:text-slate-700"
              value={formData.name || ''}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              title="กรอกชื่อสินค้า"
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Price */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <DollarSign size={12} /> ราคาต่อหน่วย (฿)
              </label>
              <input
                type="number"
                required
                min="0"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-white focus:border-indigo-500 outline-none transition-all"
                value={formData.price ?? 0}
                onChange={e => setFormData({ ...formData, price: Number(e.target.value) })}
                title="กรอกราคาสินค้า"
              />
            </div>
            {/* Stock */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <Hash size={12} /> จำนวนคงคลัง
              </label>
              <input
                type="number"
                required
                min="0"
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-white focus:border-indigo-500 outline-none transition-all"
                value={formData.stock ?? 0}
                onChange={e => setFormData({ ...formData, stock: Number(e.target.value) })}
                title="กรอกจำนวนคงคลัง"
              />
            </div>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Package size={12} /> หมวดหมู่หลัก
            </label>
            <div className="relative group">
              <select
                className="w-full bg-slate-950 border border-white/5 rounded-xl py-3.5 px-4 text-white appearance-none focus:border-indigo-500 outline-none transition-all cursor-pointer"
                value={formData.category || 'General'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                title="เลือกหมวดหมู่"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat} className="bg-slate-950 text-white">{cat}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                <ChevronDown size={18} />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-4 rounded-xl border border-white/5 bg-white/5 text-slate-400 font-bold hover:bg-white/10 hover:text-white transition-all uppercase tracking-[0.2em] text-[10px]"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="flex-1 py-4 rounded-xl bg-indigo-500 text-white font-black hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/30 uppercase tracking-[0.2em] text-[10px]"
            >
              {editingProduct ? 'บันทึกรายการ' : 'ยืนยันเพิ่มสินค้า'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
