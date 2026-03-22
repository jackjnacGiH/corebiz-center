import React from 'react';
import { Plus, Filter, MoreVertical } from 'lucide-react';

const Inventory: React.FC = () => {
    const products = [
        { id: 'SA-001', name: 'กระดาษทรายกลมสักหลาด 5"', spec: 'สีฟ้า PE Film, #400 DEERFOS', stock: 1500, location: 'WH-Bangkok', status: 'In Stock' },
        { id: 'TW-002', name: 'ใบเจียรเหล็ก 4"', spec: 'หนา 6mm, TOA', stock: 850, location: 'WH-Bangkok', status: 'In Stock' },
        { id: 'SA-003', name: 'กระดาษทรายกลมสักหลาด 5"', spec: 'สีแดง Ceramic, #240 DEERFOS', stock: 320, location: 'WH-Chiang Mai', status: 'In Stock' },
        { id: 'TW-004', name: 'ใบเจียรสแตนเลส 4"', spec: 'หนา 1mm, INOX TOA', stock: 40, location: 'WH-Bangkok', status: 'Low Stock' },
        { id: 'SA-005', name: 'กระดาษทรายกลมสักหลาด 6"', spec: 'สีทอง Zirconia, #80 MIRKA', stock: 0, location: 'WH-Phuket', status: 'Out of Stock' },
    ];

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">จัดการคลังสินค้า (Inventory)</h1>
                    <p className="text-muted">จัดการสต๊อกสินค้าทั่วทุกคลังสินค้า</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn btn-secondary"><Filter size={18} /> Filter Logs</button>
                    <button className="btn btn-primary"><Plus size={18} /> Add Product / SKU</button>
                </div>
            </div>

            <div className="glass-card">
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '1rem' }}>SKU</th>
                            <th style={{ padding: '1rem' }}>ชื่อสินค้า</th>
                            <th style={{ padding: '1rem' }}>รายละเอียด (Spec)</th>
                            <th style={{ padding: '1rem' }}>คงเหลือ</th>
                            <th style={{ padding: '1rem' }}>คลังสินค้า</th>
                            <th style={{ padding: '1rem' }}>สถานะ</th>
                            <th style={{ padding: '1rem' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {products.map((p, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                <td style={{ padding: '1rem', fontFamily: 'monospace', color: 'var(--primary)' }}>{p.id}</td>
                                <td style={{ padding: '1rem', fontWeight: 500 }}>{p.name}</td>
                                <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{p.spec}</td>
                                <td style={{ padding: '1rem', fontWeight: 700, color: p.stock === 0 ? 'var(--danger)' : 'var(--success)' }}>
                                    {p.stock.toLocaleString()} ชิ้น
                                </td>
                                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{p.location}</td>
                                <td style={{ padding: '1rem' }}>
                                    <span className={`badge ${p.status === 'In Stock' ? 'badge-success' : p.status === 'Low Stock' ? 'badge-warning' : 'badge-danger'}`}>
                                        {p.status === 'In Stock' ? 'มีสินค้า' : p.status === 'Low Stock' ? 'ใกล้หมด' : 'หมดสต๊อก'}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                        <MoreVertical size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Inventory;
