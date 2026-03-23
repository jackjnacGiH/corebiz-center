import React, { useState } from 'react';
import { ShoppingBag, Search, Plus, Tag, Store, CreditCard, LayoutGrid, List } from 'lucide-react';

// Mock Data: จำลองข้อมูลสินค้า (จาก Lumo + รวมของเก่า)
const initialProducts = [
  { id: 1, sku: 'SA-001', name: 'กระดาษทรายกลม 5 นิ้ว', desc: 'DEERFOS SA331 คุณภาพสูง ทนทาน', cost: 5, retailPrice: 15, stock: 120, cat: 'Abrasives', img: 'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?auto=format&fit=crop&q=80&w=300' },
  { id: 2, sku: 'TW-002', name: 'ใบเจียรเหล็ก 4 นิ้ว', desc: 'หนา 6mm TOA ตัดคม ตัดไว', cost: 10, retailPrice: 25, stock: 85, cat: 'Tools', img: 'https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&q=80&w=300' },
  { id: 3, sku: 'JN-003', name: 'ล้อทรายมีแกน 6mm', desc: 'งานลบคม CNC', cost: 20, retailPrice: 45, stock: 30, cat: 'Abrasives', img: 'https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&q=80&w=300' },
  { id: 4, sku: 'HT-004', name: 'ประแจเลื่อน 8 นิ้ว', desc: 'KTC ชุบโครเมียมกันสนิม', cost: 120, retailPrice: 220, stock: 45, cat: 'Hand Tools', img: 'https://images.unsplash.com/photo-1585834887376-79ba131a478b?auto=format&fit=crop&q=80&w=300' },
  { id: 5, sku: 'FUR-001', name: 'Ergonomic Chair', desc: 'เก้าอี้เพื่อสุขภาพ ลดอาการปวดหลัง', cost: 3000, retailPrice: 4500, stock: 15, cat: 'Furniture', img: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=300' },
  { id: 6, sku: 'IT-002', name: 'Mechanical Keyboard', desc: 'คีย์บอร์ดเกมมิ่ง สวิตช์เงียบ', cost: 1500, retailPrice: 2990, stock: 20, cat: 'Electronics', img: 'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&q=80&w=300' },
];

// Mock Data: ระดับตัวแทน
const currentAgentTier = 'Tier B';
const discountRates = { 'Tier A': 0.10, 'Tier B': 0.15, 'Retail': 0 };

const Ecommerce: React.FC = () => {
  const [products] = useState(initialProducts);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // เพิ่ม state viewMode ตามที่ Lumo ขอ

  // คำนวณราคาหลังจากหักส่วนลด (ซ่อนต้นทุน)
  const getNetPrice = (price: number) => {
    const discount = discountRates[currentAgentTier as keyof typeof discountRates] || 0;
    return price - (price * discount);
  };

  return (
    <div className="animate-fade-in p-6">
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }} className="flex-col md:flex-row gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Store className="w-8 h-8 text-primary" />
            E-Commerce Catalog
          </h1>
          <p className="text-muted mt-1">Manage your storefront and product listings for agents</p>
        </div>
        
        <div className="flex items-center gap-3 bg-gray-800/50 p-1.5 rounded-lg border border-gray-700/50">
          <button 
            onClick={() => setViewMode('grid')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-primary text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          >
            <LayoutGrid size={16} /> Grid
          </button>
          <button 
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-primary text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          >
            <List size={16} /> List
          </button>
          <div className="w-px h-6 bg-gray-700 mx-1"></div>
          <button className="btn btn-primary flex items-center gap-2 px-4 py-1.5">
            <Plus size={16} /> <span className="hidden sm:inline">Add Product</span>
          </button>
        </div>
      </div>
      
      {/* Agent Tier Banner */}
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

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Search products (Auto-suggest)..." 
          className="glass-card" 
          style={{ flex: 1, padding: '1rem', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '1rem', background: 'rgba(25, 28, 41, 0.5)' }} 
        />
        <button className="btn btn-secondary flex items-center gap-2"><Search size={18} /> Filters</button>
      </div>

      {/* Product Display (Grid or List based on state) */}
      <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" : "flex flex-col gap-4"}>
        {products.map((product) => (
          <div key={product.id} className={`glass-card group hover:border-primary transition-all duration-300 ${viewMode === 'list' ? 'flex flex-row items-center p-4' : 'flex flex-col p-0 overflow-hidden'}`}>
            
            {/* Image */}
            <div style={{ 
              position: 'relative', 
              backgroundColor: '#1e293b',
              width: viewMode === 'list' ? '120px' : '100%',
              height: viewMode === 'list' ? '120px' : '200px',
              flexShrink: 0,
              borderRadius: viewMode === 'list' ? '8px' : '0',
              overflow: 'hidden'
            }}>
              <img src={product.img} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: '0.85' }} className="group-hover:opacity-100 transition-opacity" />
              {viewMode === 'grid' && (
                <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(4px)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {product.sku}
                </div>
              )}
            </div>

            {/* Content Body */}
            <div className={`flex-1 display-flex flex-col ${viewMode === 'list' ? 'pl-6 pr-4 py-2' : 'p-6 gap-3'}`}>
              
              <div className="flex justify-between items-start mb-1">
                {viewMode === 'list' && <span className="text-xs text-gray-400 font-mono">SKU: {product.sku}</span>}
                <span className={`badge badge-primary ${viewMode === 'list' ? 'ml-auto' : ''}`}>{product.cat}</span>
                {viewMode === 'grid' && <span className="text-xs text-gray-400">คลัง: {product.stock}</span>}
              </div>
              
              <div className={viewMode === 'list' ? 'mb-2' : ''}>
                <h3 className="text-lg font-bold text-white mb-1 line-clamp-1">{product.name}</h3>
                <p className="text-sm text-muted line-clamp-2 m-0">{product.desc}</p>
              </div>

              {/* List mode stock indicator */}
              {viewMode === 'list' && (
                <div className="text-xs text-gray-400 mt-2">
                  คลังสินค้า: <span className="text-gray-200">{product.stock} ชิ้น</span>
                </div>
              )}
              
              {/* Pricing section (Grid mode) */}
              {viewMode === 'grid' && (
                <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-xs text-gray-500" style={{ textDecoration: 'line-through', marginBottom: '2px' }}>ราคาปกติ: ฿{product.retailPrice.toLocaleString()}</p>
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-5 h-5 text-success" />
                    <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>฿{getNetPrice(product.retailPrice).toLocaleString()}</p>
                  </div>
                  <button className="btn btn-secondary mt-4 w-full flex items-center justify-center gap-2">
                    <ShoppingBag size={16} /> Edit Product
                  </button>
                </div>
              )}
            </div>

            {/* Pricing section (List mode) */}
            {viewMode === 'list' && (
              <div className="pl-6 border-l border-gray-700/50 flex flex-col justify-center items-end min-w-[200px]">
                <p className="text-xs text-gray-500" style={{ textDecoration: 'line-through', marginBottom: '4px' }}>ราคาปกติ: ฿{product.retailPrice.toLocaleString()}</p>
                <div className="flex items-center gap-1.5 mb-4">
                  <Tag className="w-5 h-5 text-success" />
                  <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>฿{getNetPrice(product.retailPrice).toLocaleString()}</p>
                </div>
                <button className="btn btn-secondary w-full flex items-center justify-center gap-2 text-sm py-1.5">
                  <ShoppingBag size={14} /> Edit
                </button>
              </div>
            )}
            
          </div>
        ))}
      </div>
    </div>
  );
};

export default Ecommerce;
