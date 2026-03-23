import React, { useState } from 'react';
import { ShoppingBag, Search, Plus, Tag, Store, CreditCard } from 'lucide-react';

// Mock Data: จำลองข้อมูลสินค้า (จาก Lumo + รวมของเก่า)
const initialProducts = [
  { id: 1, sku: 'SA-001', name: 'กระดาษทรายกลม 5 นิ้ว', desc: 'DEERFOS SA331 คุณภาพสูง ทนทาน', cost: 5, retailPrice: 15, stock: 120, cat: 'Abrasives', img: 'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?auto=format&fit=crop&q=80&w=300' },
  { id: 2, sku: 'TW-002', name: 'ใบเจียรเหล็ก 4 นิ้ว', desc: 'หนา 6mm TOA ตัดคม ตัดไว', cost: 10, retailPrice: 25, stock: 85, cat: 'Tools', img: 'https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&q=80&w=300' },
  { id: 3, sku: 'MT-003', name: 'ค้อนหงอนด้ามไฟเบอร์', desc: 'STANLEY 16oz ด้ามจับกันลื่น', cost: 80, retailPrice: 150, stock: 30, cat: 'Hand Tools', img: 'https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&q=80&w=300' },
  { id: 4, sku: 'HT-004', name: 'ประแจเลื่อน 8 นิ้ว', desc: 'KTC ชุบโครเมียมกันสนิม', cost: 120, retailPrice: 220, stock: 45, cat: 'Hand Tools', img: 'https://images.unsplash.com/photo-1585834887376-79ba131a478b?auto=format&fit=crop&q=80&w=300' },
  { id: 5, sku: 'FUR-001', name: 'Ergonomic Chair', desc: 'เก้าอี้เพื่อสุขภาพ ลดอาการปวดหลัง', cost: 3000, retailPrice: 4500, stock: 15, cat: 'Furniture', img: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=300' },
  { id: 6, sku: 'IT-002', name: 'Mechanical Keyboard', desc: 'คีย์บอร์ดเกมมิ่ง สวิตช์เงียบ', cost: 1500, retailPrice: 2990, stock: 20, cat: 'Electronics', img: 'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&q=80&w=300' },
];

// Mock Data: ระดับตัวแทน
const currentAgentTier = 'Tier B';
const discountRates = { 'Tier A': 0.10, 'Tier B': 0.15, 'Retail': 0 };

const Ecommerce: React.FC = () => {
  const [products] = useState(initialProducts);

  // คำนวณราคาหลังจากหักส่วนลด (ซ่อนต้นทุน)
  const getNetPrice = (price: number) => {
    const discount = discountRates[currentAgentTier as keyof typeof discountRates] || 0;
    return price - (price * discount);
  };

  return (
    <div className="animate-fade-in p-6">
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Store className="w-8 h-8 text-primary" />
            E-Commerce Catalog
          </h1>
          <p className="text-muted mt-1">Manage your storefront and product listings for agents</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2">
          <Plus size={18} /> Add New Product
        </button>
      </div>
      
      {/* Agent Tier Banner (จาก Lumo) */}
      <div className="glass-card mb-8 flex items-center gap-4" style={{ background: 'rgba(99, 102, 241, 0.1)', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
        <div style={{ background: 'rgba(99, 102, 241, 0.2)', padding: '0.75rem', borderRadius: '50%' }}>
          <CreditCard className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="text-gray-300 m-0">สถานะตัวแทนจำหน่ายของคุณ</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-white">{currentAgentTier}</span>
            <span className="text-primary font-medium px-2 py-0.5 rounded text-sm" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
              ได้รับส่วนลด {discountRates[currentAgentTier as keyof typeof discountRates] * 100}%
            </span>
          </div>
        </div>
      </div>

      {/* Search Bar (รักษาของเก่าไว้) */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Search products (Auto-suggest)..." 
          className="glass-card" 
          style={{ flex: 1, padding: '1rem', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '1rem', background: 'rgba(25, 28, 41, 0.5)' }} 
        />
        <button className="btn btn-secondary flex items-center gap-2"><Search size={18} /> Filters</button>
      </div>

      {/* Products Grid (ผสมผสานดีไซน์ใหม่ + เก่า) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {products.map((product) => (
          <div key={product.id} className="glass-card group hover:border-primary transition-all duration-300" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Image */}
            <div style={{ position: 'relative', height: '200px', width: '100%', backgroundColor: '#1e293b' }}>
              <img src={product.img} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: '0.85' }} className="group-hover:opacity-100 transition-opacity" />
              <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(4px)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }}>
                {product.sku}
              </div>
            </div>

            <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="flex justify-between items-start">
                <span className="badge badge-primary">{product.cat}</span>
                <span className="text-xs text-gray-400">คลัง: {product.stock}</span>
              </div>
              
              <div>
                <h3 className="text-lg font-bold text-white mb-1 line-clamp-1">{product.name}</h3>
                <p className="text-sm text-muted line-clamp-2 m-0">{product.desc}</p>
              </div>
              
              {/* Pricing section */}
              <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-xs text-gray-500" style={{ textDecoration: 'line-through', marginBottom: '2px' }}>ราคาปกติ: ฿{product.retailPrice.toLocaleString()}</p>
                <div className="flex items-center gap-1.5">
                  <Tag className="w-5 h-5 text-success" />
                  <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>฿{getNetPrice(product.retailPrice).toLocaleString()}</p>
                </div>
              </div>
              
              <button className="btn btn-secondary mt-2 w-full flex items-center justify-center gap-2">
                <ShoppingBag size={16} /> Edit Product
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Ecommerce;
