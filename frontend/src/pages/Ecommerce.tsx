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
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingCart size={28} color="var(--primary)" />
            E-Commerce Catalog
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.9rem' }}>
            รายการสินค้าสำหรับองค์กร — {catalogData.length} รายการ
          </p>
        </div>

        {/* Cart Button */}
        <button
          onClick={() => setIsCartOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
            color: '#fff', border: 'none', borderRadius: '10px',
            padding: '0.75rem 1.25rem', cursor: 'pointer', fontWeight: 600,
            fontSize: '0.95rem', transition: 'var(--transition)',
            boxShadow: '0 4px 15px var(--primary-glow)'
          }}
        >
          <ShoppingCart size={18} />
          ตะกร้าสินค้า
          {cartCount > 0 && (
            <span style={{
              background: 'rgba(255,255,255,0.2)', borderRadius: '20px',
              padding: '0.1rem 0.6rem', fontSize: '0.8rem', fontWeight: 700
            }}>{cartCount}</span>
          )}
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        {[
          { icon: <Package size={18} />, label: 'สินค้าทั้งหมด', value: catalogData.length, color: 'var(--primary)' },
          { icon: <Tag size={18} />, label: 'หมวดหมู่', value: categories.length - 1, color: 'var(--accent)' },
          { icon: <TrendingUp size={18} />, label: 'สินค้าในตะกร้า', value: cartCount, color: 'var(--secondary)' },
          { icon: <AlertCircle size={18} />, label: 'สต๊อกต่ำ', value: catalogData.filter(p => p.stock < 20).length, color: 'var(--warning)' },
        ].map((stat, i) => (
          <div key={i} className="glass-card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: '10px', background: `${stat.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.color }}>
              {stat.icon}
            </div>
            <div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>{stat.value}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(30,33,48,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '0.65rem 1rem' }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="ค้นหาสินค้า หรือ รหัส SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.9rem', width: '100%' }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Filter size={15} color="var(--text-muted)" />
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                padding: '0.4rem 0.9rem', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: 600, transition: 'var(--transition)',
                background: selectedCategory === cat ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                color: selectedCategory === cat ? '#fff' : 'var(--text-muted)',
              }}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
        {filteredProducts.map(item => (
          <div key={item.id} className="glass-card" style={{ padding: 0, overflow: 'hidden', cursor: 'default' }}>
            {/* Product Image Area */}
            <div style={{
              height: 140, background: `linear-gradient(135deg, rgba(99,102,241,0.1), rgba(236,72,153,0.05))`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.04)', position: 'relative'
            }}>
              {item.image}
              {item.stock < 20 && (
                <span style={{
                  position: 'absolute', top: 10, right: 10, background: 'var(--warning)',
                  color: '#000', fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                  borderRadius: '20px'
                }}>สต๊อกต่ำ</span>
              )}
            </div>

            {/* Product Info */}
            <div style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                {item.category} · {item.sku}
              </div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                {item.name}
              </h4>

              {/* Rating */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.75rem' }}>
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={11} fill={i < Math.floor(item.rating) ? '#f59e0b' : 'none'} color={i < Math.floor(item.rating) ? '#f59e0b' : '#475569'} />
                ))}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.rating}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    ฿{item.price.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: item.stock < 20 ? 'var(--warning)' : 'var(--success)' }}>
                    คงเหลือ {item.stock.toLocaleString()} ชิ้น
                  </div>
                </div>
                <button
                  onClick={() => addToCart(item)}
                  style={{
                    width: 36, height: 36, borderRadius: '8px', border: 'none', cursor: 'pointer',
                    background: 'var(--primary)', color: '#fff', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', transition: 'var(--transition)',
                  }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--secondary)')}
                  onMouseOut={e => (e.currentTarget.style.background = 'var(--primary)')}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <Package size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
          <p>ไม่พบสินค้าที่ค้นหา</p>
        </div>
      )}

      {/* Cart Drawer */}
      {isCartOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setIsCartOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 420,
            background: 'rgba(15,17,26,0.98)', borderLeft: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', flexDirection: 'column', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)'
          }}>
            {/* Cart Header */}
            <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <ShoppingCart size={20} color="var(--primary)" />
                <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>ตะกร้าสินค้า</span>
                <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '20px', padding: '0.1rem 0.6rem', fontSize: '0.8rem', fontWeight: 700 }}>{cartCount}</span>
              </div>
              <button onClick={() => setIsCartOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.25rem' }}>
                <X size={20} />
              </button>
            </div>

            {/* Cart Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  <ShoppingCart size={40} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                  <p>ตะกร้าว่างเปล่า</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {cart.map(item => (
                    <div key={item.id} style={{ background: 'rgba(30,33,48,0.8)', borderRadius: '10px', padding: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.875rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: '1.8rem', flexShrink: 0 }}>{item.image}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.sku}</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', marginTop: '0.25rem' }}>฿{(item.price * item.qty).toLocaleString()}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <button onClick={() => updateQty(item.id, item.qty - 1)} style={{ width: 26, height: 26, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}>-</button>
                        <span style={{ width: 24, textAlign: 'center', fontSize: '0.9rem', fontWeight: 600 }}>{item.qty}</span>
                        <button onClick={() => updateQty(item.id, item.qty + 1)} style={{ width: 26, height: 26, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}>+</button>
                        <button onClick={() => removeFromCart(item.id)} style={{ marginLeft: '0.25rem', background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {cart.length > 0 && (
              <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  <span>รายการ ({cartCount} ชิ้น)</span>
                  <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>฿{cartTotal.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem', fontSize: '1.1rem', fontWeight: 700 }}>
                  <span>ยอดรวมทั้งหมด</span>
                  <span style={{ color: 'var(--primary)' }}>฿{cartTotal.toLocaleString()}</span>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.9rem' }}>
                  สั่งซื้อสินค้า
                </button>
                <button onClick={() => setIsCartOpen(false)} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
                  เลือกสินค้าต่อ
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
