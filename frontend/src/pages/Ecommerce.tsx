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
import { useLanguage } from '../i18n';

type CategoryKey =
  | 'all'
  | 'abrasives'
  | 'cutting'
  | 'grinding'
  | 'polishing'
  | 'pneumaticTools'
  | 'safety';
type LeadTimeKey = 'ready' | 'twoThreeDays' | 'low';
type UnitKey = 'pcs' | 'set' | 'pair' | 'roll';

interface Product {
  id: string;
  name: string;
  price: number;
  category: Exclude<CategoryKey, 'all'>;
  stock: number;
  sku: string;
  brand: string;
  unit: UnitKey;
  leadTime: LeadTimeKey;
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
    category: 'abrasives',
    stock: 1420,
    sku: 'ABR-FD-4080',
    brand: 'J NAC',
    unit: 'pcs',
    leadTime: 'ready',
    imageTone: 'tone-steel',
  },
  {
    id: '2',
    name: 'Cutting Wheel Stainless 4 inch',
    price: 22,
    category: 'cutting',
    stock: 860,
    sku: 'CUT-SUS-4010',
    brand: 'PFERD',
    unit: 'pcs',
    leadTime: 'ready',
    imageTone: 'tone-graphite',
  },
  {
    id: '3',
    name: 'U-Tools Air Die Grinder 6 mm',
    price: 1850,
    category: 'pneumaticTools',
    stock: 32,
    sku: 'UTO-ADG-600',
    brand: 'U-Tools',
    unit: 'set',
    leadTime: 'twoThreeDays',
    imageTone: 'tone-blue',
  },
  {
    id: '4',
    name: 'Mounted Point A36 10 x 20 mm',
    price: 44,
    category: 'grinding',
    stock: 210,
    sku: 'GRD-MPA-1020',
    brand: 'Norton',
    unit: 'pcs',
    leadTime: 'ready',
    imageTone: 'tone-copper',
  },
  {
    id: '5',
    name: 'Non-Woven Wheel 6 inch Medium',
    price: 245,
    category: 'polishing',
    stock: 78,
    sku: 'POL-NWW-600M',
    brand: '3M',
    unit: 'pcs',
    leadTime: 'ready',
    imageTone: 'tone-green',
  },
  {
    id: '6',
    name: 'Safety Glove Heat Resistant',
    price: 120,
    category: 'safety',
    stock: 12,
    sku: 'SAF-GLV-HR01',
    brand: 'J NAC',
    unit: 'pair',
    leadTime: 'low',
    imageTone: 'tone-amber',
  },
  {
    id: '7',
    name: 'Sandpaper Roll Alox #120',
    price: 590,
    category: 'abrasives',
    stock: 54,
    sku: 'ABR-SPR-120',
    brand: 'Klingspor',
    unit: 'roll',
    leadTime: 'ready',
    imageTone: 'tone-sand',
  },
  {
    id: '8',
    name: 'Diamond Blade Concrete 7 inch',
    price: 680,
    category: 'cutting',
    stock: 25,
    sku: 'CUT-DIA-700C',
    brand: 'Bosch',
    unit: 'pcs',
    leadTime: 'twoThreeDays',
    imageTone: 'tone-red',
  },
];

const categories: CategoryKey[] = [
  'all',
  'abrasives',
  'cutting',
  'grinding',
  'polishing',
  'pneumaticTools',
  'safety',
];

function getStockTone(stock: number) {
  if (stock < 20) return { labelKey: 'low' as const, className: 'status-warning' };
  if (stock < 60) return { labelKey: 'watch' as const, className: 'status-info' };
  return { labelKey: 'ready' as const, className: 'status-success' };
}

export default function Ecommerce() {
  const { language, t } = useLanguage();
  const ecommerceText = t.ecommerce;
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('all');
  const [isCartOpen, setIsCartOpen] = useState(false);

  const formatNumber = (value: number) => value.toLocaleString(locale);
  const formatCurrency = (value: number) => `฿${formatNumber(value)}`;

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return catalogData.filter((product) => {
      const matchSearch =
        !normalizedSearch ||
        product.name.toLowerCase().includes(normalizedSearch) ||
        product.sku.toLowerCase().includes(normalizedSearch) ||
        product.brand.toLowerCase().includes(normalizedSearch);
      const matchCategory = selectedCategory === 'all' || product.category === selectedCategory;

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
          <div className="eyebrow">{ecommerceText.eyebrow}</div>
          <h1>{ecommerceText.title}</h1>
          <p>{ecommerceText.description}</p>
        </div>

        <button
          onClick={() => setIsCartOpen(true)}
          className="commerce-cart-button"
          title={ecommerceText.openQuoteCart}
        >
          <ShoppingCart size={18} />
          {ecommerceText.quoteCart}
          <span>{formatNumber(cartCount)}</span>
        </button>
      </section>

      <section className="commerce-metrics" aria-label={ecommerceText.overview}>
        <div className="metric-tile">
          <Package size={18} />
          <div>
            <span>{ecommerceText.products}</span>
            <strong>{formatNumber(catalogData.length)}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <BarChart3 size={18} />
          <div>
            <span>{ecommerceText.inventoryValue}</span>
            <strong>{formatCurrency(inventoryValue)}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <ShoppingCart size={18} />
          <div>
            <span>{ecommerceText.quoteItems}</span>
            <strong>{formatNumber(cartCount)}</strong>
          </div>
        </div>
        <div className="metric-tile warning">
          <AlertTriangle size={18} />
          <div>
            <span>{ecommerceText.lowStock}</span>
            <strong>{formatNumber(lowStockCount)}</strong>
          </div>
        </div>
      </section>

      <section className="commerce-toolbar">
        <div className="commerce-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={ecommerceText.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="commerce-filter-group" aria-label={ecommerceText.categoriesLabel}>
          <Filter size={16} />
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={selectedCategory === category ? 'active' : ''}
            >
              {ecommerceText.categories[category]}
            </button>
          ))}
        </div>

        <button className="commerce-secondary-action" title={ecommerceText.moreFilters}>
          <SlidersHorizontal size={17} />
          {ecommerceText.filters}
        </button>
      </section>

      <section className="commerce-list-header">
        <div>
          <h2>{ecommerceText.productShelf}</h2>
          <p>
            {formatNumber(filteredProducts.length)} {ecommerceText.itemsMatched}
          </p>
        </div>
        <div className="list-view-toggle" aria-label={ecommerceText.viewMode}>
          <button className="active">{ecommerceText.grid}</button>
          <button>{ecommerceText.table}</button>
        </div>
      </section>

      <section className="commerce-product-grid">
        {filteredProducts.map((item) => {
          const stockTone = getStockTone(item.stock);

          return (
            <article key={item.id} className="commerce-product-card">
              <div className={`product-visual ${item.imageTone}`}>
                <Package size={34} />
                <span>{ecommerceText.categories[item.category]}</span>
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
                    {ecommerceText.stock[stockTone.labelKey]}
                  </span>
                  <span>{ecommerceText.leadTimes[item.leadTime]}</span>
                </div>

                <div className="product-card-footer">
                  <div>
                    <strong>{formatCurrency(item.price)}</strong>
                    <span>
                      {formatNumber(item.stock)} {ecommerceText.units[item.unit]}{' '}
                      {ecommerceText.available}
                    </span>
                  </div>
                  <button
                    onClick={() => addToCart(item)}
                    title={`${ecommerceText.addToQuote}: ${item.name}`}
                  >
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
          <strong>{ecommerceText.noProducts}</strong>
          <span>{ecommerceText.noProductsHint}</span>
        </div>
      )}

      {isCartOpen && (
        <div className="cart-overlay">
          <button
            type="button"
            className="cart-backdrop"
            aria-label={ecommerceText.closeQuoteCart}
            onClick={() => setIsCartOpen(false)}
          />

          <aside className="cart-content" aria-label={ecommerceText.quoteCart}>
            <div className="cart-drawer-header">
              <div>
                <span>{ecommerceText.quoteBasket}</span>
                <h2>
                  {formatNumber(cartCount)} {ecommerceText.selectedItems}
                </h2>
              </div>
              <button onClick={() => setIsCartOpen(false)} title={ecommerceText.closeCart}>
                <X size={20} />
              </button>
            </div>

            <div className="cart-items-container">
              {cart.length === 0 ? (
                <div className="cart-empty">
                  <ShoppingCart size={42} />
                  <strong>{ecommerceText.emptyCart}</strong>
                  <span>{ecommerceText.emptyCartHint}</span>
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
                        {item.sku} / {formatCurrency(item.price)} / {ecommerceText.units[item.unit]}
                      </span>
                      <div className="quantity-stepper">
                        <button
                          onClick={() => updateQty(item.id, item.qty - 1)}
                          title={ecommerceText.decreaseQuantity}
                        >
                          <Minus size={14} />
                        </button>
                        <span>{formatNumber(item.qty)}</span>
                        <button
                          onClick={() => updateQty(item.id, item.qty + 1)}
                          title={ecommerceText.increaseQuantity}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="cart-line-total">
                      <strong>{formatCurrency(item.price * item.qty)}</strong>
                      <button onClick={() => removeFromCart(item.id)} title={ecommerceText.removeItem}>
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
                  <span>{ecommerceText.subtotal}</span>
                  <strong>{formatCurrency(cartTotal)}</strong>
                </div>
                <div>
                  <span>{ecommerceText.vat}</span>
                  <strong>{formatCurrency(Math.round(cartTotal * 0.07))}</strong>
                </div>
                <div className="grand-total">
                  <span>{ecommerceText.grandTotal}</span>
                  <strong>{formatCurrency(Math.round(cartTotal * 1.07))}</strong>
                </div>
                <button className="checkout-button">{ecommerceText.createQuotation}</button>
                <button className="continue-button" onClick={() => setIsCartOpen(false)}>
                  {ecommerceText.continueBrowsing}
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
