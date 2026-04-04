import React, { useState, useEffect } from 'react';
import { X, Package, Tag, DollarSign, Hash } from 'lucide-react';

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

export default function ProductModal({ isOpen, onClose, onSave, editingProduct }: ProductModalProps) {
  const [formData, setFormData] = useState<Partial<Product>>({ name: '', price: 0, stock: 0, category: 'General' });

  useEffect(() => {
    if (editingProduct) {
      setFormData(editingProduct);
    } else {
      setFormData({ name: '', price: 0, stock: 0, category: 'General' });
    }
  }, [editingProduct, isOpen]);

  if (!isOpen) return null;

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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(15,17,26,0.8)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '0.75rem 1rem',
    color: 'var(--text-main)',
    fontSize: '0.95rem',
    outline: 'none',
    transition: 'var(--transition)',
    fontFamily: 'inherit',
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.5rem',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'relative',
        background: 'rgba(15,17,26,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '18px',
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(236,72,153,0.05))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: '10px', background: 'linear-gradient(135deg, var(--primary), var(--secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={20} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {editingProduct ? 'แก้ไขข้อมูลสินค้า' : 'เพิ่มสินค้าใหม่'}
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {editingProduct ? `กำลังแก้ไข #${editingProduct.id.padStart(4,'0')}` : 'กรอกข้อมูลสินค้าให้ครบถ้วน'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Product Name */}
            <div>
              <label htmlFor="product-name" style={labelStyle}>
                <Tag size={13} /> ชื่อสินค้า
              </label>
              <input
                id="product-name"
                type="text"
                required
                placeholder="เช่น ใบเจียรเหล็ก 4 นิ้ว"
                style={inputStyle}
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
              />
            </div>

            {/* Price & Stock */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label htmlFor="product-price" style={labelStyle}>
                  <DollarSign size={13} /> ราคา (฿)
                </label>
                <input
                  id="product-price"
                  type="number"
                  required
                  min="0"
                  placeholder="0"
                  style={inputStyle}
                  value={formData.price ?? 0}
                  onChange={e => setFormData({ ...formData, price: Number(e.target.value) })}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>
              <div>
                <label htmlFor="product-stock" style={labelStyle}>
                  <Hash size={13} /> จำนวนสต๊อก
                </label>
                <input
                  id="product-stock"
                  type="number"
                  required
                  min="0"
                  placeholder="0"
                  style={inputStyle}
                  value={formData.stock ?? 0}
                  onChange={e => setFormData({ ...formData, stock: Number(e.target.value) })}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <label htmlFor="product-category" style={labelStyle}>
                <Package size={13} /> หมวดหมู่
              </label>
              <select
                id="product-category"
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={formData.category || 'General'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat} style={{ background: '#0f111a' }}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ padding: '0.65rem 1.25rem' }}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: '0.65rem 1.5rem' }}
            >
              {editingProduct ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
