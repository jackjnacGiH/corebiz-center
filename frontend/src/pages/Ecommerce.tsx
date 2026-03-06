import React from 'react';
import { ShoppingBag, Search, ShoppingCart } from 'lucide-react';

const Ecommerce: React.FC = () => {
    const products = [
        { name: 'Ergonomic Chair', price: '฿4,500', cat: 'Furniture', img: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=300' },
        { name: 'Mechanical Keyboard', price: '฿2,990', cat: 'Electronics', img: 'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&q=80&w=300' },
        { name: 'Wireless Headphones', price: '฿8,900', cat: 'Audio', img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=300' },
        { name: 'Smart Watch', price: '฿12,000', cat: 'Wearables', img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=300' },
    ];

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">E-Commerce & Catalog</h1>
                    <p className="text-muted">Manage your storefront and product listings</p>
                </div>
                <button className="btn btn-primary"><ShoppingBag size={18} /> Add New Product</button>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <input type="text" placeholder="Search products (Auto-suggest)..." className="glass-card" style={{ flex: 1, padding: '1rem', border: '1px solid var(--panel-border)', color: '#fff', fontSize: '1rem' }} />
                <button className="btn btn-secondary"><Search size={18} /> Filters</button>
            </div>

            <div className="grid grid-cols-4 gap-6">
                {products.map((p, i) => (
                    <div key={i} className="glass-card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <img src={p.img} alt={p.name} style={{ width: '100%', height: '200px', objectFit: 'cover' }} />
                        <div style={{ padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <span className="badge badge-primary" style={{ width: 'max-content' }}>{p.cat}</span>
                            <h3 className="text-lg font-bold">{p.name}</h3>
                            <div className="text-xl font-bold text-secondary">{p.price}</div>
                            <button className="btn btn-secondary mt-4" style={{ width: '100%' }}>
                                <ShoppingCart size={16} /> Edit Product
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Ecommerce;
