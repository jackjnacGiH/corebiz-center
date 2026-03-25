import React, { useState } from 'react';
import { Plus, Filter, Minus, Package, Box } from 'lucide-react';

const initialInventory = [
  { id: 1, sku: 'SA-001', name: 'กระดาษทรายกลมสักหลาด 5"', desc: 'สีฟ้า PE Film, #400 DEERFOS', qty: 1500, minQty: 200, location: 'WH-Bangkok' },
  { id: 2, sku: 'TW-002', name: 'ใบเจียรเหล็ก 4"', desc: 'หนา 6mm, TOA', qty: 850, minQty: 100, location: 'WH-Bangkok' },
  { id: 3, sku: 'SA-003', name: 'กระดาษทรายกลมสักหลาด 5"', desc: 'สีม่วง Ceramic, #240 DEERFOS', qty: 320, minQty: 100, location: 'WH-Chiang Mai' },
  { id: 4, sku: 'TW-004', name: 'ใบเจียรตัดสแตนเลส 4"', desc: 'หนา 1mm, INOX TOA', qty: 40, minQty: 100, location: 'WH-Bangkok' },
  { id: 5, sku: 'SA-005', name: 'กระดาษทรายกลมสักหลาด 6"', desc: 'สีเขียว Zirconia, #80 MIRKA', qty: 0, minQty: 50, location: 'WH-Phuket' },
  { id: 6, sku: 'JN-003', name: 'ล้อทรายมีแกน 6mm', desc: 'งานลบคม CNC', qty: 45, minQty: 50, location: 'WH-Bangkok' },
];

const Inventory: React.FC = () => {
  const [inventory] = useState(initialInventory);

  const getStockStatus = (qty: number, minQty: number) => {
    if (qty === 0) return <span className="badge badge-danger">หมดสต๊อก</span>;
    if (qty <= minQty) return <span className="badge badge-warning">ใกล้หมด</span>;
    return <span className="badge badge-success">ปกติ</span>;
  };

  return (
    <div className="animate-fade-in p-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Package className="w-8 h-8 text-primary" />
            จัดการคลังสินค้า (Inventory)
          </h1>
          <p className="text-muted mt-1">จัดการรับเข้า เบิกออก และตรวจสอบสถานะสินค้าคงคลัง</p>
        </div>
        
        <div className="flex gap-3">
          <button className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-lg shadow-emerald-500/20">
            <Plus className="w-5 h-5" />
            <span>รับเข้า (In)</span>
          </button>
          <button className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-lg shadow-amber-500/20">
            <Minus className="w-5 h-5" />
            <span>เบิกออก (Out)</span>
          </button>
          <button className="btn btn-secondary hidden sm:flex">
            <Filter size={18} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass-card flex items-center gap-4 py-4">
          <div className="bg-primary/20 p-3 rounded-xl border border-primary/30">
            <Box className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted mb-1">สินค้าทั้งหมด</p>
            <h3 className="text-2xl font-bold text-white">{inventory.length} <span className="text-sm font-normal text-muted">SKU</span></h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4">
          <div className="bg-warning/20 p-3 rounded-xl border border-warning/30">
            <Package className="w-6 h-6 text-warning" />
          </div>
          <div>
            <p className="text-sm text-muted mb-1">สินค้าใกล้หมด</p>
            <h3 className="text-2xl font-bold text-white">{inventory.filter(i => i.qty > 0 && i.qty <= i.minQty).length} <span className="text-sm font-normal text-muted">รายการ</span></h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4">
          <div className="bg-danger/20 p-3 rounded-xl border border-danger/30">
            <Package className="w-6 h-6 text-danger" />
          </div>
          <div>
            <p className="text-sm text-muted mb-1">สินค้าหมดสต๊อก</p>
            <h3 className="text-2xl font-bold text-white">{inventory.filter(i => i.qty === 0).length} <span className="text-sm font-normal text-muted">รายการ</span></h3>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-4 px-6 font-semibold text-gray-300 w-24">SKU</th>
                <th className="py-4 px-6 font-semibold text-gray-300">ชื่อสินค้า</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-right w-28">คงเหลือ</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center w-28">สถานะ</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {inventory.map((item) => (
                <tr key={item.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono text-primary">{item.sku}</td>
                  <td className="py-4 px-6">
                    <div className="font-bold text-gray-100">{item.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{item.desc} | <span className="text-gray-500">คลัง: {item.location}</span></div>
                  </td>
                  <td className={`py-4 px-6 text-right font-bold text-lg ${item.qty === 0 ? 'text-red-500' : item.qty <= item.minQty ? 'text-amber-500' : 'text-emerald-400'}`}>
                    {item.qty.toLocaleString()}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {getStockStatus(item.qty, item.minQty)}
                  </td>
                  <td className="py-4 px-6 text-center">
                    <button className="text-blue-400 hover:text-blue-300 text-sm font-medium px-3 py-1 rounded bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Inventory;
