import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  LayoutGrid,
  LayoutList,
  List,
  Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '../i18n';
import {
  productsApi,
  categoriesApi,
  quotesApi,
  quoteRecordApi,
  getEffectivePrice,
  type ProductWithInventory,
} from '../lib/api';
import type { Category } from '../lib/database.types';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { downloadQuotation } from '../components/QuotationPDF';

type LeadTimeKey = 'ready' | 'twoThreeDays' | 'low';

interface CartItem {
  product: ProductWithInventory;
  qty: number;
  /**
   * Made-to-order line: customer placed it knowing the SKU is out of stock
   * (qty <= 0 at order time) and is OK with a longer lead time.
   * Shows a clear badge in cart + carries through to the quote.
   */
  madeToOrder?: boolean;
}

function formatCurrency(value: number): string {
  // 0 decimals when integer, up to 2 decimals when not — so 15 → "฿15"
  // but 14.55 (after a percent discount) → "฿14.55"
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
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

function getHeroImage(p: ProductWithInventory): string | null {
  if (!Array.isArray(p.images)) return null;
  const imgs = (p.images as unknown[]).filter((x): x is string => typeof x === 'string');
  return imgs[0] ?? null;
}

/** Build a short discount badge label, or null if no discount. */
function discountBadge(p: ProductWithInventory): string | null {
  const val = Number(p.discount_value ?? 0);
  if (!val) return null;
  if (p.discount_type === 'percent') return `-${val.toFixed(0)}%`;
  return `-฿${val.toLocaleString('th-TH')}`;
}

// ─── View modes ──────────────────────────────────────────────────────────
// Extensible: add a new entry to VIEW_MODES + a matching render*() function.

type ViewMode = 'grid' | 'compact' | 'list' | 'table';

const VIEW_MODES: ReadonlyArray<{
  value: ViewMode;
  label: string;
  icon: ReactNode;
}> = [
  { value: 'grid',    label: 'Grid',    icon: <LayoutGrid size={14} /> },
  { value: 'compact', label: 'Compact', icon: <LayoutList size={14} /> },
  { value: 'list',    label: 'List',    icon: <List size={14} /> },
  { value: 'table',   label: 'Table',   icon: <Table2 size={14} /> },
];

const VIEW_MODE_STORAGE_KEY = 'corebiz.ecommerce.view';

function readSavedViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === 'grid' || v === 'compact' || v === 'list' || v === 'table') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'grid';
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
  const [viewMode, setViewMode] = useState<ViewMode>(readSavedViewMode);

  // Persist view mode across visits
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* ignore quota errors */
    }
  }, [viewMode]);

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
  const cartListSubtotal = cart.reduce((sum, i) => sum + Number(i.product.price) * i.qty, 0);
  const cartSubtotal = cart.reduce((sum, i) => sum + getEffectivePrice(i.product) * i.qty, 0);
  const cartSavings = cartListSubtotal - cartSubtotal;
  const cartVat = Math.round(cartSubtotal * 0.07);
  const cartTotal = cartSubtotal + cartVat;

  function addToCart(p: ProductWithInventory, opts?: { madeToOrder?: boolean }) {
    const mto = opts?.madeToOrder ?? false;
    setCart(prev => {
      // Treat in-stock and made-to-order as separate cart lines so the
      // badge + the note carried into the quote stay accurate.
      const existing = prev.find(i => i.product.id === p.id && (i.madeToOrder ?? false) === mto);
      if (existing) {
        return prev.map(i =>
          i.product.id === p.id && (i.madeToOrder ?? false) === mto
            ? { ...i, qty: i.qty + 1 }
            : i,
        );
      }
      return [...prev, { product: p, qty: 1, madeToOrder: mto }];
    });
  }

  /**
   * Cart line operations are now index-based instead of id-based: in-stock
   * and made-to-order can co-exist as two separate lines for the same
   * product id, so the id alone is no longer a unique key.
   */
  function updateQty(idx: number, qty: number) {
    if (qty <= 0) {
      setCart(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    setCart(prev => prev.map((line, i) => i === idx ? { ...line, qty } : line));
  }

  function removeFromCart(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleCreateQuote() {
    if (cart.length === 0) return;
    setSaving(true);
    setErr(null);
    setSavedCode(null);
    try {
      // Made-to-order lines get a "[สั่งผลิต]" prefix on the product_name so
      // the marker shows up everywhere the quote is later displayed/printed
      // (admin Quotes page, generated PDFs, etc.) — no DB migration needed
      // for this first cut. We also append an overall note to the quote so
      // the producer-side team has the context.
      const hasMto = cart.some((i) => i.madeToOrder);
      const result = await quotesApi.createWithItems({
        items: cart.map(i => ({
          product_id: i.product.id,
          sku: i.product.sku,
          product_name: i.madeToOrder ? `[สั่งผลิต] ${i.product.name_th}` : i.product.name_th,
          quantity: i.qty,
          unit_price: getEffectivePrice(i.product),
        })),
        notes: hasMto
          ? 'มีรายการสินค้าสั่งผลิต (Made-to-Order) — โปรดยืนยันระยะเวลาผลิตและจัดส่งกับลูกค้าก่อนยืนยันใบเสนอราคา'
          : undefined,
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
        <div
          className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1"
          role="group"
          aria-label={ecom.viewMode}
        >
          {VIEW_MODES.map((m) => {
            const active = viewMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setViewMode(m.value)}
                aria-pressed={active}
                title={m.label}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold transition',
                  active
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {m.icon}
                <span className="hidden md:inline">{m.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {loading && (
        <div className="commerce-empty-state">
          <Package size={42} className="animate-pulse" />
          <strong>{t.common.loading}</strong>
        </div>
      )}

      {!loading && viewMode === 'grid' && (
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-3">
          {filteredProducts.map(p => {
            const stockTone = deriveStockTone(p.total_quantity);
            const leadTime = deriveLeadTime(p.total_quantity);
            const hero = getHeroImage(p);
            const effective = getEffectivePrice(p);
            const hasDiscount = effective < Number(p.price);
            const badge = discountBadge(p);
            return (
              <article key={p.id} className="commerce-product-card relative">
                {badge && (
                  <span className="absolute top-2 right-2 z-10 inline-flex items-center px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-bold shadow-sm">
                    {badge}
                  </span>
                )}
                {hero ? (
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
                ) : (
                  <div className="product-visual tone-steel">
                    <Package size={34} />
                    <span>{p.category?.name_th ?? '—'}</span>
                  </div>
                )}

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
                      {hasDiscount ? (
                        <div>
                          <strong className="text-rose-600 font-bold">{formatCurrency(effective)}</strong>
                          <span className="block text-base line-through text-slate-400 tabular-nums leading-none mt-0.5">
                            {formatCurrency(Number(p.price))}
                          </span>
                          <span>
                            {formatNumber(p.total_quantity)} {p.unit} {ecom.available}
                          </span>
                        </div>
                      ) : (
                        <>
                          <strong>{formatCurrency(Number(p.price))}</strong>
                          <span>
                            {formatNumber(p.total_quantity)} {p.unit}{' '}
                            {ecom.available}
                          </span>
                        </>
                      )}
                    </div>
                    {p.total_quantity <= 0 ? (
                      <button
                        type="button"
                        onClick={() => addToCart(p, { madeToOrder: true })}
                        className="h-9 px-2.5 rounded-md bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 inline-flex items-center gap-1 whitespace-nowrap"
                        title={`สั่งผลิต ${p.name_th} — เพิ่มในตะกร้าแบบสั่งผลิต`}
                      >
                        <Plus size={13} /> สั่งผลิต
                      </button>
                    ) : (
                      <button
                        onClick={() => addToCart(p)}
                        title={`${ecom.addToQuote}: ${p.name_th}`}
                      >
                        <Plus size={17} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* ── Compact: dense grid, smaller thumbs, 7-8 cols ─────────── */}
      {!loading && viewMode === 'compact' && (
        <section className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
          {filteredProducts.map((p) => {
            const stockTone = deriveStockTone(p.total_quantity);
            const hero = getHeroImage(p);
            const effective = getEffectivePrice(p);
            const hasDiscount = effective < Number(p.price);
            const badge = discountBadge(p);
            return (
              <article
                key={p.id}
                className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col hover:border-slate-300 hover:shadow-sm transition relative"
              >
                {badge && (
                  <span className="absolute top-1.5 right-1.5 z-10 inline-flex items-center px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold shadow-sm">
                    {badge}
                  </span>
                )}
                <div className="aspect-square bg-white p-1.5 border-b border-slate-100">
                  {hero ? (
                    <img
                      src={hero}
                      alt={p.name_th}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-slate-300">
                      <Package size={28} />
                    </div>
                  )}
                </div>
                <div className="p-2.5 flex flex-col gap-1 flex-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <span className="truncate">{p.brand ?? '—'}</span>
                    <span className="font-mono">{p.sku}</span>
                  </div>
                  <h3 className="text-[12px] font-semibold text-slate-900 leading-tight line-clamp-2 min-h-[2.2em]">
                    {p.name_th}
                  </h3>
                  <div className="mt-auto flex flex-col gap-0.5">
                    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold', stockTone.className)}>
                      <CheckCircle2 size={10} />
                      {ecom.stock[stockTone.labelKey]}
                    </span>
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      {formatNumber(p.total_quantity)} {p.unit} {ecom.available}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-1">
                    <div className="flex flex-col leading-tight">
                      <strong className={cn('text-base font-bold tabular-nums', hasDiscount ? 'text-rose-600' : 'text-slate-900')}>
                        {formatCurrency(effective)}
                      </strong>
                      {hasDiscount && (
                        <span className="text-xs line-through text-slate-400 tabular-nums leading-tight">
                          {formatCurrency(Number(p.price))}
                        </span>
                      )}
                    </div>
                    {p.total_quantity <= 0 ? (
                      <button
                        type="button"
                        onClick={() => addToCart(p, { madeToOrder: true })}
                        className="h-7 px-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 text-[10px] font-bold inline-flex items-center gap-0.5 whitespace-nowrap"
                        title={`สั่งผลิต ${p.name_th}`}
                      >
                        <Plus size={10} /> สั่งผลิต
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(p)}
                        className="w-7 h-7 grid place-items-center rounded-md bg-indigo-500 text-white hover:bg-indigo-600"
                        title={`${ecom.addToQuote}: ${p.name_th}`}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* ── List: 1 col rows, image-left + full details right ──────── */}
      {!loading && viewMode === 'list' && (
        <section className="flex flex-col gap-2">
          {filteredProducts.map((p) => {
            const stockTone = deriveStockTone(p.total_quantity);
            const leadTime = deriveLeadTime(p.total_quantity);
            const hero = getHeroImage(p);
            const effective = getEffectivePrice(p);
            const hasDiscount = effective < Number(p.price);
            const badge = discountBadge(p);
            return (
              <article
                key={p.id}
                className="flex gap-4 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 hover:shadow-sm transition"
              >
                <div className="w-28 h-28 flex-shrink-0 rounded-md border border-slate-200 bg-white p-1 grid place-items-center overflow-hidden">
                  {hero ? (
                    <img
                      src={hero}
                      alt={p.name_th}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Package size={32} className="text-slate-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {p.brand ?? '—'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{p.sku}</span>
                      {p.category?.name_th && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {p.category.name_th}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 flex-shrink-0">
                      {hasDiscount && (
                        <span className="text-sm line-through text-slate-400 tabular-nums">
                          {formatCurrency(Number(p.price))}
                        </span>
                      )}
                      <strong className={cn('text-lg font-bold tabular-nums', hasDiscount ? 'text-rose-600' : 'text-slate-900')}>
                        {formatCurrency(effective)}
                      </strong>
                      {badge && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-bold">
                          {badge}
                        </span>
                      )}
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                    {p.name_th}
                    {p.name_en && (
                      <span className="font-normal italic text-slate-500 ml-2">{p.name_en}</span>
                    )}
                  </h3>
                  {p.description_th && (
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {p.description_th}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-auto pt-1">
                    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', stockTone.className)}>
                      <CheckCircle2 size={12} />
                      {ecom.stock[stockTone.labelKey]}
                    </span>
                    <span className="text-[11px] text-slate-500">{ecom.leadTimes[leadTime]}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {formatNumber(p.total_quantity)} {p.unit} {ecom.available}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col justify-center gap-1.5">
                  {p.total_quantity <= 0 ? (
                    <button
                      type="button"
                      onClick={() => addToCart(p, { madeToOrder: true })}
                      className="h-9 px-4 rounded-md bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 inline-flex items-center gap-1.5 whitespace-nowrap"
                      title={`สั่งผลิต ${p.name_th}`}
                    >
                      <Plus size={14} /> สั่งผลิต
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      className="h-9 px-4 rounded-md bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 inline-flex items-center gap-1.5"
                      title={`${ecom.addToQuote}: ${p.name_th}`}
                    >
                      <Plus size={14} /> เพิ่ม
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* ── Table: compact rows for scanning ─────────────────────── */}
      {!loading && viewMode === 'table' && (
        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
                <tr>
                  <th className="w-14 px-3 py-3"></th>
                  <th className="px-3 py-3 text-left">SKU</th>
                  <th className="px-3 py-3 text-left">{ecom.productShelf}</th>
                  <th className="px-3 py-3 text-left">Brand</th>
                  <th className="px-3 py-3 text-left">หมวด</th>
                  <th className="px-3 py-3 text-center">สถานะ</th>
                  <th className="px-3 py-3 text-right">ราคา</th>
                  <th className="px-3 py-3 text-right">สต๊อก</th>
                  <th className="w-20 px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const stockTone = deriveStockTone(p.total_quantity);
                  const hero = getHeroImage(p);
                  const effective = getEffectivePrice(p);
                  const hasDiscount = effective < Number(p.price);
                  const badge = discountBadge(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-3 py-2">
                        {hero ? (
                          <img
                            src={hero}
                            alt={p.name_th}
                            loading="lazy"
                            className="w-10 h-10 rounded-md object-contain border border-slate-200 bg-white"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md border border-dashed border-slate-200 bg-slate-50 grid place-items-center text-slate-300">
                            <Package size={16} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-indigo-600 font-semibold">{p.sku}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{p.name_th}</div>
                        {p.name_en && (
                          <div className="text-[11px] italic text-slate-500 mt-0.5">{p.name_en}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{p.brand ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{p.category?.name_th ?? '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', stockTone.className)}>
                          <CheckCircle2 size={11} />
                          {ecom.stock[stockTone.labelKey]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {hasDiscount && (
                          <span className="text-sm line-through text-slate-400 mr-1.5">
                            {formatCurrency(Number(p.price))}
                          </span>
                        )}
                        <strong className={cn('text-base font-bold', hasDiscount ? 'text-rose-600' : 'text-slate-900')}>
                          {formatCurrency(effective)}
                        </strong>
                        {badge && (
                          <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded bg-rose-500 text-white text-[9px] font-bold align-middle">
                            {badge}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatNumber(p.total_quantity)} {p.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.total_quantity <= 0 ? (
                          <button
                            type="button"
                            onClick={() => addToCart(p, { madeToOrder: true })}
                            className="h-7 px-2 rounded-md bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 inline-flex items-center gap-1 ml-auto whitespace-nowrap"
                            title={`สั่งผลิต ${p.name_th}`}
                          >
                            <Plus size={11} /> สั่งผลิต
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToCart(p)}
                            className="h-7 w-7 grid place-items-center rounded-md bg-indigo-500 text-white hover:bg-indigo-600 ml-auto"
                            title={`${ecom.addToQuote}: ${p.name_th}`}
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                cart.map((item, idx) => (
                  <div key={`${item.product.id}-${item.madeToOrder ? 'mto' : 'std'}`} className="cart-line-item">
                    <div className={`cart-line-thumb ${item.madeToOrder ? 'tone-amber' : 'tone-steel'}`}>
                      <Package size={20} />
                    </div>

                    {(() => {
                      const lineList = Number(item.product.price);
                      const lineEff = getEffectivePrice(item.product);
                      const lineHasDisc = lineEff < lineList;
                      const lineBadge = discountBadge(item.product);
                      return (
                        <>
                          <div className="cart-line-info">
                            <strong>
                              {item.product.name_th}
                              {item.madeToOrder && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 border border-orange-200"
                                  title="สินค้านี้ไม่มีในสต็อก จะสั่งผลิตให้"
                                >
                                  สั่งผลิต
                                </span>
                              )}
                            </strong>
                            <span>
                              {item.product.sku} /{' '}
                              {lineHasDisc ? (
                                <>
                                  <span className="text-sm line-through text-slate-400 mr-1 tabular-nums">
                                    {formatCurrency(lineList)}
                                  </span>
                                  <span className="text-rose-600 font-semibold tabular-nums">
                                    {formatCurrency(lineEff)}
                                  </span>
                                  {lineBadge && (
                                    <span className="ml-1 px-1 py-0.5 rounded bg-rose-500 text-white text-[9px] font-bold">
                                      {lineBadge}
                                    </span>
                                  )}
                                </>
                              ) : (
                                formatCurrency(lineEff)
                              )}{' '}
                              / {item.product.unit}
                            </span>
                            {item.madeToOrder && (
                              <span className="block mt-0.5 text-[11px] text-orange-700 font-medium">
                                ⚠️ สินค้าสั่งผลิต — ใช้เวลาเตรียมประมาณ 7-14 วันทำการ
                              </span>
                            )}
                            <div className="quantity-stepper">
                              <button
                                onClick={() => updateQty(idx, item.qty - 1)}
                                title={ecom.decreaseQuantity}
                              >
                                <Minus size={14} />
                              </button>
                              <span>{formatNumber(item.qty)}</span>
                              <button
                                onClick={() => updateQty(idx, item.qty + 1)}
                                title={ecom.increaseQuantity}
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>

                          <div className="cart-line-total">
                            {lineHasDisc && (
                              <span className="text-xs line-through text-slate-400 tabular-nums">
                                {formatCurrency(lineList * item.qty)}
                              </span>
                            )}
                            <strong className={lineHasDisc ? 'text-rose-600' : ''}>
                              {formatCurrency(lineEff * item.qty)}
                            </strong>
                            <button
                              onClick={() => removeFromCart(idx)}
                              title={ecom.removeItem}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="cart-summary">
                {cartSavings > 0 && (
                  <>
                    <div>
                      <span>ราคารวมก่อนลด</span>
                      <strong className="line-through text-slate-400">
                        {formatCurrency(cartListSubtotal)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-rose-600">ส่วนลดรวม</span>
                      <strong className="text-rose-600">
                        − {formatCurrency(cartSavings)}
                      </strong>
                    </div>
                  </>
                )}
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
