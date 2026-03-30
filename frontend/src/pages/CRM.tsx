import React, { useState } from 'react';
import { Users, Mail, Phone, Search, UserPlus, Eye, Briefcase, User } from 'lucide-react';

const initialCustomers = [
  { id: 'CUS-001', name: 'บจก. ก่อสร้างไทย', type: 'บริษัท', tier: 'VIP', totalSpent: 125000, email: 'contact@korsangthai.com', phone: '02-123-4567' },
  { id: 'CUS-002', name: 'อู่ช่างแมว', type: 'บุคคล', tier: 'ทั่วไป', totalSpent: 15000, email: 'changmeow@gmail.com', phone: '081-987-6543' },
  { id: 'CUS-003', name: 'ร้านสมชายวัสดุภัณฑ์', type: 'บริษัท', tier: 'Gold', totalSpent: 85000, email: 'somchai.wat@hotmail.com', phone: '089-111-2222' },
  { id: 'CUS-004', name: 'นาย เจตน์ งานไม้', type: 'บุคคล', tier: 'ทั่วไป', totalSpent: 4500, email: 'jet.wood@gmail.com', phone: '085-555-4444' },
];

const CRM: React.FC = () => {
  const [customers] = useState(initialCustomers);

  const getTierBadge = (tier: string) => {
    switch(tier) {
      case 'VIP':
        return <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider">{tier}</span>;
      case 'Gold':
        return <span className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider">{tier}</span>;
      case 'ทั่วไป':
      default:
        return <span className="bg-gray-500/20 text-gray-400 border border-gray-500/30 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider">{tier}</span>;
    }
  };

  return (
    <div className="animate-fade-in p-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Users className="w-8 h-8 text-primary" />
            จัดการลูกค้า (CRM)
          </h1>
          <p className="text-muted mt-1">ฐานข้อมูลลูกค้าและตัวแทนจำหน่ายทั้งหมดในระบบ</p>
        </div>
        
        <div className="flex gap-3">
          <div className="relative">
            <input 
              type="text" 
              placeholder="ค้นหาลูกค้า..." 
              className="bg-gray-800/50 border border-gray-700/50 text-white text-sm rounded-lg focus:ring-primary focus:border-primary block w-full pl-10 p-2.5"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          </div>
          <button className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-lg shadow-primary/20">
            <UserPlus size={18} /> <span className="hidden sm:inline">เพิ่มลูกค้า</span>
          </button>
        </div>
      </div>

      {/* CRM Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-blue-500/20 p-3 rounded-xl border border-blue-500/30">
            <Users className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400 mb-1">ลูกค้าทั้งหมด</p>
            <h3 className="text-2xl font-bold text-white">4 <span className="text-sm font-normal text-gray-500">ราย</span></h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-purple-500/20 p-3 rounded-xl border border-purple-500/30">
            <Briefcase className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400 mb-1">ลูกค้านิติบุคคล (บริษัท)</p>
            <h3 className="text-2xl font-bold text-white">2 <span className="text-sm font-normal text-gray-500">ราย</span></h3>
          </div>
        </div>
        <div className="glass-card flex items-center gap-4 py-4 px-5">
          <div className="bg-emerald-500/20 p-3 rounded-xl border border-emerald-500/30">
            <User className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400 mb-1">ลูกค้าบุคคลธรรมดา</p>
            <h3 className="text-2xl font-bold text-white">2 <span className="text-sm font-normal text-gray-500">ราย</span></h3>
          </div>
        </div>
      </div>

      {/* CRM Table */}
      <div className="glass-card overflow-hidden p-0 border border-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left border-collapse">
            <thead className="bg-gray-800/50 border-b border-gray-700/50">
              <tr>
                <th className="py-4 px-6 font-semibold text-gray-300">รหัสลูกค้า</th>
                <th className="py-4 px-6 font-semibold text-gray-300">ชื่อลูกค้า / ข้อมูลติดต่อ</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center">ประเภท</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center">ระดับ (Tier)</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-right">ยอดซื้อสะสม (฿)</th>
                <th className="py-4 px-6 font-semibold text-gray-300 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {customers.map((cus) => (
                <tr key={cus.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono font-medium text-primary align-top pt-5">{cus.id}</td>
                  <td className="py-4 px-6">
                    <div className="font-bold text-gray-100 text-base mb-1">{cus.name}</div>
                    <div className="flex flex-col gap-1 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><Mail size={12} className="text-gray-500" /> {cus.email}</span>
                      <span className="flex items-center gap-1.5"><Phone size={12} className="text-gray-500" /> {cus.phone}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center align-top pt-5">
                    <span className="text-gray-300 font-medium text-sm bg-gray-800 px-2.5 py-1 rounded-md border border-gray-700">
                      {cus.type === 'บริษัท' ? <Briefcase size={12} className="inline mr-1 text-blue-400" /> : <User size={12} className="inline mr-1 text-emerald-400" />}
                      {cus.type}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-center align-top pt-5">
                    {getTierBadge(cus.tier)}
                  </td>
                  <td className="py-4 px-6 text-right align-top pt-5">
                    <span className="font-bold text-emerald-400 text-lg">
                      {cus.totalSpent.toLocaleString()}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-center align-top pt-5">
                    <button className="text-gray-300 hover:text-white text-sm font-medium px-3 py-1.5 rounded flex items-center gap-1 mx-auto bg-gray-700/50 border border-gray-600/50 hover:bg-primary/20 hover:border-primary/50 hover:text-primary transition-colors">
                      <Eye size={14} /> Profile
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

export default CRM;
