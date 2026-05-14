import { useEffect, useMemo, useState } from 'react';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, DollarSign, RefreshCw } from 'lucide-react';
import ProductModal, { type ProductFormData } from '../components/ProductModal';
import {
  productsApi,
  inventoryApi,
  categoriesApi,
  warehousesApi,
  type ProductWithInventory,
} from '../lib/api';
import type { Category, Warehouse } from '../lib/database.types';
import { useLanguage } from '../i18n';
import { useRealtimeTable } from '../lib/useRealtimeTable';

type StockStatus = 'out' | 'low' | 'warning' | 'normal';

function deriveStatus(p: ProductWithInventory): StockStatus {
  if (p.total_quantity === 0) return 'out';
  if (p.low_stock) return 'low';
  if (p.total_quantity < 50) return 'warning';
  return 'normal';
}

const STATUS_STYLES: Record<StockStatus, { color: string; bg: string; border: string }> = {
  out:     { color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20' },
  low:     { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  warning: { color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20' },
  normal:  { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};

export default function Inventory() {
  const { t } = useLanguage();
  const [products, setProducts] = useState<ProductWithInventory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithInventory | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [p, c, w] = await Promise.all([
        productsApi.list(),
        categoriesApi.list(),
        warehousesApi.list(),
      ]);
      setProducts(p);
      setCategories(c);
      setWarehouses(w);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useRealtimeTable('products', () => void load());
  useRealtimeTable('inventory', () => void load());

  const filtered = useMemo(() => {
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
    const value = products.reduce((acc, p) => acc + p.total_quantity * Number(p.price), 0);
    const lowCount = products.filter(p => p.low_stock || p.total_quantity === 0).length;
    return { count: products.length, value, lowCount };
  }, [products]);

  const defaultWarehouseId = warehouses.find(w => w.is_default)?.id;

  async function handleSave(form: ProductFormData) {
    if (editingProduct) {
      await productsApi.update(editingProduct.id, {
        name_th: form.name_th,
        name_en: form.name_en || null,
        category_id: form.category_id,
        brand: form.brand || null,
        unit: form.unit,
        price: form.price,
        cost: form.cost,
        status: form.status,
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
        unit: form.unit,
        price: form.price,
        cost: form.cost,
        status: form.status,
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
    if (!window.confirm(t.inventory.confirmDelete)) return;
    try {
      await productsApi.remove(p.id);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="animate-fade-in p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Package className="w-8 h-8 text-indigo-400" />
            {t.inventory.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.inventory.subtitle}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => load()}
            className="btn btn-secondary flex items-center gap-2"
            title="Reload"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="relative">
            <input
              type="text"
              placeholder={t.common.search + '...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800/50 border border-gray-700/50 text-white text-sm rounded-lg pl-10 pr-3 py-2.5 w-64 focus:border-indigo-500 outline-none"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <button
            onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg shadow-lg shadow-indigo-500/20"
          >
            <Plus size={18} /> {t.inventory.addProduct}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-indigo-500/20 p-3 rounded-xl border border-indigo-500/30">
            <Package className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{t.inventory.table.name}</p>
            <h3 className="text-2xl font-bold text-white">{stats.count}</h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-emerald-500/20 p-3 rounded-xl border border-emerald-500/30">
            <DollarSign className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">มูลค่าสต๊อก</p>
            <h3 className="text-2xl font-bold text-emerald-400">฿{stats.value.toLocaleString()}</h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-amber-500/20 p-3 rounded-xl border border-amber-500/30">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-sm text-slate-400">{t.inventory.lowStockAlert}</p>
            <h3 className="text-2xl font-bold text-amber-400">{stats.lowCount}</h3>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategoryId('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            selectedCategoryId === 'all'
              ? 'bg-indigo-500 border-indigo-500 text-white'
              : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
          }`}
        >
          ทั้งหมด ({products.length})
        </button>
        {categories.map(c => {
          const count = products.filter(p => p.category_id === c.id).length;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedCategoryId(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                selectedCategoryId === c.id
                  ? 'bg-indigo-500 border-indigo-500 text-white'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
              }`}
            >
              {c.name_th} ({count})
            </button>
          );
        })}
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">SKU</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.inventory.table.name}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider">{t.inventory.table.category}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-right">{t.inventory.table.price}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-right">{t.inventory.table.stock}</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">สถานะ</th>
                <th className="py-3 px-4 text-xs font-semibold text-gray-300 uppercase tracking-wider text-center">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {loading && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.loading}</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t.common.noData}</td></tr>
              )}
              {!loading && filtered.map(p => {
                const status = deriveStatus(p);
                const s = STATUS_STYLES[status];
                return (
                  <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-3 px-4 text-sm font-mono text-indigo-400">{p.sku}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-100">{p.name_th}</div>
                      {p.brand && <div className="text-xs text-slate-500 mt-0.5">{p.brand}</div>}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {p.category?.name_th ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-emerald-400">
                      ฿{Number(p.price).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="font-bold text-white">{p.total_quantity}</div>
                      <div className="text-xs text-slate-500">{p.unit}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${s.bg} ${s.color} ${s.border}`}>
                        {t.inventory.stockStatus[status]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => { setEditingProduct(p); setIsModalOpen(true); }}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition"
                          title={t.common.edit}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
                          title={t.common.delete}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
