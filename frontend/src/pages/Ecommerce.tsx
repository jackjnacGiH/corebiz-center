import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
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
  ChevronDown,
  Boxes,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '../i18n';
import {
  productsApi,
  categoriesApi,
  quotesApi,
  quoteRecordApi,
  customersApi,
  tierApi,
  getEffectivePrice,
  type ProductWithInventory,
  type CustomerBenefit,
} from '../lib/api';
import type { Category, Customer } from '../lib/database.types';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { downloadQuotation } from '../components/QuotationPDF';
import ProductImagePreview from '../components/ProductImagePreview';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

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

function getImages(p: ProductWithInventory): string[] {
  if (!Array.isArray(p.images)) return [];
  return (p.images as unknown[]).filter((x): x is string => typeof x === 'string');
}

function getHeroImage(p: ProductWithInventory): string | null {
  return getImages(p)[0] ?? null;
}

/**
 * Product thumbnail used in the List + Table views: shows the hero image with
 * a hover-zoom preview (same as the Inventory page). If the image fails to
 * load — e.g. the file was removed from storage so the URL now 404s — it
 * falls back to the given placeholder instead of the browser's broken-image
 * box (which showed the truncated alt text). No hover is offered for a
 * broken/absent image.
 */
function ProductThumb({
  hero,
  images,
  alt,
  imgClassName,
  placeholder,
}: {
  hero: string | null;
  images: string[];
  alt: string;
  imgClassName: string;
  placeholder: ReactNode;
}) {
  const [errored, setErrored] = useState(false);
  if (!hero || errored) return <>{placeholder}</>;
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <img
          src={hero}
          alt={alt}
          loading="lazy"
          className={imgClassName}
          onError={() => setErrored(true)}
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-auto p-0 border-slate-200 shadow-xl rounded-lg overflow-hidden"
      >
        <ProductImagePreview images={images} alt={alt} />
      </HoverCardContent>
    </HoverCard>
  );
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
  // On a phone-sized screen, default to Grid (large thumbs, 2-col) so the
  // first impression isn't a wall of tiny tiles. Desktop keeps the previous
  // default. Width threshold matches Tailwind's `md` breakpoint.
  if (typeof window !== 'undefined' && window.innerWidth < 768) return 'grid';
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
  // Refs for the add-to-cart fly animation: the cart button is the target,
  // the trigger element gives us the source bounding rect.
  const cartBtnRef = useRef<HTMLButtonElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  // Quote-for customer (links the quote → unlocks CRM: RFM, follow-up, points…)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quoteCustomer, setQuoteCustomer] = useState<Customer | null>(null);
  const [quoteBenefit, setQuoteBenefit] = useState<CustomerBenefit | null>(null);
  const [applyTierDiscount, setApplyTierDiscount] = useState(true);
  const [custPickerOpen, setCustPickerOpen] = useState(false);
  const [custQuery, setCustQuery] = useState('');
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
      const [p, c, cust] = await Promise.all([
        productsApi.list(),
        categoriesApi.list(),
        customersApi.list().catch(() => [] as Customer[]),
      ]);
      setProducts(p.filter(x => x.status === 'active'));
      setCategories(c);
      setCustomers(cust);
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
  useRealtimeTable('product_groups', () => void load());

  /**
   * Set of group ids that are currently expanded. Persisted in memory only
   * — refreshing the page collapses everything back to the parent-card view
   * (Boss Jack's design: default state shows only group cards, customer
   * clicks [+] to drill in).
   */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredProducts = useMemo(() => {
    // Tokenized AND search: split the query on any whitespace and require every
    // token to appear somewhere in the product's searchable text. This is robust
    // to extra/irregular spacing in the stored names (e.g. some SKUs have a
    // double space "3 mm.  Size :"), word order, and punctuation spacing — so a
    // pasted full name like "ล้อทรายมีแกน 3 mm. Size : 15x13.5x3mm" still matches.
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    return products.filter(p => {
      if (selectedCategoryId !== 'all' && p.category_id !== selectedCategoryId) return false;
      if (tokens.length === 0) return true;
      const hay = `${p.name_th} ${p.name_en ?? ''} ${p.sku} ${p.brand ?? ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [products, search, selectedCategoryId]);

  /**
   * Group filteredProducts by group_id for the customer-facing display.
   *
   * Display contract:
   *   - Default (no search)            → render groups as parent cards +
   *     ungrouped SKUs as their own cards. Groups stay collapsed by
   *     default; the user opens them via the [+] toggle.
   *   - Category filter active         → STILL group. Boss Jack's spec:
   *     "นำหลักการแสดง View ไปใช้กับ ทุกหมวดหมู่สินค้า". Members of a
   *     group that don't match the category get filtered out at the
   *     `filteredProducts` step above, so the group only shows the
   *     subset that fits the chosen category.
   *   - Search active                  → bypass grouping entirely; show
   *     every matching SKU as a flat card list. (Boss Jack: "ค้นด้วย
   *     MIRKA #80 ควรเจอเป็น SKU แบบ flat ข้ามกลุ่ม")
   */
  const groupedDisplay = useMemo(() => {
    if (search.trim()) {
      return { mode: 'flat' as const, products: filteredProducts };
    }
    const groupsMap = new Map<string, {
      group: NonNullable<ProductWithInventory['group']>;
      members: ProductWithInventory[];
    }>();
    const ungrouped: ProductWithInventory[] = [];
    for (const p of filteredProducts) {
      if (p.group) {
        const existing = groupsMap.get(p.group.id);
        if (existing) existing.members.push(p);
        else groupsMap.set(p.group.id, { group: p.group, members: [p] });
      } else {
        ungrouped.push(p);
      }
    }
    return {
      mode: 'grouped' as const,
      groups: Array.from(groupsMap.values()).sort((a, b) =>
        a.group.name.localeCompare(b.group.name, 'th'),
      ),
      ungrouped,
    };
  }, [filteredProducts, search, selectedCategoryId]);

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

  // Bump the cart button whenever the count grows. Watching cart length
  // wouldn't be enough — adding more of the same SKU doesn't grow the array.
  const prevCartCountRef = useRef(cartCount);
  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      const el = cartBtnRef.current;
      if (el) {
        el.classList.remove('cart-bump');
        // Force a reflow so re-adding the class actually restarts the
        // animation; otherwise React skips the no-op className change.
        void el.offsetWidth;
        el.classList.add('cart-bump');
      }
    }
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

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
   * Plays a "fly to cart" animation: a small copy of the product image (or a
   * coloured circle if there's no hero image) travels from where the +
   * button was clicked to the cart button in the header. Pure DOM mutation,
   * no React state — the element lives < 700ms and gets garbage-collected
   * the moment it lands.
   */
  function flyToCart(
    evt: ReactMouseEvent<HTMLButtonElement>,
    p: ProductWithInventory,
    mto: boolean,
  ) {
    const cartEl = cartBtnRef.current;
    if (!cartEl) return;
    const sourceEl = evt.currentTarget;
    if (!sourceEl) return;
    const sRect = sourceEl.getBoundingClientRect();
    const tRect = cartEl.getBoundingClientRect();
    const heroUrl = getHeroImage(p);

    const flyer = document.createElement('div');
    flyer.className = `fly-to-cart ${mto ? 'fly-to-cart-mto' : ''}`;
    // Centre it on the click source.
    flyer.style.left = `${sRect.left + sRect.width / 2 - 22}px`;
    flyer.style.top  = `${sRect.top + sRect.height / 2 - 22}px`;

    if (heroUrl) {
      const img = document.createElement('img');
      img.src = heroUrl;
      img.alt = '';
      flyer.appendChild(img);
    } else {
      flyer.textContent = '+';
    }

    document.body.appendChild(flyer);

    // Next frame: snap the transform to the cart-button centre and fade out.
    // The transition runs on transform + opacity for GPU-accelerated motion.
    requestAnimationFrame(() => {
      const dx = tRect.left + tRect.width / 2 - (sRect.left + sRect.width / 2);
      const dy = tRect.top  + tRect.height / 2 - (sRect.top  + sRect.height / 2);
      flyer.style.transform = `translate(${dx}px, ${dy}px) scale(0.15) rotate(20deg)`;
      flyer.style.opacity = '0';
    });

    window.setTimeout(() => flyer.remove(), 700);
  }

  /** Combined helper bound to every + / + สั่งผลิต button. */
  function handleAddClick(
    evt: ReactMouseEvent<HTMLButtonElement>,
    p: ProductWithInventory,
    mto: boolean,
  ) {
    flyToCart(evt, p, mto);
    addToCart(p, { madeToOrder: mto });
  }

  /**
   * Compact-style product tile. Defined at component scope (not inside the
   * Compact view's IIFE) so the Grid view's expansion panel can reuse it
   * to render the SKU children at a smaller size than the outer Grid cards.
   * Boss Jack's spec: "รูปสินค้า expand inline ขนาดให้เล็กลง"
   */
  const renderCompactCard = (p: ProductWithInventory) => {
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
                onClick={(e) => handleAddClick(e, p, true)}
                className="h-7 px-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 text-[10px] font-bold inline-flex items-center gap-0.5 whitespace-nowrap"
                title={`สั่งผลิต ${p.name_th}`}
              >
                <Plus size={10} /> สั่งผลิต
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => handleAddClick(e, p, false)}
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
  };

  /**
   * Member tile for the expanded group panel (Grid + Compact views). Sized
   * close to `renderCompactCard` so each SKU reads clearly; the surrounding
   * sub-grid caps at 7-8 columns so extra SKUs wrap onto new rows instead of
   * shrinking into a single tight row. Boss Jack's spec: "แสดงแค่ 7-8 รายการ
   * ถ้าเกินให้เพิ่มแถว + ปรับขนาดรายการสินค้าให้ใหญ่ขึ้น".
   *
   * What's dropped vs renderCompactCard to keep it lean:
   *   - "Brand" header dropped (rarely useful when SKUs share a brand
   *     within a group anyway)
   *   - Stock label dropped, only the count + unit remains
   *   - Footer is a single row: price + [+] / สั่งผลิต button
   *   - Discount line-through becomes a small line under the price
   *   - Full product name still wraps — never truncated (Boss Jack:
   *     "ห้ามตัดคำ ถ้าชื่อยาว ให้เพิ่มบรรทัดได้")
   */
  const renderMiniCard = (p: ProductWithInventory) => {
    const stockTone = deriveStockTone(p.total_quantity);
    const hero = getHeroImage(p);
    const effective = getEffectivePrice(p);
    const hasDiscount = effective < Number(p.price);
    const badge = discountBadge(p);
    return (
      <article
        key={p.id}
        className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col hover:border-indigo-300 hover:shadow-sm transition relative text-[11px]"
      >
        {badge && (
          <span className="absolute top-1 right-1 z-10 inline-flex items-center px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold shadow-sm">
            {badge}
          </span>
        )}
        <div className="aspect-square bg-white p-2 border-b border-slate-100">
          {hero ? (
            <img
              src={hero}
              alt={p.name_th}
              loading="lazy"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-slate-300">
              <Package size={26} />
            </div>
          )}
        </div>
        <div className="p-2 flex flex-col gap-1 flex-1">
          <span className="text-[10px] font-mono text-slate-400 truncate leading-tight">
            {p.sku}
          </span>
          {/* Full product name — no truncation. Wraps to as many lines as
              needed. CSS grid auto-sizes each row to the tallest card so
              short / long names sit nicely side-by-side. Boss Jack's spec:
              "ห้ามตัดคำ ถ้าชื่อยาว ให้เพิ่มบรรทัดได้". */}
          <h3 className="text-[12px] font-semibold text-slate-900 leading-tight break-words">
            {p.name_th}
          </h3>
          <span
            className={cn(
              'text-[10px] tabular-nums leading-tight truncate',
              stockTone.className,
            )}
          >
            {formatNumber(p.total_quantity)} {p.unit}
          </span>
          <div className="mt-auto flex items-center justify-between gap-1.5 pt-1">
            <div className="flex flex-col leading-none">
              <strong
                className={cn(
                  'text-sm font-bold tabular-nums',
                  hasDiscount ? 'text-rose-600' : 'text-slate-900',
                )}
              >
                {formatCurrency(effective)}
              </strong>
              {hasDiscount && (
                <span className="text-[10px] line-through text-slate-400 tabular-nums leading-tight">
                  {formatCurrency(Number(p.price))}
                </span>
              )}
            </div>
            {p.total_quantity <= 0 ? (
              <button
                type="button"
                onClick={(e) => handleAddClick(e, p, true)}
                className="h-7 px-2 rounded-md bg-orange-500 text-white text-[10px] font-bold inline-flex items-center gap-0.5 whitespace-nowrap"
                title={`สั่งผลิต ${p.name_th}`}
              >
                <Plus size={11} /> สั่งผลิต
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => handleAddClick(e, p, false)}
                className="w-7 h-7 grid place-items-center rounded-md bg-indigo-500 text-white hover:bg-indigo-600 flex-shrink-0"
                title={`${ecom.addToQuote}: ${p.name_th}`}
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

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

  async function pickQuoteCustomer(c: Customer | null) {
    setQuoteCustomer(c);
    setQuoteBenefit(null);
    setCustPickerOpen(false);
    setCustQuery('');
    setApplyTierDiscount(true);
    if (c) {
      try { setQuoteBenefit(await tierApi.customerBenefit(c.id)); } catch { /* ignore */ }
    }
  }

  const filteredQuoteCustomers = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers.filter(c =>
      c.name?.toLowerCase().includes(q)
      || c.code?.toLowerCase().includes(q)
      || c.phone?.includes(q),
    ).slice(0, 30);
  }, [customers, custQuery]);

  // Member discount % that will be applied to the quote (0 when none / unticked)
  const tierDiscPct = (applyTierDiscount && quoteBenefit) ? Number(quoteBenefit.discount_percent) || 0 : 0;

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
      //
      // A line counts as MTO if the customer explicitly added it that way OR
      // they dialed the qty past the available stock (same logic the cart
      // badge uses, so the quote stays consistent with what they saw).
      const isLineMto = (i: typeof cart[number]) =>
        !!i.madeToOrder || i.qty > i.product.total_quantity;
      const hasMto = cart.some(isLineMto);
      const noteParts: string[] = [];
      if (hasMto) noteParts.push('มีรายการสินค้าสั่งผลิต (Made-to-Order) — โปรดยืนยันระยะเวลาผลิตและจัดส่งกับลูกค้าก่อนยืนยันใบเสนอราคา');
      if (tierDiscPct > 0 && quoteBenefit) noteParts.push(`ใส่ส่วนลดสมาชิกระดับ ${quoteBenefit.tier_label} ${tierDiscPct}% แล้ว`);
      const result = await quotesApi.createWithItems({
        customer_id: quoteCustomer?.id ?? null,
        items: cart.map(i => {
          const unit = getEffectivePrice(i.product);
          // Member (tier) discount applies on top of the product's list price.
          const tierDisc = tierDiscPct > 0 ? Math.round(unit * i.qty * tierDiscPct) / 100 : 0;
          return {
            product_id: i.product.id,
            sku: i.product.sku,
            product_name: isLineMto(i) ? `[สั่งผลิต] ${i.product.name_th}` : i.product.name_th,
            quantity: i.qty,
            unit_price: unit,
            discount: tierDisc,
          };
        }),
        notes: noteParts.length > 0 ? noteParts.join(' · ') : undefined,
      });
      setSavedCode(result.code);
      setSavedQuoteId(result.id);
      setCart([]);
      void pickQuoteCustomer(null);
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
            ref={cartBtnRef}
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
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center justify-between">
          <span>
            <CheckCircle2 size={16} className="inline mr-2 text-emerald-600" />
            สร้างใบเสนอราคา <strong className="text-emerald-900">{savedCode}</strong> สำเร็จ
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

      {!loading && viewMode === 'grid' && (() => {
        // Render a single product card — closure over the page's
        // handleAddClick + i18n. Used in both flat + grouped sections.
        const renderGridCard = (p: ProductWithInventory) => {
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
                        onClick={(e) => handleAddClick(e, p, true)}
                        className="btn-mto"
                        title={`สั่งผลิต ${p.name_th} — เพิ่มในตะกร้าแบบสั่งผลิต`}
                      >
                        <Plus size={13} /> สั่งผลิต
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleAddClick(e, p, false)}
                        title={`${ecom.addToQuote}: ${p.name_th}`}
                      >
                        <Plus size={17} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          };

        const gridSectionCls =
          'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-3';

        // Search / category filter → flat list (skip grouping)
        if (groupedDisplay.mode === 'flat') {
          return (
            <section className={gridSectionCls}>
              {filteredProducts.map(renderGridCard)}
            </section>
          );
        }

        // Default → group cards + ungrouped cards share one grid. When a
        // group is open we DON'T render its closed card; instead we render
        // a col-span-full row that puts the group identity on the LEFT and
        // member SKUs on the RIGHT (Boss Jack's spec: "ไปทางขวามือ").
        //
        // The right-side member grid uses Compact-style tiles so the SKUs
        // come out noticeably smaller than the outer Grid cards (Boss
        // Jack: "รูปสินค้า expand inline ขนาดให้เล็กลง"). Many SKUs in one
        // group wrap to multiple rows naturally.
        //
        // grid-flow-row-dense lets ungrouped + closed-group cards backfill
        // the row that the open group started on.
        return (
          <section className={`${gridSectionCls} grid-flow-row-dense`}>
            {groupedDisplay.groups.flatMap(({ group, members }) => {
              const isOpen = expandedGroups.has(group.id);
              if (isOpen) {
                return [
                  <div key={`exp-${group.id}`} className="col-span-full">
                    <SideBySideGroupExpansion
                      group={group}
                      members={members}
                      onClose={() => toggleGroup(group.id)}
                      // Larger member tiles, capped at 7-8 cols so extra SKUs
                      // wrap to new rows instead of cramming into one.
                      memberGridCls="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2.5"
                      renderMember={renderMiniCard}
                    />
                  </div>,
                ];
              }
              return [
                <GroupGridCard
                  key={group.id}
                  group={group}
                  count={members.length}
                  isOpen={false}
                  onToggle={() => toggleGroup(group.id)}
                />,
              ];
            })}
            {groupedDisplay.ungrouped.map(renderGridCard)}
          </section>
        );
      })()}

      {/* ── Compact: dense grid, smaller thumbs, 7-8 cols ─────────── */}
      {!loading && viewMode === 'compact' && (() => {
        // renderCompactCard is defined at component scope (above) so the
        // Grid view's expansion can reuse it for smaller member tiles.

        const compactSectionCls =
          'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2';

        if (groupedDisplay.mode === 'flat') {
          return <section className={compactSectionCls}>{filteredProducts.map(renderCompactCard)}</section>;
        }
        // Same side-by-side pattern as Grid: open group's row puts the
        // group identity on the LEFT, member SKUs (also compact tiles)
        // on the RIGHT — more columns since cards are already small.
        return (
          <section className={`${compactSectionCls} grid-flow-row-dense`}>
            {groupedDisplay.groups.flatMap(({ group, members }) => {
              const isOpen = expandedGroups.has(group.id);
              if (isOpen) {
                return [
                  <div key={`exp-${group.id}`} className="col-span-full">
                    <SideBySideGroupExpansion
                      group={group}
                      members={members}
                      onClose={() => toggleGroup(group.id)}
                      // Larger member tiles, capped at 7-8 cols so extra SKUs
                      // wrap to new rows instead of cramming into one.
                      memberGridCls="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2.5"
                      renderMember={renderMiniCard}
                    />
                  </div>,
                ];
              }
              return [
                <GroupCompactCard
                  key={group.id}
                  group={group}
                  count={members.length}
                  isOpen={false}
                  onToggle={() => toggleGroup(group.id)}
                />,
              ];
            })}
            {groupedDisplay.ungrouped.map(renderCompactCard)}
          </section>
        );
      })()}

      {/* ── List: 1 col rows, image-left + full details right ──────── */}
      {!loading && viewMode === 'list' && (() => {
        // The `compact` flag swaps to a smaller thumb + tighter padding —
        // used inside expanded group panels so the parent GroupBanner
        // stays the visually-dominant tile and the SKU children read as
        // sub-rows. (Boss Jack's request: สลับขนาดรูปกลุ่ม↔SKU)
        const renderListCard = (p: ProductWithInventory, compact = false) => {
            const stockTone = deriveStockTone(p.total_quantity);
            const leadTime = deriveLeadTime(p.total_quantity);
            const hero = getHeroImage(p);
            const effective = getEffectivePrice(p);
            const hasDiscount = effective < Number(p.price);
            const badge = discountBadge(p);
            return (
              <article
                key={p.id}
                className={cn(
                  'flex rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition',
                  compact ? 'gap-3 p-2' : 'gap-4 p-3',
                )}
              >
                <div
                  className={cn(
                    'flex-shrink-0 rounded-md border border-slate-200 bg-white p-1 grid place-items-center overflow-hidden',
                    compact ? 'w-16 h-16' : 'w-28 h-28',
                  )}
                >
                  <ProductThumb
                    hero={hero}
                    images={getImages(p)}
                    alt={p.name_th}
                    imgClassName="w-full h-full object-contain cursor-zoom-in"
                    placeholder={<Package size={compact ? 20 : 32} className="text-slate-300" />}
                  />
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
                      onClick={(e) => handleAddClick(e, p, true)}
                      className="h-9 px-4 rounded-md bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 inline-flex items-center gap-1.5 whitespace-nowrap"
                      title={`สั่งผลิต ${p.name_th}`}
                    >
                      <Plus size={14} /> สั่งผลิต
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleAddClick(e, p, false)}
                      className="h-9 px-4 rounded-md bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 inline-flex items-center gap-1.5"
                      title={`${ecom.addToQuote}: ${p.name_th}`}
                    >
                      <Plus size={14} /> เพิ่ม
                    </button>
                  )}
                </div>
              </article>
            );
          };

        const listSectionCls = 'flex flex-col gap-2';
        const listCompactSectionCls = 'flex flex-col gap-1.5';

        if (groupedDisplay.mode === 'flat') {
          return <section className={listSectionCls}>{filteredProducts.map((p) => renderListCard(p, false))}</section>;
        }
        return (
          <div className="space-y-4">
            {groupedDisplay.groups.map(({ group, members }) => {
              const isOpen = expandedGroups.has(group.id);
              return (
                <div key={group.id}>
                  <GroupBanner group={group} count={members.length} isOpen={isOpen} onToggle={() => toggleGroup(group.id)} />
                  {isOpen && (
                    // Children render in compact mode so the parent banner
                    // stays the dominant tile and SKUs read as sub-rows.
                    <section className={`${listCompactSectionCls} mt-3 ml-4 pl-3 border-l-2 border-indigo-100`}>
                      {members.map((p) => renderListCard(p, true))}
                    </section>
                  )}
                </div>
              );
            })}
            {groupedDisplay.ungrouped.length > 0 && (
              <section className={listSectionCls}>
                {groupedDisplay.ungrouped.map((p) => renderListCard(p, false))}
              </section>
            )}
          </div>
        );
      })()}

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
                        <ProductThumb
                          hero={hero}
                          images={getImages(p)}
                          alt={p.name_th}
                          imgClassName="w-10 h-10 rounded-md object-contain border border-slate-200 bg-white cursor-zoom-in"
                          placeholder={
                            <div className="w-10 h-10 rounded-md border border-dashed border-slate-200 bg-slate-50 grid place-items-center text-slate-300">
                              <Package size={16} />
                            </div>
                          }
                        />
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
                            onClick={(e) => handleAddClick(e, p, true)}
                            className="h-7 px-2 rounded-md bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 inline-flex items-center gap-1 ml-auto whitespace-nowrap"
                            title={`สั่งผลิต ${p.name_th}`}
                          >
                            <Plus size={11} /> สั่งผลิต
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleAddClick(e, p, false)}
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
                cart.map((item, idx) => {
                  const thumbUrl = getHeroImage(item.product);
                  // Derived MTO state — true if the line was explicitly added
                  // from a sold-out product OR the customer dialed the qty
                  // past available stock. Used for badge, warning, thumb tone,
                  // and the quote-save prefix in handleCreateQuote().
                  const stock = item.product.total_quantity;
                  const isMto = !!item.madeToOrder || item.qty > stock;
                  const exceedsStock = !item.madeToOrder && item.qty > stock;
                  return (
                  <div key={`${item.product.id}-${item.madeToOrder ? 'mto' : 'std'}`} className="cart-line-item">
                    <div className={`cart-line-thumb ${isMto ? 'tone-amber' : 'tone-steel'}`}>
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={item.product.name_th}
                          className="w-full h-full object-contain rounded-md"
                          loading="lazy"
                        />
                      ) : (
                        <Package size={20} />
                      )}
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
                              {isMto && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 border border-orange-200"
                                  title={
                                    item.madeToOrder
                                      ? 'สินค้านี้ไม่มีในสต็อก จะสั่งผลิตให้'
                                      : `จำนวนที่สั่ง (${item.qty}) มากกว่าสต็อกคงเหลือ (${stock}) — เปลี่ยนเป็นสั่งผลิตอัตโนมัติ`
                                  }
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
                            <span
                              className={`block mt-0.5 text-[11px] tabular-nums font-medium ${
                                stock <= 0
                                  ? 'text-orange-700'
                                  : exceedsStock
                                    ? 'text-rose-600'
                                    : 'text-slate-500'
                              }`}
                            >
                              คงเหลือในสต็อก: {formatNumber(stock)} {item.product.unit}
                              {exceedsStock && (
                                <span className="ml-1">
                                  · ส่วนที่เกิน {formatNumber(item.qty - stock)} {item.product.unit} จะสั่งผลิต
                                </span>
                              )}
                            </span>
                            {isMto && (
                              <div className="mt-1 text-[11px] text-orange-600 font-semibold leading-snug">
                                <div>⚠️ สินค้าสั่งผลิตใช้เวลา 3-5 วัน</div>
                                <div>หากมีการเปลี่ยนแปลง ทางบริษัทฯ จะแจ้งให้ท่านทราบ</div>
                              </div>
                            )}
                            <div className="quantity-stepper">
                              <button
                                type="button"
                                onClick={() => updateQty(idx, item.qty - 1)}
                                title={ecom.decreaseQuantity}
                              >
                                <Minus size={14} />
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={999999}
                                step={1}
                                value={item.qty}
                                onChange={(e) => {
                                  // Allow empty string while typing — we don't
                                  // collapse the row until they leave the input
                                  // or hit the - button down to 0.
                                  const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
                                  const n = raw === '' ? 0 : parseInt(raw, 10);
                                  if (n === 0) return; // ignore empty mid-typing
                                  updateQty(idx, Math.min(n, 999999));
                                }}
                                onBlur={(e) => {
                                  // If they cleared the input, snap back to 1
                                  // rather than removing the line silently.
                                  if (e.target.value === '' || Number(e.target.value) < 1) {
                                    updateQty(idx, 1);
                                  }
                                }}
                                className="cart-qty-input"
                                aria-label="จำนวน"
                              />
                              <button
                                type="button"
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
                  );
                })
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

                {/* Quote-for customer — links the quote so it flows into CRM
                    (RFM / quote follow-up / loyalty when it converts). Optional. */}
                <div className="mt-1 mb-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5">
                  <div className="text-[11px] font-semibold text-indigo-900 mb-1.5">ออกใบเสนอราคาในนามลูกค้า</div>
                  {quoteCustomer ? (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-white border border-neutral-200 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-neutral-900 truncate">{quoteCustomer.name}</div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          {quoteCustomer.code ?? '—'}
                          {quoteBenefit && (
                            <span className="ml-1 text-violet-600">· ระดับ{quoteBenefit.tier_label}{Number(quoteBenefit.discount_percent) > 0 ? ` (−${Number(quoteBenefit.discount_percent)}%)` : ''}</span>
                          )}
                        </div>
                      </div>
                      <button type="button" onClick={() => void pickQuoteCustomer(null)} className="text-neutral-400 hover:text-neutral-700 p-1 flex-shrink-0"><X size={14} /></button>
                    </div>
                  ) : custPickerOpen ? (
                    <div className="rounded-md bg-white border border-neutral-200 overflow-hidden">
                      <div className="p-1.5 border-b border-neutral-100 relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input autoFocus value={custQuery} onChange={e => setCustQuery(e.target.value)} placeholder="ค้นหาลูกค้า..." className="w-full pl-7 pr-2 py-1 text-sm outline-none" />
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {filteredQuoteCustomers.length === 0 ? (
                          <div className="p-3 text-center text-[11px] text-neutral-400">ไม่พบลูกค้า</div>
                        ) : filteredQuoteCustomers.map(c => (
                          <button key={c.id} type="button" onClick={() => void pickQuoteCustomer(c)} className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 border-b border-neutral-50 last:border-0">
                            <div className="text-sm text-neutral-800 truncate">{c.name}</div>
                            <div className="text-[10px] text-neutral-400 font-mono truncate">{c.code ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</div>
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => { setCustPickerOpen(false); setCustQuery(''); }} className="w-full text-center text-[11px] text-neutral-500 hover:bg-neutral-50 py-1 border-t border-neutral-100">ปิด</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setCustPickerOpen(true)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-indigo-300 bg-white px-2.5 py-1.5 text-[12px] text-indigo-600 hover:bg-indigo-50">
                      <Plus size={13} /> เลือกลูกค้า
                    </button>
                  )}
                  {quoteCustomer && quoteBenefit && Number(quoteBenefit.discount_percent) > 0 && (
                    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-neutral-700 cursor-pointer">
                      <input type="checkbox" checked={applyTierDiscount} onChange={e => setApplyTierDiscount(e.target.checked)} className="accent-indigo-600" />
                      ใส่ส่วนลดสมาชิกระดับ{quoteBenefit.tier_label} {Number(quoteBenefit.discount_percent)}% ในใบเสนอราคา
                    </label>
                  )}
                  <p className="mt-1 text-[10px] text-neutral-400 leading-snug">ผูกใบเสนอราคากับลูกค้า → ใช้ติดตาม/วิเคราะห์ใน CRM ได้ (เว้นว่างได้)</p>
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

interface GroupCardData {
  id: string;
  name: string;
  cover_image: string | null;
  description: string | null;
}

// ─── GroupGridCard ────────────────────────────────────────────────────────
/**
 * Group displayed as a product-card-sized tile in the Grid view (5-6 cols).
 * Visually matches the existing `.commerce-product-card` so groups + SKUs
 * mix cleanly in the same grid. Differences from a real product card:
 *   - Indigo accent border when expanded
 *   - Cover image OR Boxes icon placeholder
 *   - No price + no SKU; shows "X รายการ" instead
 *   - The action button toggles expansion, not add-to-cart
 *
 * Boss Jack: "เอา รูป และ ชื่อสินค้า ของกลุ่ม มาแสดงแทน" + "[➕] expand inline"
 */
function GroupGridCard({
  group,
  count,
  isOpen,
  onToggle,
}: {
  group: GroupCardData;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={cn(
        'commerce-product-card relative cursor-pointer transition',
        isOpen
          ? 'ring-2 ring-indigo-500 border-indigo-400'
          : 'hover:ring-1 hover:ring-indigo-300',
      )}
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <span
        className={cn(
          'absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm',
          isOpen ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 border border-indigo-200',
        )}
      >
        <Boxes size={10} /> กลุ่ม
      </span>

      {group.cover_image ? (
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
            src={group.cover_image}
            alt={group.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      ) : (
        <div className="product-visual" style={{ background: '#EEF2FF' }}>
          <Boxes size={40} className="text-indigo-400" />
          <span className="text-indigo-500 mt-1">รวมหลาย SKU</span>
        </div>
      )}

      <div className="product-card-body">
        <div className="product-card-meta">
          <span className="text-indigo-700 font-semibold">กลุ่มสินค้า</span>
          <span className="tabular-nums">{count} รายการ</span>
        </div>

        <h3>{group.name}</h3>

        <div className="product-card-details">
          <span className="text-indigo-600 inline-flex items-center gap-1 font-semibold text-xs">
            <Boxes size={13} />
            กลุ่มสินค้า · ดูสินค้าทั้งหมด
          </span>
        </div>

        <div className="product-card-footer">
          <div>
            <strong className="text-indigo-700 font-bold">
              {count} <span className="text-sm font-normal text-slate-500">รายการ</span>
            </strong>
            <span className="text-slate-500">คลิกเพื่อดูสินค้าในกลุ่ม</span>
          </div>
          <button
            type="button"
            className="btn-mto"
            style={{
              background: isOpen ? '#4F46E5' : '#6366F1',
              borderColor: isOpen ? '#3730A3' : '#4F46E5',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            title={isOpen ? 'ปิดรายการสินค้า' : 'แสดงสินค้าในกลุ่ม'}
          >
            {isOpen ? <ChevronDown size={13} /> : <Plus size={13} />}
            {isOpen ? 'ปิด' : 'ดู'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── GroupCompactCard ─────────────────────────────────────────────────────
/**
 * Compact version of the group card — sized to match the Compact product
 * tiles (7-8 cols, smaller thumb, line-clamped name).
 */
function GroupCompactCard({
  group,
  count,
  isOpen,
  onToggle,
}: {
  group: GroupCardData;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={cn(
        'rounded-lg border bg-white overflow-hidden flex flex-col transition relative cursor-pointer',
        isOpen
          ? 'border-indigo-500 ring-2 ring-indigo-200'
          : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm',
      )}
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <span
        className={cn(
          'absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold shadow-sm',
          isOpen ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 border border-indigo-200',
        )}
      >
        <Boxes size={9} /> กลุ่ม
      </span>

      <div className="aspect-square bg-white p-1.5 border-b border-slate-100">
        {group.cover_image ? (
          <img
            src={group.cover_image}
            alt={group.name}
            loading="lazy"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full grid place-items-center bg-indigo-50 rounded">
            <Boxes size={28} className="text-indigo-400" />
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
          กลุ่มสินค้า
        </div>
        <h3 className="text-[12px] font-semibold text-slate-900 leading-tight line-clamp-2 min-h-[2.2em]">
          {group.name}
        </h3>
        <div className="mt-auto flex items-center justify-between pt-1 border-t border-slate-100">
          <span className="text-[11px] font-bold text-indigo-700 tabular-nums">
            {count} รายการ
          </span>
          <button
            type="button"
            className={cn(
              'h-7 px-2 rounded-md text-white text-[10px] font-bold inline-flex items-center gap-0.5 whitespace-nowrap',
              isOpen ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-500 hover:bg-indigo-600',
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            title={isOpen ? 'ปิดรายการสินค้า' : 'แสดงสินค้าในกลุ่ม'}
          >
            {isOpen ? <ChevronDown size={10} /> : <Plus size={10} />}
            {isOpen ? 'ปิด' : 'ดู'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── SideBySideGroupExpansion ─────────────────────────────────────────────
/**
 * Horizontal expansion used by Grid + Compact views: the GROUP identity
 * (cover image, name, member count, close button) sits on the LEFT, and the
 * member SKU tiles render in a sub-grid on the RIGHT.
 *
 * Boss Jack's spec:
 *   - "ต้องการให้ไปทางขวามือ เมื่อหันหน้าเข้าหาจอ" → members on the right
 *   - "ขนาดรูปยังเท่าเดิม ที่ต้องการให้เล็กลง" → caller passes renderCompactCard
 *
 * The left "group panel" stays roughly the same width as 1 grid column at
 * each breakpoint — group + members feel anchored to the same row context.
 */
function SideBySideGroupExpansion({
  group,
  members,
  onClose,
  memberGridCls,
  renderMember,
}: {
  group: GroupCardData;
  members: ProductWithInventory[];
  onClose: () => void;
  memberGridCls: string;
  renderMember: (p: ProductWithInventory) => ReactNode;
}) {
  return (
    <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50/30 p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        {/* LEFT: group identity card */}
        <aside className="sm:w-48 lg:w-56 xl:w-64 flex-shrink-0">
          <div className="rounded-lg border border-indigo-200 bg-white p-3 h-full flex flex-col">
            {group.cover_image ? (
              <img
                src={group.cover_image}
                alt=""
                className="w-full aspect-square rounded-md object-contain border border-slate-200 bg-white p-1"
              />
            ) : (
              <div className="w-full aspect-square rounded-md grid place-items-center bg-indigo-50 text-indigo-500 border border-indigo-200">
                <Boxes size={36} />
              </div>
            )}
            <div className="mt-2.5 flex-1 flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
                <Boxes size={10} /> กลุ่มสินค้า
              </span>
              <h3 className="text-sm font-bold text-indigo-900 leading-snug line-clamp-3">
                {group.name}
              </h3>
              <span className="text-[11px] font-bold text-indigo-700 tabular-nums">
                {members.length} รายการ
              </span>
              {group.description && (
                <p className="text-[11px] text-slate-600 line-clamp-3 leading-relaxed">
                  {group.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 h-8 w-full rounded-md bg-white hover:bg-indigo-100 text-indigo-700 text-xs font-semibold inline-flex items-center justify-center gap-1 border border-indigo-300 transition"
              title="ปิดรายการสินค้าในกลุ่ม"
            >
              <X size={12} /> ปิด
            </button>
          </div>
        </aside>

        {/* RIGHT: smaller member tiles, wrap to multi-row if many */}
        <section className={`${memberGridCls} flex-1 min-w-0 self-start`}>
          {members.map(renderMember)}
        </section>
      </div>
    </div>
  );
}

// ─── GroupBanner (List view) ──────────────────────────────────────────────
/**
 * Full-width row banner — kept for the List view mode which Boss Jack
 * confirmed is correct as-is. Grid + Compact use card-shaped variants
 * (GroupGridCard / GroupCompactCard) instead.
 */
function GroupBanner({
  group,
  count,
  isOpen,
  onToggle,
}: {
  group: { id: string; name: string; cover_image: string | null; description: string | null };
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left flex items-center gap-4 rounded-lg border p-3 transition',
        isOpen
          ? 'border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30',
      )}
      aria-expanded={isOpen}
    >
      {/* Cover — same dimensions as the List product-card thumb (w-28 h-28)
          so the parent group banner reads as the dominant tile in the row.
          Boss Jack's request: สลับ ขนาดรูปที่แสดง ของกลุ่ม กับ expand inline. */}
      <div className="flex-shrink-0">
        {group.cover_image ? (
          <img
            src={group.cover_image}
            alt=""
            className="w-28 h-28 rounded-md object-contain border border-slate-200 bg-white p-1"
          />
        ) : (
          <div className="w-28 h-28 rounded-md grid place-items-center bg-indigo-50 text-indigo-500 border border-indigo-200">
            <Boxes size={38} />
          </div>
        )}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
            <Boxes size={10} /> กลุ่มสินค้า
          </span>
          <span className="text-[10px] font-bold text-indigo-700 tabular-nums">
            {count} รายการ
          </span>
        </div>
        <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
          {group.name}
        </h3>
        {group.description && (
          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {group.description}
          </p>
        )}
        <span className="text-[11px] text-indigo-600 font-medium mt-auto">
          {isOpen ? 'คลิกเพื่อปิดรายการ' : 'คลิกเพื่อดูสินค้าในกลุ่ม'}
        </span>
      </div>

      {/* Expand chevron */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-lg grid place-items-center transition',
          isOpen
            ? 'bg-indigo-500 text-white'
            : 'bg-indigo-50 text-indigo-600 border border-indigo-200',
        )}
      >
        {isOpen ? <ChevronDown size={18} /> : <Plus size={18} />}
      </div>
    </button>
  );
}
