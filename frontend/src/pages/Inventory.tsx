import React from 'react';
import { Plus, Filter, MoreVertical } from 'lucide-react';

const Inventory: React.FC = () => {
    const products = [
        { id: 'SKU-001', name: 'Premium Wireless Headphones', stock: 145, location: 'WH-Bangkok', status: 'In Stock' },
        { id: 'SKU-002', name: 'Mechanical Keyboard KS-80', stock: 12, location: 'WH-Chiang Mai', status: 'Low Stock' },
        { id: 'SKU-003', name: 'Ultra-wide Gaming Monitor', stock: 0, location: 'WH-Bangkok', status: 'Out of Stock' },
        { id: 'SKU-004', name: 'Ergonomic Office Chair', stock: 56, location: 'WH-Phuket', status: 'In Stock' },
    ];

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">Inventory Management</h1>
                    <p className="text-muted">Manage stock across multiple warehouses</p>
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
                            <th style={{ padding: '1rem' }}>Product Name</th>
                            <th style={{ padding: '1rem' }}>Stock Level</th>
                            <th style={{ padding: '1rem' }}>Warehouse Location</th>
                            <th style={{ padding: '1rem' }}>Status</th>
                            <th style={{ padding: '1rem' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {products.map((p, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                <td style={{ padding: '1rem', fontFamily: 'monospace', color: 'var(--primary)' }}>{p.id}</td>
                                <td style={{ padding: '1rem', fontWeight: 500 }}>{p.name}</td>
                                <td style={{ padding: '1rem' }}>{p.stock} Units</td>
                                <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{p.location}</td>
                                <td style={{ padding: '1rem' }}>
                                    <span className={`badge ${p.status === 'In Stock' ? 'badge-success' : p.status === 'Low Stock' ? 'badge-warning' : 'badge-danger'}`}>
                                        {p.status}
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
