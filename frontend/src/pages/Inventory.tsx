import { useState } from 'react';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, TrendingUp, DollarSign, BarChart2, Filter, Activity } from 'lucide-react';
import ProductModal from '../components/ProductModal';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

const mockData: Product[] = [
  { id: '1', name: 'กระดาษทรายกลมสักหลาด 5"', price: 15, stock: 1500, category: 'Abrasives' },
  { id: '2', name: 'ใบเจียรเหล็ก 4"', price: 25, stock: 850, category: 'Abrasives' },
  { id: '3', name: 'สว่านไฟฟ้า 12V', price: 1290, stock: 45, category: 'Power Tools' },
  { id: '4', name: 'ประแจปากตาย 8mm', price: 89, stock: 320, category: 'Hand Tools' },
  { id: '5', name: 'หมวกนิรภัย PPE Class A', price: 249, stock: 200, category: 'Safety' },
  { id: '6', name: 'ถุงมือหนังทนความร้อน', price: 120, stock: 8, category: 'Safety' },
];

const CATEGORIES = ['All', 'Abrasives', 'Power Tools', 'Hand Tools', 'Safety', 'General'];

function getStockStatus(stock: number) {
  if (stock === 0) return { label: 'หมด', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' };
  if (stock < 10) return { label: 'ใกล้หมด', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  if (stock < 50) return { label: 'ต่ำ', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
  return { label: 'ปกติ', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
}

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>(mockData);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const handleSave = (product: Product) => {
    if (editingProduct) {
      setProducts(products.map(p => p.id === product.id ? product : p));
    } else {
      setProducts([...products, product]);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('ยืนยันการลบสินค้านี้?')) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingProduct(null);
    setIsModalOpen(true);
  };

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search);
    const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const totalValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);
  const lowStockCount = products.filter(p => p.stock < 10).length;
  const outOfStock = products.filter(p => p.stock === 0).length;

  return (
    <div className="animate-fade-in space-y-6">

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Package size={28} className="text-indigo-400" />
            Inventory Management
          </h1>
          <p className="text-slate-400 mt-1">จัดการคลังสินค้าและสต๊อกขององค์กรแบบเรียลไทม์</p>
        </div>
        <button
          onClick={openAddModal}
          className="btn btn-primary shadow-lg shadow-indigo-500/20 py-2.5"
          title="เพิ่มสินค้าใหม่"
        >
          <Plus size={18} />
          <span>เพิ่มสินค้าใหม่</span>
        </button>
      </div>

      {/* KPI Stats Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <Package size={20} />, label: 'รายการสินค้า', value: products.length, unit: 'รายการ', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
          { icon: <DollarSign size={20} />, label: 'มูลค่าคลังสินค้า', value: `฿${totalValue.toLocaleString()}`, unit: '', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { icon: <AlertTriangle size={20} />, label: 'สต๊อกต่ำ', value: lowStockCount, unit: 'รายการ', color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { icon: <BarChart2 size={20} />, label: 'หมดสต๊อก', value: outOfStock, unit: 'รายการ', color: 'text-rose-400', bg: 'bg-rose-500/10' },
        ].map((stat, i) => (
          <div key={i} className="glass-card hover:bg-white/[0.04] transition-colors duration-200">
            <div className="flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center flex-shrink-0`}>
                {stat.icon}
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">{stat.label}</div>
                <div className="text-xl font-bold text-white mt-0.5">
                  {stat.value} <span className="text-xs text-slate-500 font-normal">{stat.unit}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter & Search Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">
        <div className="flex-1 min-w-[280px] relative group">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
          <input
            type="text"
            placeholder="ค้นหาสินค้า หรือ รหัส..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 outline-none focus:border-indigo-500/50 transition-all shadow-inner"
            title="ค้นหาสินค้า"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 custom-scrollbar">
          <span className="text-slate-500 p-2"><Filter size={16} /></span>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${
                selectedCategory === cat 
                ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20' 
                : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
              title={`หมวดหมู่ ${cat}`}
            >{cat}</button>
          ))}
        </div>
      </div>

      {/* Data Table Section */}
      <div className="glass-card overflow-hidden border border-white/5">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/5">
                <th className="text-left py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">รหัส</th>
                <th className="text-left py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">ชื่อสินค้า</th>
                <th className="text-left py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">หมวดหมู่</th>
                <th className="text-right py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">ราคาทุน</th>
                <th className="text-right py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">สต๊อก</th>
                <th className="text-center py-4 px-6 text-xs font-bold text-slate-400 uppercase tracking-widest">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <div className="flex flex-col items-center opacity-20">
                      <Package size={56} className="mb-4" />
                      <p className="text-xl font-medium">ไม่พบรายการที่มีข้อมูล</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((product) => {
                  const status = getStockStatus(product.stock);
                  return (
                    <tr 
                      key={product.id} 
                      className="group hover:bg-indigo-500/[0.03] transition-colors"
                    >
                      <td className="py-4 px-6 font-mono text-sm text-slate-500 group-hover:text-indigo-400 transition-colors">
                        #{product.id.padStart(4, '0')}
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-200">{product.name}</td>
                      <td className="py-4 px-6">
                        <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-400 uppercase">
                          {product.category}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right font-bold text-white tracking-wider">
                        ฿{product.price.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`text-sm font-black ${status.color}`}>
                            {product.stock.toLocaleString()}
                          </span>
                          <span className={`${status.bg} ${status.color} ${status.border} border text-[9px] font-black px-2 py-0.5 rounded-md uppercase mt-1`}>
                            {status.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => openEditModal(product)}
                            className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all border border-indigo-500/20"
                            title="แก้ไขสินค้า"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(product.id)}
                            className="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white transition-all border border-rose-500/20"
                            title="ลบสินค้า"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Summary Footer */}
        <div className="bg-slate-900/40 px-6 py-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Activity size={14} />
            แสดง {filtered.length} จาก {products.length} รายการ
          </div>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase">
                <span>มูลค่ารวม:</span>
                <span className="text-indigo-400 text-sm">฿{totalValue.toLocaleString()}</span>
             </div>
             <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-[10px] font-black text-emerald-400/80 uppercase">In Sync</span>
             </div>
          </div>
        </div>
      </div>

      <ProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingProduct={editingProduct}
      />
    </div>
  );
}
