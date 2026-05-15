import { useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Search, Edit2, Trash2, AlertTriangle, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, MapPin, Box, Tag, ChevronDown,
  ChevronRight, Upload, FileDown, Filter,
} from 'lucide-react';
import ProductModal, { type ProductFormData } from '../components/ProductModal';
import {
  productsApi,
  inventoryApi,
  categoriesApi,
  warehousesApi,
  type ProductWithInventory,
} from '../lib/api';
import type { Category, Warehouse } from '../lib/database.types';
import { useRealtimeTable } from '../lib/useRealtimeTable';

// ─── types & helpers ─────────────────────────────────────────────────────
type StockStatus = 'out' | 'low' | 'watch' | 'normal';
type SortKey = 'updated' | 'name' | 'sku' | 'stock' | 'price' | 'value';
type StockFilter = 'all' | 'in_stock' | 'low' | 'out';
type ViewDensity = 'comfortable' | 'compact';

function deriveStatus(p: ProductWithInventory): StockStatus {
  if (p.total_quantity === 0) return 'out';
  if (p.low_stock) return 'low';
  if (p.total_quantity < 50) return 'watch';
  return 'normal';
}

const STATUS_META: Record<StockStatus, { label: string; text: string; bg: string; dot: string; bar: string }> = {
  out:    { label: 'หมด',    text: 'text-red-600',     bg: 'bg-red-50',     dot: 'bg-red-500',     bar: 'bg-red-500' },
  low:    { label: 'ใกล้หมด', text: 'text-amber-700',   bg: 'bg-amber-50',   dot: 'bg-amber-500',   bar: 'bg-amber-500' },
  watch:  { label: 'ต่ำ',    text: 'text-orange-700',  bg: 'bg-orange-50',  dot: 'bg-orange-500',  bar: 'bg-orange-500' },
  normal: { label: 'ปกติ',   text: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
};

const PRODUCT_STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  active:   { label: 'Active',   dot: 'bg-emerald-500', text: 'text-emerald-700' },
  draft:    { label: 'Draft',    dot: 'bg-slate-400',   text: 'text-slate-600'   },
  archived: { label: 'Archived', dot: 'bg-slate-300',   text: 'text-slate-500'   },
};

function formatTHB(value: number, options: { compact?: boolean } = {}): string {
  if (options.compact && value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(2)}M`;
  if (options.compact && value >= 1_000)     return `฿${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

function calcMargin(price: number, cost: number | null | undefined): number | null {
  if (!cost || cost <= 0) return null;
  return ((price - cost) / price) * 100;
}

// ─── component ──────────────────────────────────────────────────────────
export default function Inventory() {
  const [products, setProducts]     = useState<ProductWithInventory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);

  // UI state
  const [search, setSearch]                         = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<'all' | string>('all');
  const [stockFilter, setStockFilter]               = useState<StockFilter>('all');
  const [sortKey, setSortKey]                       = useState<SortKey>('updated');
  const [sortDir, setSortDir]                       = useState<'asc' | 'desc'>('desc');
  const [density, setDensity]                       = useState<ViewDensity>('comfortable');
  const [expandedId, setExpandedId]                 = useState<string | null>(null);
  const [selected, setSelected]                     = useState<Set<string>>(new Set());

  const [isModalOpen, setIsModalOpen]       = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithInventory | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [p, c, w] = await Promise.all([
        productsApi.list(),
        categoriesApi.list(),
        warehousesApi.list(),
      ]);
      setProducts(p); setCategories(c); setWarehouses(w);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useRealtimeTable('products', () => void load());
  useRealtimeTable('inventory', () => void load());

  // Filter + sort
  const filtered = useMemo(() => {
    let rows = products.filter(p => {
      if (selectedCategoryId !== 'all' && p.category_id !== selectedCategoryId) return false;
      if (stockFilter === 'in_stock' && p.total_quantity <= 0) return false;
      if (stockFilter === 'low' && !(p.low_stock || p.total_quantity === 0)) return false;
      if (stockFilter === 'out' && p.total_quantity !== 0) return false;

      if (!search) return true;
      const s = search.toLowerCase();
      return p.name_th.toLowerCase().includes(s)
        || (p.name_en?.toLowerCase().includes(s) ?? false)
        || p.sku.toLowerCase().includes(s)
        || (p.brand?.toLowerCase().includes(s) ?? false)
        || (p.barcode?.toLowerCase().includes(s) ?? false);
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':    return a.name_th.localeCompare(b.name_th) * dir;
        case 'sku':     return a.sku.localeCompare(b.sku) * dir;
        case 'stock':   return (a.total_quantity - b.total_quantity) * dir;
        case 'price':   return (Number(a.price) - Number(b.price)) * dir;
        case 'value':   return (a.total_quantity * Number(a.price) - b.total_quantity * Number(b.price)) * dir;
        case 'updated':
        default:        return a.updated_at.localeCompare(b.updated_at) * dir;
      }
    });
    return rows;
  }, [products, search, selectedCategoryId, stockFilter, sortKey, sortDir]);

  // KPI stats
  const stats = useMemo(() => {
    const value = products.reduce((acc, p) => acc + p.total_quantity * Number(p.price), 0);
    const cost  = products.reduce((acc, p) => acc + p.total_quantity * Number(p.cost ?? 0), 0);
    const totalUnits = products.reduce((acc, p) => acc + p.total_quantity, 0);
    const lowCount = products.filter(p => p.low_stock && p.total_quantity > 0).length;
    const outCount = products.filter(p => p.total_quantity === 0).length;
    return {
      count: products.length,
      value, cost, totalUnits,
      lowCount, outCount,
      potentialMargin: value - cost,
    };
  }, [products]);

  const defaultWarehouseId = warehouses.find(w => w.is_default)?.id;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' || key === 'sku' ? 'asc' : 'desc'); }
  }

  async function handleSave(form: ProductFormData) {
    if (editingProduct) {
      await productsApi.update(editingProduct.id, {
        name_th: form.name_th,
        name_en: form.name_en || null,
        category_id: form.category_id,
        brand: form.brand || null,
        unit: form.unit, price: form.price, cost: form.cost, status: form.status,
      });
      const inv = editingProduct.inventory[0];
      if (inv) {
        await inventoryApi.adjustQuantity(inv.id, form.initial_quantity);
      } else if (defaultWarehouseId) {
        await inventoryApi.upsert({
          product_id: editingProduct.id,
          warehouse_id: defaultWarehouseId,
          quantity: form.initial_quantity,
          reorder_level: form.reorder_level,
        });
      }
    } else {
      if (!defaultWarehouseId) throw new Error('ไม่พบ default warehouse');
      const newProd = await productsApi.create({
        sku: form.sku,
        name_th: form.name_th,
        name_en: form.name_en || null,
        category_id: form.category_id,
        brand: form.brand || null,
        unit: form.unit, price: form.price, cost: form.cost, status: form.status,
      });
      await inventoryApi.upsert({
        product_id: newProd.id,
        warehouse_id: defaultWarehouseId,
        quantity: form.initial_quantity,
        reorder_level: form.reorder_level,
      });
    }
    await load();
  }

  async function handleDelete(p: ProductWithInventory) {
    if (!window.confirm(`ลบ ${p.sku} — ${p.name_th}?`)) return;
    try { await productsApi.remove(p.id); await load(); }
    catch (e) { setErr((e as Error).message); }
  }

  const rowPad = density === 'compact' ? 'py-2.5' : 'py-4';

  return (
    <div className="animate-fade-in space-y-6 max-w-[1440px] mx-auto">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Package size={20} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inventory</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {stats.count} SKUs · {formatTHB(stats.value, { compact: true })} มูลค่าสต๊อก
              {stats.lowCount + stats.outCount > 0 && (
                <> · <span className="text-amber-600 font-medium">{stats.lowCount + stats.outCount} alerts</span></>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <IconBtn onClick={() => load()} disabled={loading} title="Reload">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </IconBtn>
          <IconBtn disabled title="Import CSV (coming soon)"><Upload size={15} /></IconBtn>
          <IconBtn disabled title="Export (coming soon)"><FileDown size={15} /></IconBtn>
          <button
            onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg shadow-sm transition"
          >
            <Plus size={15} />
            <span>เพิ่มสินค้า</span>
          </button>
        </div>
      </header>

      {/* ─── KPI Strip ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <KpiCell label="Total SKUs" value={String(stats.count)} hint={`${formatNumber(stats.totalUnits)} หน่วยรวม`} />
        <KpiCell label="Stock Value" value={formatTHB(stats.value, { compact: true })} hint={`มาร์จิ้น ${formatTHB(stats.potentialMargin, { compact: true })}`} accent="emerald" />
        <KpiCell label="Low Stock" value={String(stats.lowCount)} hint={stats.lowCount > 0 ? 'ต้องสั่งเข้า' : 'ปกติทั้งหมด'} accent={stats.lowCount > 0 ? 'amber' : undefined} />
        <KpiCell label="Out of Stock" value={String(stats.outCount)} hint={stats.outCount > 0 ? 'รีบเติม' : '—'} accent={stats.outCount > 0 ? 'red' : undefined} last />
      </section>

      {/* ─── Filter Toolbar ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[280px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหา SKU, ชื่อสินค้า, แบรนด์, barcode..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
            />
          </div>

          <SelectField icon={<Tag size={13} />} label="หมวด" value={selectedCategoryId}
            options={[{ value: 'all', label: 'ทั้งหมด' }, ...categories.map(c => ({ value: c.id, label: c.name_th }))]}
            onChange={setSelectedCategoryId} />
          <SelectField icon={<Filter size={13} />} label="สต๊อก" value={stockFilter}
            options={[
              { value: 'all',      label: 'ทั้งหมด' },
              { value: 'in_stock', label: 'มีในสต๊อก' },
              { value: 'low',      label: 'ใกล้หมด' },
              { value: 'out',      label: 'หมด' },
            ]}
            onChange={v => setStockFilter(v as StockFilter)} />
          <SelectField icon={<ArrowUpDown size={13} />} label="เรียง" value={sortKey}
            options={[
              { value: 'updated', label: 'อัพเดทล่าสุด' },
              { value: 'name',    label: 'ชื่อ' },
              { value: 'sku',     label: 'SKU' },
              { value: 'stock',   label: 'จำนวน' },
              { value: 'price',   label: 'ราคา' },
              { value: 'value',   label: 'มูลค่าสต๊อก' },
            ]}
            onChange={v => setSortKey(v as SortKey)} />

          <button
            onClick={() => setDensity(d => d === 'comfortable' ? 'compact' : 'comfortable')}
            className="px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            title="Density"
          >
            {density === 'comfortable' ? 'Comfortable' : 'Compact'}
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            แสดง <span className="text-slate-900 font-medium">{filtered.length}</span> / {products.length} รายการ
          </span>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span>เลือก {selected.size} รายการ</span>
              <button onClick={() => setSelected(new Set())} className="text-blue-600 hover:text-blue-700 font-medium">
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      </section>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={14} />
          {err}
        </div>
      )}

      {/* ─── Table ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={e => setSelected(e.target.checked ? new Set(filtered.map(p => p.id)) : new Set())}
                    className="w-3.5 h-3.5 rounded border-slate-300 accent-blue-600"
                  />
                </th>
                <SortableTh label="SKU"    sortKey="sku"    active={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="สินค้า" sortKey="name"   active={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-4 py-3 text-left">หมวด</th>
                <th className="px-4 py-3 text-center">สถานะ</th>
                <SortableTh label="ราคา"   sortKey="price"  active={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh label="สต๊อก"  sortKey="stock"  active={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                <th className="px-4 py-3 text-left">ตำแหน่ง</th>
                <SortableTh label="มูลค่า" sortKey="value"  active={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={`s-${i}`} className="animate-pulse">
                  <td colSpan={10} className="px-4 py-4">
                    <div className="h-8 bg-slate-100 rounded" />
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <Box size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm text-slate-500">
                      {search || selectedCategoryId !== 'all' || stockFilter !== 'all'
                        ? 'ไม่พบสินค้าที่ตรงกับตัวกรอง'
                        : 'ยังไม่มีสินค้าในคลัง'}
                    </p>
                    {(search || selectedCategoryId !== 'all' || stockFilter !== 'all') && (
                      <button
                        onClick={() => { setSearch(''); setSelectedCategoryId('all'); setStockFilter('all'); }}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        ล้างตัวกรอง
                      </button>
                    )}
                  </td>
                </tr>
              )}

              {!loading && filtered.map(p => {
                const status   = deriveStatus(p);
                const statusM  = STATUS_META[status];
                const prodM    = PRODUCT_STATUS_META[p.status] ?? PRODUCT_STATUS_META.active;
                const inv0     = p.inventory[0];
                const reorder  = inv0?.reorder_level ?? 10;
                const margin   = calcMargin(Number(p.price), Number(p.cost ?? 0));
                const value    = p.total_quantity * Number(p.price);
                const expanded = expandedId === p.id;
                const isSelected = selected.has(p.id);

                return (
                  <>
                    <tr
                      key={p.id}
                      className={`group transition ${
                        isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'
                      } cursor-pointer`}
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                    >
                      <td className={`${rowPad} px-4`} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(p.id); else next.delete(p.id);
                            setSelected(next);
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-300 accent-blue-600"
                        />
                      </td>

                      <td className={`${rowPad} px-4`}>
                        <code className="text-xs font-mono text-blue-600 font-medium">{p.sku}</code>
                        {p.barcode && (
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">{p.barcode}</div>
                        )}
                      </td>

                      <td className={`${rowPad} px-4 max-w-md`}>
                        <div className="text-sm text-slate-900 font-medium truncate">{p.name_th}</div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {p.brand && <span>{p.brand}</span>}
                          {p.brand && p.name_en && <span className="mx-1.5 text-slate-300">·</span>}
                          {p.name_en && <span className="italic">{p.name_en}</span>}
                        </div>
                      </td>

                      <td className={`${rowPad} px-4 text-slate-700 text-sm`}>
                        {p.category?.name_th ?? <span className="text-slate-300">—</span>}
                      </td>

                      <td className={`${rowPad} px-4 text-center`}>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${prodM.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${prodM.dot}`} />
                          {prodM.label}
                        </span>
                      </td>

                      <td className={`${rowPad} px-4 text-right`}>
                        <div className="text-sm font-semibold text-slate-900">
                          {formatTHB(Number(p.price))}
                        </div>
                        {margin !== null && (
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            margin {margin.toFixed(0)}%
                          </div>
                        )}
                      </td>

                      <td className={`${rowPad} px-4`}>
                        <StockCell
                          qty={p.total_quantity}
                          reorder={reorder}
                          unit={p.unit}
                          statusMeta={statusM}
                          reserved={inv0?.reserved ?? 0}
                        />
                      </td>

                      <td className={`${rowPad} px-4 text-slate-500 text-xs`}>
                        {inv0?.shelf ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={11} className="text-slate-400" />
                            {inv0.shelf}{inv0.row_no ? `-${inv0.row_no}` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      <td className={`${rowPad} px-4 text-right`}>
                        <div className="text-sm font-semibold text-slate-900">
                          {formatTHB(value, { compact: true })}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {relativeTime(p.updated_at)}
                        </div>
                      </td>

                      <td className={`${rowPad} px-4`}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={e => { e.stopPropagation(); setEditingProduct(p); setIsModalOpen(true); }}
                            className="p-1.5 rounded text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition"
                            title="แก้ไข"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleDelete(p); }}
                            className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
                            title="ลบ"
                          >
                            <Trash2 size={13} />
                          </button>
                          <ChevronRight size={14} className={`text-slate-400 transition ${expanded ? 'rotate-90' : ''}`} />
                        </div>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={10} className="px-6 py-5">
                          <ExpandedRow p={p} warehouses={warehouses} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingProduct={editingProduct}
        categories={categories}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function IconBtn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
    >
      {children}
    </button>
  );
}

function KpiCell({
  label, value, hint, accent, last,
}: { label: string; value: string; hint?: string; accent?: 'emerald' | 'amber' | 'red'; last?: boolean }) {
  const accentMap: Record<string, string> = {
    emerald: 'text-emerald-700',
    amber:   'text-amber-700',
    red:     'text-red-700',
  };
  return (
    <div className={`p-5 ${!last ? 'md:border-r border-slate-200' : ''}`}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight ${accent ? accentMap[accent] : 'text-slate-900'}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-slate-500 mt-1.5">{hint}</div>}
    </div>
  );
}

function SelectField({
  icon, label, value, options, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-200 rounded-lg pl-8 pr-9 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 outline-none cursor-pointer transition"
        aria-label={label}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">{icon}</span>
      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function SortableTh({
  label, sortKey, active, dir, onClick, align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: 'asc' | 'desc';
  onClick: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const isActive = active === sortKey;
  const alignCls = align === 'right' ? 'text-right justify-end' : align === 'center' ? 'text-center justify-center' : 'text-left';
  return (
    <th className={`px-4 py-3 ${alignCls}`}>
      <button
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 ${alignCls} ${
          isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
        } transition`}
      >
        {label}
        {isActive
          ? (dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
          : <ArrowUpDown size={10} className="opacity-30" />
        }
      </button>
    </th>
  );
}

function StockCell({
  qty, reorder, unit, statusMeta, reserved,
}: {
  qty: number;
  reorder: number;
  unit: string;
  statusMeta: typeof STATUS_META[StockStatus];
  reserved: number;
}) {
  const maxScale = Math.max(reorder * 3, 50, qty);
  const pct = Math.min(100, Math.max(0, (qty / maxScale) * 100));

  return (
    <div className="min-w-[150px]">
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-semibold ${statusMeta.text}`}>{formatNumber(qty)}</span>
        <span className="text-xs text-slate-500">{unit}</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium ${statusMeta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
          {statusMeta.label}
        </span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${statusMeta.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
        <span>min {reorder}</span>
        {reserved > 0 && <span className="text-amber-600">จอง {reserved}</span>}
      </div>
    </div>
  );
}

function ExpandedRow({ p, warehouses }: { p: ProductWithInventory; warehouses: Warehouse[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">รายละเอียด</div>
        <dl className="space-y-1.5 text-xs">
          <DetailRow label="ID"       value={<code className="font-mono text-slate-700">{p.id.slice(0, 8)}…</code>} />
          <DetailRow label="Cost"     value={p.cost ? formatTHB(Number(p.cost)) : '—'} />
          <DetailRow label="Weight"   value={p.weight_kg ? `${p.weight_kg} kg` : '—'} />
          <DetailRow label="Featured" value={p.is_featured ? '⭐ Yes' : '—'} />
          <DetailRow label="Created"  value={new Date(p.created_at).toLocaleDateString('th-TH')} />
        </dl>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">สต๊อกแยกตามคลัง</div>
        <div className="space-y-1.5">
          {p.inventory.length === 0 && <div className="text-xs text-slate-400">ไม่มีข้อมูลคลัง</div>}
          {p.inventory.map(inv => {
            const wh = warehouses.find(w => w.id === inv.warehouse_id);
            return (
              <div key={inv.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  <Box size={11} className="inline mr-1 text-slate-400" />
                  {wh?.name ?? 'Unknown'}
                  {inv.shelf && <span className="text-slate-400 ml-2">@ {inv.shelf}{inv.row_no ? `-${inv.row_no}` : ''}</span>}
                </span>
                <span className="font-mono text-slate-900 font-medium">
                  {formatNumber(inv.quantity)} <span className="text-slate-400 font-normal">{p.unit}</span>
                  {inv.reserved > 0 && <span className="text-amber-600 ml-2">(จอง {inv.reserved})</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Tags</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {p.tags.length === 0 ? (
            <span className="text-xs text-slate-400">ไม่มี tags</span>
          ) : (
            p.tags.map(t => (
              <span key={t} className="px-2 py-0.5 rounded text-[10px] bg-slate-100 border border-slate-200 text-slate-700 font-medium">
                {t}
              </span>
            ))
          )}
        </div>

        {p.description_th && (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">คำอธิบาย</div>
            <p className="text-xs text-slate-600 leading-relaxed">{p.description_th}</p>
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 text-right font-medium">{value}</dd>
    </div>
  );
}
