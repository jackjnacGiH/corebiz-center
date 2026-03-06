import React from 'react';
import { Target, BarChart2, Zap } from 'lucide-react';

const Marketing: React.FC = () => {
    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">Marketing & Affiliates</h1>
                    <p className="text-muted">Manage promotions, automation, and dropship networks</p>
                </div>
                <button className="btn btn-primary"><Zap size={18} /> Create Campaign</button>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="glass-card">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Target size={20} className="text-primary" /> Active Campaigns</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {[
                            { name: '11.11 Flash Sale', status: 'Running', conversion: '4.5%' },
                            { name: 'Abandoned Cart Recovery (Email)', status: 'Automated', conversion: '12.8%' },
                            { name: 'Welcome Pop-up Discount', status: 'Automated', conversion: '8.2%' },
                        ].map((c, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Conversion Rate: <span className="text-success">{c.conversion}</span></div>
                                </div>
                                <span className={`badge ${c.status === 'Running' ? 'badge-primary' : 'badge-warning'}`}>{c.status}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glass-card">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><BarChart2 size={20} className="text-secondary" /> Affiliate / Dropship Network</h2>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div style={{ padding: '1rem', background: 'rgba(236, 72, 153, 0.1)', borderRadius: '8px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Total Agents</div>
                            <div className="text-2xl font-bold mt-1">452</div>
                        </div>
                        <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600, textTransform: 'uppercase' }}>Total Sales by Agents</div>
                            <div className="text-2xl font-bold mt-1">฿450,200</div>
                        </div>
                    </div>
                    <button className="btn btn-secondary w-full" style={{ width: '100%' }}>View Affiliate Dashboard</button>
                </div>
            </div>
        </div>
    );
};

export default Marketing;
