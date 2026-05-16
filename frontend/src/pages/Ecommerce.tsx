import { useEffect, useMemo, useState } from 'react';
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
  X,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import {
  productsApi,
  categoriesApi,
  quotesApi,
  quoteRecordApi,
  type ProductWithInventory,
} from '../lib/api';
import type { Category } from '../lib/database.types';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { downloadQuotation } from '../components/QuotationPDF';

type LeadTimeKey = 'ready' | 'twoThreeDays' | 'low';

interface CartItem {
  product: ProductWithInventory;
  qty: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

function deriveLeadTime(qty: number): LeadTimeKey {
  if (qty === 0) return 'low';
  if (qty < 20) return 'twoThreeDays';
  return 'ready';
}

function deriveStockTone(qty: number): { className: string; labelKey: 'ready' | 'watch' | 'low' } {
  if (qty === 0) return { className: 'stock-tone tone-rose', labelKey: 'low' };
  if (qty < 20) return { className: 'stock-tone tone-amber', labelKey: 'watch' };
  return { className: 'stock-tone tone-emerald', labelKey: 'ready' };
}

export default function Ecommerce() {
  const { t } = useLanguage();
  const ecom = t.ecommerce;

  const [products, setProducts] = useState<ProductWithInventory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<'all' | string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [p, c] = await Promise.all([
        productsApi.list(),
        categoriesApi.list(),
      ]);
      setProducts(p.filter(x => x.status === 'active'));
      setCategories(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  // Realtime — refresh when products/inventory change
  useRealtimeTable('products', () => void load());
  useRealtimeTable('inventory', () => void load());

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (selectedCategoryId !== 'all' && p.category_id !== selectedCategoryId) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return p.name_th.toLowerCase().includes(s)
        || (p.name_en?.toLowerCase().includes(s) ?? false)
        || p.sku.toLowerCase().includes(s)
        || (p.brand?.toLowerCase().includes(s) ?? false);
    });
  }, [products, search, selectedCategoryId]);

  const stats = useMemo(() => {
    const inventoryValue = products.reduce((acc, p) => acc + Number(p.price) * p.total_quantity, 0);
    const lowStockCount = products.filter(p => p.total_quantity < 20).length;
    return { inventoryValue, lowStockCount };
  }, [products]);

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartSubtotal = cart.reduce((sum, i) => sum + Number(i.product.price) * i.qty, 0);
  const cartVat = Math.round(cartSubtotal * 0.07);
  const cartTotal = cartSubtotal + cartVat;

  function addToCart(p: ProductWithInventory) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === p.id);
      if (existing) {
        return prev.map(i => i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { product: p, qty: 1 }];
    });
  }

  function updateQty(id: string, qty: number) {
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.product.id !== id));
      return;
    }
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, qty } : i));
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(i => i.product.id !== id));
  }

  async function handleCreateQuote() {
    if (cart.length === 0) return;
    setSaving(true);
    setErr(null);
    setSavedCode(null);
    try {
      const result = await quotesApi.createWithItems({
        items: cart.map(i => ({
          product_id: i.product.id,
          sku: i.product.sku,
          product_name: i.product.name_th,
          quantity: i.qty,
          unit_price: Number(i.product.price),
        })),
      });
      setSavedCode(result.code);
      setSavedQuoteId(result.id);
      setCart([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="commerce-page">
      <section className="commerce-hero">
        <div>
          <div className="eyebrow">{ecom.eyebrow}</div>
          <h1>{ecom.title}</h1>
          <p>{ecom.description}</p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => load()}
            className="commerce-secondary-action"
            title="Reload"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setIsCartOpen(true)}
            className="commerce-cart-button"
            title={ecom.openQuoteCart}
          >
            <ShoppingCart size={18} />
            {ecom.quoteCart}
            <span>{formatNumber(cartCount)}</span>
          </button>
        </div>
      </section>

      {savedCode && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200 flex items-center justify-between">
          <span>
            <CheckCircle2 size={16} className="inline mr-2" />
            สร้างใบเสนอราคา <strong>{savedCode}</strong> สำเร็จ
          </span>
          <div className="flex items-center gap-2">
            {savedQuoteId && (
              <button
                onClick={async () => {
                  try {
                    const { quote, items } = await quoteRecordApi.getWithItems(savedQuoteId);
                    await downloadQuotation({
                      code: quote.code,
                      customer_name: quote.customer?.name,
                      customer_tax_id: quote.customer?.tax_id ?? null,
                      created_at: quote.created_at,
                      valid_until: quote.valid_until,
                      items: items.map(it => ({
                        sku: it.sku,
                        product_name: it.product_name,
                        quantity: it.quantity,
                        unit_price: Number(it.unit_price),
                        total: Number(it.total),
                      })),
                      subtotal: Number(quote.subtotal),
                      discount: Number(quote.discount),
                      vat: Number(quote.vat),
                      total: Number(quote.total),
                      notes: quote.notes,
                      doc_type: 'quotation',
                    });
                  } catch (e) { setErr((e as Error).message); }
                }}
                className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded transition"
              >
                ดาวน์โหลด PDF
              </button>
            )}
            <button onClick={() => { setSavedCode(null); setSavedQuoteId(null); }} className="text-emerald-300 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <section className="commerce-metrics" aria-label={ecom.overview}>
        <div className="metric-tile">
          <Package size={18} />
          <div>
            <span>{ecom.products}</span>
            <strong>{formatNumber(products.length)}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <BarChart3 size={18} />
          <div>
            <span>{ecom.inventoryValue}</span>
            <strong>{formatCurrency(stats.inventoryValue)}</strong>
          </div>
        </div>
        <div className="metric-tile">
          <ShoppingCart size={18} />
          <div>
            <span>{ecom.quoteItems}</span>
            <strong>{formatNumber(cartCount)}</strong>
          </div>
        </div>
        <div className="metric-tile warning">
          <AlertTriangle size={18} />
          <div>
            <span>{ecom.lowStock}</span>
            <strong>{formatNumber(stats.lowStockCount)}</strong>
          </div>
        </div>
      </section>

      <section className="commerce-toolbar">
        <div className="commerce-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={ecom.searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="commerce-filter-group" aria-label={ecom.categoriesLabel}>
          <Filter size={16} />
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={selectedCategoryId === 'all' ? 'active' : ''}
          >
            {ecom.categories.all}
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategoryId(c.id)}
              className={selectedCategoryId === c.id ? 'active' : ''}
            >
              {c.name_th}
            </button>
          ))}
        </div>

        <button className="commerce-secondary-action" title={ecom.moreFilters}>
          <SlidersHorizontal size={17} />
          {ecom.filters}
        </button>
      </section>

      <section className="commerce-list-header">
        <div>
          <h2>{ecom.productShelf}</h2>
          <p>
            {formatNumber(filteredProducts.length)} {ecom.itemsMatched}
          </p>
        </div>
        <div className="list-view-toggle" aria-label={ecom.viewMode}>
          <button className="active">{ecom.grid}</button>
          <button>{ecom.table}</button>
        </div>
      </section>

      {loading && (
        <div className="commerce-empty-state">
          <Package size={42} className="animate-pulse" />
          <strong>{t.common.loading}</strong>
        </div>
      )}

      <section className="commerce-product-grid">
        {!loading && filteredProducts.map(p => {
          const stockTone = deriveStockTone(p.total_quantity);
          const leadTime = deriveLeadTime(p.total_quantity);
          return (
            <article key={p.id} className="commerce-product-card">
              {(() => {
                const imgs = Array.isArray(p.images)
                  ? (p.images as unknown[]).filter((x): x is string => typeof x === 'string')
                  : [];
                const hero = imgs[0];
                if (hero) {
                  return (
                    <div
                      className="product-visual"
                      style={{
                        padding: '0.5rem',
                        background: '#ffffff',
                        height: 'auto',
                        aspectRatio: '1 / 1',
                      }}
                    >
                      <img
                        src={hero}
                        alt={p.name_th}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div className="product-visual tone-steel">
                    <Package size={34} />
                    <span>{p.category?.name_th ?? '—'}</span>
                  </div>
                );
              })()}

              <div className="product-card-body">
                <div className="product-card-meta">
                  <span>{p.brand ?? '—'}</span>
                  <span>{p.sku}</span>
                </div>

                <h3>{p.name_th}</h3>

                <div className="product-card-details">
                  <span className={stockTone.className}>
                    <CheckCircle2 size={13} />
                    {ecom.stock[stockTone.labelKey]}
                  </span>
                  <span>{ecom.leadTimes[leadTime]}</span>
                </div>

                <div className="product-card-footer">
                  <div>
                    <strong>{formatCurrency(Number(p.price))}</strong>
                    <span>
                      {formatNumber(p.total_quantity)} {p.unit}{' '}
                      {ecom.available}
                    </span>
                  </div>
                  <button
                    onClick={() => addToCart(p)}
                    disabled={p.total_quantity === 0}
                    title={`${ecom.addToQuote}: ${p.name_th}`}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {!loading && filteredProducts.length === 0 && (
        <div className="commerce-empty-state">
          <Package size={42} />
          <strong>{ecom.noProducts}</strong>
          <span>{ecom.noProductsHint}</span>
        </div>
      )}

      {isCartOpen && (
        <div className="cart-overlay">
          <button
            type="button"
            className="cart-backdrop"
            aria-label={ecom.closeQuoteCart}
            onClick={() => setIsCartOpen(false)}
          />

          <aside className="cart-content" aria-label={ecom.quoteCart}>
            <div className="cart-drawer-header">
              <div>
                <span>{ecom.quoteBasket}</span>
                <h2>{formatNumber(cartCount)} {ecom.selectedItems}</h2>
              </div>
              <button onClick={() => setIsCartOpen(false)} title={ecom.closeCart}>
                <X size={20} />
              </button>
            </div>

            <div className="cart-items-container">
              {cart.length === 0 ? (
                <div className="cart-empty">
                  <ShoppingCart size={42} />
                  <strong>{ecom.emptyCart}</strong>
                  <span>{ecom.emptyCartHint}</span>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.product.id} className="cart-line-item">
                    <div className="cart-line-thumb tone-steel">
                      <Package size={20} />
                    </div>

                    <div className="cart-line-info">
                      <strong>{item.product.name_th}</strong>
                      <span>
                        {item.product.sku} / {formatCurrency(Number(item.product.price))} / {item.product.unit}
                      </span>
                      <div className="quantity-stepper">
                        <button
                          onClick={() => updateQty(item.product.id, item.qty - 1)}
                          title={ecom.decreaseQuantity}
                        >
                          <Minus size={14} />
                        </button>
                        <span>{formatNumber(item.qty)}</span>
                        <button
                          onClick={() => updateQty(item.product.id, item.qty + 1)}
                          title={ecom.increaseQuantity}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="cart-line-total">
                      <strong>{formatCurrency(Number(item.product.price) * item.qty)}</strong>
                      <button onClick={() => removeFromCart(item.product.id)} title={ecom.removeItem}>
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
                  <span>{ecom.subtotal}</span>
                  <strong>{formatCurrency(cartSubtotal)}</strong>
                </div>
                <div>
                  <span>{ecom.vat}</span>
                  <strong>{formatCurrency(cartVat)}</strong>
                </div>
                <div className="grand-total">
                  <span>{ecom.grandTotal}</span>
                  <strong>{formatCurrency(cartTotal)}</strong>
                </div>
                <button
                  className="checkout-button"
                  onClick={handleCreateQuote}
                  disabled={saving}
                >
                  {saving ? 'กำลังบันทึก...' : ecom.createQuotation}
                </button>
                <button className="continue-button" onClick={() => setIsCartOpen(false)}>
                  {ecom.continueBrowsing}
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
