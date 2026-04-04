import { useState } from 'react';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, TrendingUp, DollarSign, BarChart2, Filter } from 'lucide-react';
import ProductModal from '../components/ProductModal';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

const mockData: Product[] = [
  { id: '1', name: 'กระดาษทรายกลมสักหลาด 5"', price: 15, stock: 1500, category: 'Abrasives' },
  { id: '2', name: 'ใบเจียรเหล็ก 4"', price: 25, stock: 850, category: 'Abrasives' },
  { id: '3', name: 'สว่านไฟฟ้า 12V', price: 1290, stock: 45, category: 'Power Tools' },
  { id: '4', name: 'ประแจปากตาย 8mm', price: 89, stock: 320, category: 'Hand Tools' },
  { id: '5', name: 'หมวกนิรภัย PPE Class A', price: 249, stock: 200, category: 'Safety' },
  { id: '6', name: 'ถุงมือหนังทนความร้อน', price: 120, stock: 8, category: 'Safety' },
];

const CATEGORIES = ['All', 'Abrasives', 'Power Tools', 'Hand Tools', 'Safety', 'General'];

function getStockStatus(stock: number) {
  if (stock === 0) return { label: 'หมด', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
  if (stock < 10) return { label: 'ใกล้หมด', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
  if (stock < 50) return { label: 'ต่ำ', color: '#f97316', bg: 'rgba(249,115,22,0.1)' };
  return { label: 'ปกติ', color: '#10b981', bg: 'rgba(16,185,129,0.1)' };
}

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>(mockData);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const handleSave = (product: Product) => {
    if (editingProduct) {
      setProducts(products.map(p => p.id === product.id ? product : p));
    } else {
      setProducts([...products, product]);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('ยืนยันการลบสินค้านี้?')) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingProduct(null);
    setIsModalOpen(true);
  };

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search);
    const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const totalValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);
  const lowStockCount = products.filter(p => p.stock < 10).length;
  const outOfStock = products.filter(p => p.stock === 0).length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Package size={28} color="var(--accent)" />
            Inventory Management
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.9rem' }}>
            จัดการคลังสินค้าและสต๊อกขององค์กรแบบเรียลไทม์
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="btn btn-primary"
        >
          <Plus size={18} />
          เพิ่มสินค้าใหม่
        </button>
      </div>

      {/* KPI Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        {[
          { icon: <Package size={20} />, label: 'รายการสินค้า', value: products.length, unit: 'รายการ', color: 'var(--primary)' },
          { icon: <DollarSign size={20} />, label: 'มูลค่าคลังสินค้า', value: `฿${totalValue.toLocaleString()}`, unit: '', color: 'var(--accent)' },
          { icon: <AlertTriangle size={20} />, label: 'สต๊อกต่ำ', value: lowStockCount, unit: 'รายการ', color: 'var(--warning)' },
          { icon: <BarChart2 size={20} />, label: 'หมดสต๊อก', value: outOfStock, unit: 'รายการ', color: 'var(--danger)' },
        ].map((stat, i) => (
          <div key={i} className="glass-card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: '12px', background: `${stat.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.color, flexShrink: 0 }}>
              {stat.icon}
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{stat.label}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {stat.value} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{stat.unit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(30,33,48,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '0.65rem 1rem' }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="ค้นหาสินค้า หรือ รหัส..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.9rem', width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={15} color="var(--text-muted)" />
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 600, transition: 'var(--transition)',
                background: selectedCategory === cat ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                color: selectedCategory === cat ? '#fff' : 'var(--text-muted)',
              }}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'rgba(20,23,36,0.8)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden' }}>
        {/* Table Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 140px 110px 120px 130px', gap: 0, padding: '0.75rem 1.5rem', background: 'rgba(30,33,48,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {['รหัส', 'ชื่อสินค้า', 'หมวดหมู่', 'ราคา (฿)', 'สต๊อก / สถานะ', 'จัดการ'].map((col, i) => (
            <div key={i} style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i >= 3 ? 'right' : 'left' }}>
              {col}
            </div>
          ))}
        </div>

        {/* Table Rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={40} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p>ไม่พบรายการสินค้า</p>
          </div>
        ) : (
          filtered.map((product, idx) => {
            const status = getStockStatus(product.stock);
            return (
              <div
                key={product.id}
                style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 140px 110px 120px 130px',
                  gap: 0, padding: '1rem 1.5rem', alignItems: 'center',
                  borderBottom: idx < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  transition: 'var(--transition)',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.05)')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  #{product.id.padStart(4, '0')}
                </div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                  {product.name}
                </div>
                <div>
                  <span style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: '20px', border: '1px solid rgba(99,102,241,0.2)' }}>
                    {product.category}
                  </span>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                  ฿{product.price.toLocaleString()}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: status.color, fontSize: '1rem' }}>
                    {product.stock.toLocaleString()}
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '10px', background: status.bg, color: status.color }}>
                    {status.label}
                  </span>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    onClick={() => openEditModal(product)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)', color: 'var(--primary)', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, transition: 'var(--transition)' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.25)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                  >
                    <Edit2 size={13} /> แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, transition: 'var(--transition)' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.25)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                  >
                    <Trash2 size={13} /> ลบ
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Footer */}
        <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(30,33,48,0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            แสดง {filtered.length} จาก {products.length} รายการ
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={14} color="var(--success)" />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              มูลค่ารวม: <strong style={{ color: 'var(--accent)' }}>฿{totalValue.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      </div>

      <ProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingProduct={editingProduct}
      />
    </div>
  );
}
