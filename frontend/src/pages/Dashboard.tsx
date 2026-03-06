import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, ShoppingCart, Package, Users } from 'lucide-react';
import N8nAssistant from '../components/N8nAssistant';

const data = [
    { name: 'Jan', sales: 4000 },
    { name: 'Feb', sales: 3000 },
    { name: 'Mar', sales: 2000 },
    { name: 'Apr', sales: 2780 },
    { name: 'May', sales: 1890 },
    { name: 'Jun', sales: 2390 },
    { name: 'Jul', sales: 3490 },
];

const Dashboard: React.FC = () => {
    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 className="text-2xl font-bold">Executive Dashboard</h1>
                    <p className="text-muted">Welcome back. Here's your platform overview.</p>
                </div>
                <button className="btn btn-primary">Generate Report</button>
            </div>

            <N8nAssistant />

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-6 mb-6">
                {[
                    { title: 'Total Revenue', value: '฿1,245,000', change: '+14%', icon: <TrendingUp />, color: 'var(--success)' },
                    { title: 'Active Orders', value: '342', change: '+5%', icon: <ShoppingCart />, color: 'var(--primary)' },
                    { title: 'Low Stock Items', value: '18', change: '-2%', icon: <Package />, color: 'var(--warning)' },
                    { title: 'New Customers', value: '1,204', change: '+22%', icon: <Users />, color: 'var(--secondary)' },
                ].map((kpi, index) => (
                    <div key={index} className="glass-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <div style={{ color: kpi.color, padding: '0.5rem', background: `rgba(255, 255, 255, 0.05)`, borderRadius: '8px' }}>
                                {kpi.icon}
                            </div>
                            <span className="badge badge-success">{kpi.change}</span>
                        </div>
                        <h3 className="text-muted text-sm">{kpi.title}</h3>
                        <div className="text-2xl font-bold mt-2">{kpi.value}</div>
                    </div>
                ))}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-3 gap-6">
                <div className="glass-card" style={{ gridColumn: 'span 2' }}>
                    <h2 className="text-xl font-bold mb-4">Sales Overview (YTD)</h2>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="name" stroke="var(--text-muted)" />
                                <YAxis stroke="var(--text-muted)" />
                                <Tooltip
                                    contentStyle={{ background: 'rgba(15, 17, 26, 0.9)', border: '1px solid var(--panel-border)', borderRadius: '8px' }}
                                    itemStyle={{ color: 'var(--primary)' }}
                                />
                                <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 8 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card">
                    <h2 className="text-xl font-bold mb-4">Recent Activity</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {[
                            { msg: 'Order #4829 shipped to Bangkok', time: '10 mins ago', type: 'order' },
                            { msg: 'New Distributor Signed Up', time: '1 hour ago', type: 'user' },
                            { msg: 'Stock alert: iPhone 15 Pro Max', time: '3 hours ago', type: 'stock' },
                            { msg: 'Payment received ฿12,500', time: '5 hours ago', type: 'finance' },
                        ].map((activity, index) => (
                            <div key={index} style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)', marginTop: 5 }} />
                                <div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{activity.msg}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{activity.time}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
