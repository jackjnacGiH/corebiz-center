import { useState } from 'react';
import { Search, Filter, Eye, ShoppingCart } from 'lucide-react';

const initialOrders = [
  { id: 'ORD-001', customer: 'บจก. ก่อสร้างไทย', total: 4500, status: 'Pending', date: '2026-03-29' },
  { id: 'ORD-002', customer: 'อู่ช่างแมว', total: 1250, status: 'Shipped', date: '2026-03-28' },
  { id: 'ORD-003', customer: 'ร้านสมชายวัสดุภัณฑ์', total: 8900, status: 'Delivered', date: '2026-03-27' },
  { id: 'ORD-004', customer: 'บริษัท เจริญการช่าง จำกัด', total: 15200, status: 'Processing', date: '2026-03-26' },
];

const Orders = () => {
  const [orders] = useState(initialOrders);

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Delivered':
      case 'Shipped':
        return <span className="badge badge-success px-2 py-1">{status}</span>;
      case 'Processing':
        return <span className="badge badge-primary px-2 py-1">{status}</span>;
      case 'Pending':
      default:
        return <span className="badge badge-warning px-2 py-1">{status}</span>;
    }
  };

  return (
    <div className="animate-fade-in p-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <ShoppingCart className="w-8 h-8 text-primary" />
            จัดการคำสั่งซื้อ (Orders)
          </h1>
          <p className="text-muted mt-1">ตรวจสอบและติดตามสถานะคำสั่งซื้อจากตัวแทนจำหน่าย</p>
        </div>
        
        <div className="flex gap-3">
          <div className="relative">
            <input 
              type="text" 
              placeholder="ค้นหาออเดอร์..." 
              className="bg-gray-800/50 border border-gray-700/50 text-white text-sm rounded-lg focus:ring-primary focus:border-primary block w-full pl-10 p-2.5"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <button className="btn btn-secondary hidden sm:flex items-center gap-2">
            <Filter size={18} /> <span className="hidden sm:inline">กรอง</span>
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-4 px-6 font-semibold text-gray-300 w-32">รหัสออเดอร์</th>
                <th className="py-4 px-6 font-semibold text-gray-300">ลูกค้า</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-right">ยอดรวม (฿)</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center">สถานะ</th>
                <th className="py-4 px-6 font-semibold text-gray-300">วันที่</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono font-medium text-primary">{order.id}</td>
                  <td className="py-4 px-6 font-medium text-gray-100">{order.customer}</td>
                  <td className="py-4 px-6 text-right font-bold text-emerald-400">
                    {order.total.toLocaleString()}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {getStatusBadge(order.status)}
                  </td>
                  <td className="py-4 px-6 text-gray-400 text-sm">{order.date}</td>
                  <td className="py-4 px-6 text-center">
                    <button className="text-blue-400 hover:text-blue-300 text-sm font-medium px-3 py-1.5 rounded flex items-center gap-1 mx-auto bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                      <Eye size={14} /> รายละเอียด
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

export default Orders;
