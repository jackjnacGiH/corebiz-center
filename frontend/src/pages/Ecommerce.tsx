import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Filter,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  sku: string;
  brand: string;
  unit: string;
  leadTime: string;
  imageTone: string;
}

interface CartItem extends Product {
  qty: number;
}

const catalogData: Product[] = [
  {
    id: '1',
    name: 'Flap Disc Zirconia 4 inch #80',
    price: 38,
    category: 'Abrasives',
    stock: 1420,
    sku: 'ABR-FD-4080',
    brand: 'J NAC',
    unit: 'pcs',
    leadTime: 'พร้อมส่ง',
    imageTone: 'tone-steel',
  },
  {
    id: '2',
    name: 'Cutting Wheel Stainless 4 inch',
    price: 22,
    category: 'Cutting',
    stock: 860,
    sku: 'CUT-SUS-4010',
    brand: 'PFERD',
    unit: 'pcs',
    leadTime: 'พร้อมส่ง',
    imageTone: 'tone-graphite',
  },
  {
    id: '3',
    name: 'U-Tools Air Die Grinder 6 mm',
    price: 1850,
    category: 'Pneumatic Tools',
    stock: 32,
    sku: 'UTO-ADG-600',
    brand: 'U-Tools',
    unit: 'set',
    leadTime: '2-3 วัน',
    imageTone: 'tone-blue',
  },
  {
    id: '4',
    name: 'Mounted Point A36 10 x 20 mm',
    price: 44,
    category: 'Grinding',
    stock: 210,
    sku: 'GRD-MPA-1020',
    brand: 'Norton',
    unit: 'pcs',
    leadTime: 'พร้อมส่ง',
    imageTone: 'tone-copper',
  },
  {
    id: '5',
    name: 'Non-Woven Wheel 6 inch Medium',
    price: 245,
    category: 'Polishing',
    stock: 78,
    sku: 'POL-NWW-600M',
    brand: '3M',
    unit: 'pcs',
    leadTime: 'พร้อมส่ง',
    imageTone: 'tone-green',
  },
  {
    id: '6',
    name: 'Safety Glove Heat Resistant',
    price: 120,
    category: 'Safety',
    stock: 12,
    sku: 'SAF-GLV-HR01',
    brand: 'J NAC',
    unit: 'pair',
    leadTime: 'เหลือน้อย',
    imageTone: 'tone-amber',
  },
  {
    id: '7',
    name: 'Sandpaper Roll Alox #120',
    price: 590,
    category: 'Abrasives',
    stock: 54,
    sku: 'ABR-SPR-120',
    brand: 'Klingspor',
    unit: 'roll',
    leadTime: 'พร้อมส่ง',
    imageTone: 'tone-sand',
  },
  {
    id: '8',
    name: 'Diamond Blade Concrete 7 inch',
    price: 680,
    category: 'Cutting',
    stock: 25,
    sku: 'CUT-DIA-700C',
    brand: 'Bosch',
    unit: 'pcs',
    leadTime: '2-3 วัน',
    imageTone: 'tone-red',
  },
];

const categories = ['All', 'Abrasives', 'Cutting', 'Grinding', 'Polishing', 'Pneumatic Tools', 'Safety'];

function getStockTone(stock: number) {
  if (stock < 20) return { label: 'Low stock', className: 'status-warning' };
  if (stock < 60) return { label: 'Watch', className: 'status-info' };
  return { label: 'Ready', className: 'status-success' };
}

export default function Ecommerce() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCartOpen, setIsCartOpen] = useState(false);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return catalogData.filter((product) => {
      const matchSearch =
        !normalizedSearch ||
        product.name.toLowerCase().includes(normalizedSearch) ||
        product.sku.toLowerCase().includes(normalizedSearch) ||
        product.brand.toLowerCase().includes(normalizedSearch);
      const matchCategory = selectedCategory === 'All' || product.category === selectedCategory;

      return matchSearch && matchCategory;
    });
  }, [search, selectedCategory]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const exists = prev.find((item) => item.id === product.id);
      if (exists) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item,
        );
      }

      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((item) => item.id !== id));

  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(id);
      return;
    }

    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, qty } : item)));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const lowStockCount = catalogData.filter((item) => item.stock < 20).length;
  const inventoryValue = catalogData.reduce((sum, item) => sum + item.price * item.stock, 0);

  return (
    <div className="commerce-page">
      <section className="commerce-hero">
        <div>
          <div className="eyebrow">B2B Commerce Workspace</div>
          <h1>Industrial Product Catalog</h1>
          <p>
            Manage product availability, quote baskets, and sales-ready catalog items for
            abrasive, cutting, grinding, and pneumatic tool customers.
          </p>
        </div>

        <button
          onClick={() => setIsCartOpen(true)}
          className="commerce-cart-button"
          title="Open quote cart"
        >
          <ShoppingCart size={18} />
          Quote Cart
          <span>{cartCount}</span>
        </button>
      </section>

      <section className="commerce-metrics" aria-label="Commerce overview">
        <div className="metric-tile">
          <Package size={18} />
          <div>
            <span>Products</span>
            <strong>{catalogData.length}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <BarChart3 size={18} />
          <div>
            <span>Inventory value</span>
            <strong>฿{inventoryValue.toLocaleString()}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <ShoppingCart size={18} />
          <div>
            <span>Quote items</span>
            <strong>{cartCount}</strong>
          </div>
        </div>
        <div className="metric-tile warning">
          <AlertTriangle size={18} />
          <div>
            <span>Low stock</span>
            <strong>{lowStockCount}</strong>
          </div>
        </div>
      </section>

      <section className="commerce-toolbar">
        <div className="commerce-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search product name, SKU, or brand"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="commerce-filter-group" aria-label="Product categories">
          <Filter size={16} />
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={selectedCategory === category ? 'active' : ''}
            >
              {category}
            </button>
          ))}
        </div>

        <button className="commerce-secondary-action" title="More filters">
          <SlidersHorizontal size={17} />
          Filters
        </button>
      </section>

      <section className="commerce-list-header">
        <div>
          <h2>Product shelf</h2>
          <p>{filteredProducts.length} items matched</p>
        </div>
        <div className="list-view-toggle" aria-label="View mode">
          <button className="active">Grid</button>
          <button>Table</button>
        </div>
      </section>

      <section className="commerce-product-grid">
        {filteredProducts.map((item) => {
          const stockTone = getStockTone(item.stock);

          return (
            <article key={item.id} className="commerce-product-card">
              <div className={`product-visual ${item.imageTone}`}>
                <Package size={34} />
                <span>{item.category}</span>
              </div>

              <div className="product-card-body">
                <div className="product-card-meta">
                  <span>{item.brand}</span>
                  <span>{item.sku}</span>
                </div>

                <h3>{item.name}</h3>

                <div className="product-card-details">
                  <span className={stockTone.className}>
                    <CheckCircle2 size={13} />
                    {stockTone.label}
                  </span>
                  <span>{item.leadTime}</span>
                </div>

                <div className="product-card-footer">
                  <div>
                    <strong>฿{item.price.toLocaleString()}</strong>
                    <span>
                      {item.stock.toLocaleString()} {item.unit} available
                    </span>
                  </div>
                  <button onClick={() => addToCart(item)} title={`Add ${item.name} to quote`}>
                    <Plus size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {filteredProducts.length === 0 && (
        <div className="commerce-empty-state">
          <Package size={42} />
          <strong>No products found</strong>
          <span>Try another SKU, brand, or category.</span>
        </div>
      )}

      {isCartOpen && (
        <div className="cart-overlay">
          <button
            type="button"
            className="cart-backdrop"
            aria-label="Close quote cart"
            onClick={() => setIsCartOpen(false)}
          />

          <aside className="cart-content" aria-label="Quote cart">
            <div className="cart-drawer-header">
              <div>
                <span>Quote basket</span>
                <h2>{cartCount} selected items</h2>
              </div>
              <button onClick={() => setIsCartOpen(false)} title="Close cart">
                <X size={20} />
              </button>
            </div>

            <div className="cart-items-container">
              {cart.length === 0 ? (
                <div className="cart-empty">
                  <ShoppingCart size={42} />
                  <strong>Your quote cart is empty</strong>
                  <span>Add products from the catalog to prepare a quotation.</span>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="cart-line-item">
                    <div className={`cart-line-thumb ${item.imageTone}`}>
                      <Package size={20} />
                    </div>

                    <div className="cart-line-info">
                      <strong>{item.name}</strong>
                      <span>
                        {item.sku} · ฿{item.price.toLocaleString()} / {item.unit}
                      </span>
                      <div className="quantity-stepper">
                        <button onClick={() => updateQty(item.id, item.qty - 1)} title="Decrease quantity">
                          <Minus size={14} />
                        </button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.id, item.qty + 1)} title="Increase quantity">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="cart-line-total">
                      <strong>฿{(item.price * item.qty).toLocaleString()}</strong>
                      <button onClick={() => removeFromCart(item.id)} title="Remove item">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="cart-summary">
                <div>
                  <span>Subtotal</span>
                  <strong>฿{cartTotal.toLocaleString()}</strong>
                </div>
                <div>
                  <span>VAT 7%</span>
                  <strong>฿{Math.round(cartTotal * 0.07).toLocaleString()}</strong>
                </div>
                <div className="grand-total">
                  <span>Grand total</span>
                  <strong>฿{Math.round(cartTotal * 1.07).toLocaleString()}</strong>
                </div>
                <button className="checkout-button">Create quotation</button>
                <button className="continue-button" onClick={() => setIsCartOpen(false)}>
                  Continue browsing
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
