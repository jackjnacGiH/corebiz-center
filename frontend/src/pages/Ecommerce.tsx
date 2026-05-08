import { useState } from 'react';
import { ShoppingCart, Package, Search, Filter, Star, Plus, X, Tag, TrendingUp, AlertCircle } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  rating: number;
  sku: string;
  image: string;
}

interface CartItem extends Product {
  qty: number;
}

const catalogData: Product[] = [
  { id: '1', name: 'กระดาษทรายกลมสักหลาด 5"', price: 15, category: 'Abrasives', stock: 1500, rating: 4.5, sku: 'ABR-001', image: '🔵' },
  { id: '2', name: 'ใบเจียรเหล็ก 4"', price: 25, category: 'Abrasives', stock: 850, rating: 4.8, sku: 'ABR-002', image: '⚙️' },
  { id: '3', name: 'สว่านไฟฟ้า 12V', price: 1290, category: 'Power Tools', stock: 45, rating: 4.7, sku: 'PWR-001', image: '🔧' },
  { id: '4', name: 'ประแจปากตาย 8mm', price: 89, category: 'Hand Tools', stock: 320, rating: 4.3, sku: 'HND-001', image: '🔩' },
  { id: '5', name: 'หมวกนิรภัย PPE Class A', price: 249, category: 'Safety', stock: 200, rating: 4.6, sku: 'SAF-001', image: '⛑️' },
  { id: '6', name: 'ถุงมือหนังทนความร้อน', price: 120, category: 'Safety', stock: 12, rating: 4.4, sku: 'SAF-002', image: '🧤' },
  { id: '7', name: 'กาวอีพ็อกซี่ 2 หน้า', price: 180, category: 'Adhesives', stock: 75, rating: 4.2, sku: 'ADH-001', image: '🧪' },
  { id: '8', name: 'ใบเลื่อยวงเดือน 7.25"', price: 320, category: 'Cutting', stock: 60, rating: 4.9, sku: 'CUT-001', image: '🪚' },
];

const categories = ['All', 'Abrasives', 'Power Tools', 'Hand Tools', 'Safety', 'Adhesives', 'Cutting'];

export default function Ecommerce() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCartOpen, setIsCartOpen] = useState(false);

  const filteredProducts = catalogData.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const addToCart = (product: Product) => {
    setCart(prev => {
      const exists = prev.find(c => c.id === product.id);
      if (exists) return prev.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));
  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) return removeFromCart(id);
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty } : c));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="animate-fade-in ecommerce-container">

      {/* Page Header */}
      <div className="ecommerce-header">
        <div className="ecommerce-title-container">
          <h1>
            <ShoppingCart size={28} color="var(--primary)" />
            E-Commerce Catalog
          </h1>
          <p className="ecommerce-subtitle">
            รายการสินค้าสำหรับองค์กร — {catalogData.length} รายการ
          </p>
        </div>

        {/* Cart Button */}
        <button
          onClick={() => setIsCartOpen(true)}
          className="cart-button"
          title="ดูตะกร้าสินค้า"
        >
          <ShoppingCart size={18} />
          ตะกร้าสินค้า
          {cartCount > 0 && (
            <span className="cart-badge">{cartCount}</span>
          )}
        </button>
      </div>

      {/* Stats Bar */}
      <div className="stats-grid">
        {[
          { icon: <Package size={18} />, label: 'สินค้าทั้งหมด', value: catalogData.length, type: 'primary' },
          { icon: <Tag size={18} />, label: 'หมวดหมู่', value: categories.length - 1, type: 'accent' },
          { icon: <TrendingUp size={18} />, label: 'สินค้าในตะกร้า', value: cartCount, type: 'secondary' },
          { icon: <AlertCircle size={18} />, label: 'สต๊อกต่ำ', value: catalogData.filter(p => p.stock < 20).length, type: 'warning' },
        ].map((stat, i) => (
          <div key={i} className="glass-card stat-card">
            <div className={`stat-icon-wrapper stat-icon-${stat.type}`}>
              {stat.icon}
            </div>
            <div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        {/* Search */}
        <div className="search-input-wrapper">
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="ค้นหาสินค้า หรือ รหัส SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-input"
          />
        </div>

        {/* Category Filter */}
        <div className="category-filters">
          <Filter size={15} color="var(--text-muted)" />
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      <div className="product-grid">
        {filteredProducts.map(item => (
          <div key={item.id} className="glass-card product-card">
            {/* Product Image Area */}
            <div className="product-image-area">
              {item.image}
              {item.stock < 20 && (
                <span className="stock-warning-badge">สต๊อกต่ำ</span>
              )}
            </div>

            {/* Product Info */}
            <div className="product-info">
              <div className="product-meta">
                {item.category} · {item.sku}
              </div>
              <h4 className="product-name">
                {item.name}
              </h4>

              {/* Rating */}
              <div className="rating-container">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={11} fill={i < Math.floor(item.rating) ? '#f59e0b' : 'none'} color={i < Math.floor(item.rating) ? '#f59e0b' : '#475569'} />
                ))}
                <span className="rating-value">{item.rating}</span>
              </div>

              <div className="product-footer">
                <div>
                  <div className="product-price">
                    ฿{item.price.toLocaleString()}
                  </div>
                  <div className={`product-stock ${item.stock < 20 ? 'text-warning' : 'text-success'}`}>
                    คงเหลือ {item.stock.toLocaleString()} ชิ้น
                  </div>
                </div>
                <button
                  onClick={() => addToCart(item)}
                  className="add-to-cart-btn"
                  title="ใส่ตะกร้า"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="empty-state">
          <Package size={48} />
          <p>ไม่พบสินค้าที่ค้นหา</p>
        </div>
      )}

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="cart-overlay">
          <div className="cart-backdrop" onClick={() => setIsCartOpen(false)} />
          <div className="cart-content">
            {/* Cart Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-gradient-to-br from-indigo-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <ShoppingCart size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-white leading-tight">ตะกร้าสินค้า</h2>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black mt-0.5">Order Summary · {cartCount} รายการ</p>
                </div>
              </div>
              <button 
                onClick={() => setIsCartOpen(false)} 
                title="ปิดตะกร้าสินค้า"
                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-white transition-all border border-white/5"
              >
                <X size={20} />
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 py-20">
                  <ShoppingCart size={64} className="mb-4" />
                  <p className="text-lg font-bold">ตะกร้าว่างเปล่า</p>
                  <p className="text-xs uppercase tracking-widest mt-1">ยังไม่มีรายการสินค้า</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cart.map(item => (
                    <div key={item.id} className="glass-card hover:bg-white/[0.04] transition-colors p-3 border border-white/5 flex gap-4 group">
                      <div className="w-16 h-16 rounded-xl bg-slate-950 flex items-center justify-center text-2xl shadow-inner flex-shrink-0 border border-white/5">
                        {item.image}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="text-sm font-bold text-white truncate">{item.name}</div>
                          <div className="text-[10px] text-slate-500 font-black uppercase tracking-wider">{item.sku}</div>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="text-sm font-black text-indigo-400">฿{(item.price * item.qty).toLocaleString()}</div>
                          <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-white/5">
                            <button 
                              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-md transition-all font-bold" 
                              onClick={() => updateQty(item.id, item.qty - 1)} 
                              title="ลดจำนวน"
                            >-</button>
                            <span className="min-w-[24px] text-center text-xs font-black text-white">{item.qty}</span>
                            <button 
                              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-indigo-400 hover:bg-white/5 rounded-md transition-all font-bold" 
                              onClick={() => updateQty(item.id, item.qty + 1)} 
                              title="เพิ่มจำนวน"
                            >+</button>
                          </div>
                        </div>
                      </div>
                      <button 
                        className="self-start p-1.5 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all" 
                        onClick={() => removeFromCart(item.id)} 
                        title="ลบออกจากตะกร้า"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {cart.length > 0 && (
              <div className="p-8 border-t border-white/5 bg-slate-900/80 backdrop-blur-xl">
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between items-center text-sm font-bold">
                    <span className="text-slate-400">รายการรวม ({cartCount})</span>
                    <span className="text-white">฿{cartTotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold">
                    <span className="text-slate-400">ภาษีมูลค่าเพิ่ม (7%)</span>
                    <span className="text-white">฿{(cartTotal * 0.07).toLocaleString()}</span>
                  </div>
                  <div className="pt-3 border-t border-white/5 flex justify-between items-center">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">ยอดชำระสุทธิ (Grand Total)</span>
                    <span className="text-2xl font-black text-emerald-400 tracking-tighter">฿{(cartTotal * 1.07).toLocaleString()}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <button className="w-full py-4 rounded-xl bg-indigo-500 text-white font-black hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-500/30 uppercase tracking-[0.2em] text-[10px]">
                    ยืนยันการทำรายการ
                  </button>
                  <button 
                    onClick={() => setIsCartOpen(false)} 
                    className="w-full py-3 rounded-xl border border-white/5 bg-white/5 text-slate-400 font-bold hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest text-[10px]"
                  >
                    เลือกซื้อสินค้าต่อ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
