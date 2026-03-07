import React from 'react';
import { Users, Mail, Phone } from 'lucide-react';

const CRM: React.FC = () => {
    const customers = [
        { name: 'Somchai Jaidee', email: 'somchai@email.com', phone: '081-123-4567', tier: 'VIP Gold', spent: '฿145,000' },
        { name: 'Manee Rakdee', email: 'manee@email.com', phone: '089-987-6543', tier: 'Silver', spent: '฿25,400' },
        { name: 'Piti Suksabai', email: 'piti@email.com', phone: '085-555-4444', tier: 'Bronze', spent: '฿5,200' },
    ];

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">CRM & Customer Relations</h1>
                    <p className="text-muted">Manage customer data, segmentation, and retention</p>
                </div>
                <button className="btn btn-primary"><Users size={18} /> Add Customer</button>
            </div>

            <div className="grid grid-cols-3 gap-6 mb-6">
                <div className="glass-card">
                    <h3 className="text-muted text-sm mb-2">Total Customers</h3>
                    <div className="text-2xl font-bold">14,284</div>
                </div>
                <div className="glass-card">
                    <h3 className="text-muted text-sm mb-2">Customer Lifetime Value (Avg)</h3>
                    <div className="text-2xl font-bold">฿12,450</div>
                </div>
                <div className="glass-card">
                    <h3 className="text-muted text-sm mb-2">Retention Rate</h3>
                    <div className="text-2xl font-bold text-success">68%</div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="text-xl font-bold mb-4">Customer Directory</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '1rem' }}>Name</th>
                            <th style={{ padding: '1rem' }}>Contact</th>
                            <th style={{ padding: '1rem' }}>Tier</th>
                            <th style={{ padding: '1rem' }}>Total Spent</th>
                            <th style={{ padding: '1rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map((c, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                <td style={{ padding: '1rem', fontWeight: 500 }}>{c.name}</td>
                                <td style={{ padding: '1rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9rem' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={14} className="text-muted" /> {c.email}</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Phone size={14} className="text-muted" /> {c.phone}</span>
                                    </div>
                                </td>
                                <td style={{ padding: '1rem' }}>
                                    <span className={`badge ${c.tier.includes('VIP') ? 'badge-primary' : 'badge-secondary'}`}>
                                        {c.tier}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--success)' }}>{c.spent}</td>
                                <td style={{ padding: '1rem' }}>
                                    <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>View Profile</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CRM;
