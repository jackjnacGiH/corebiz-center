import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, ShoppingCart, Package, Users, ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react';
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

const Dashboard = () => {
    return (
        <div className="animate-fade-in space-y-8">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                        Executive Dashboard
                    </h1>
                    <p className="text-slate-400 mt-1">Welcome back. Here's your platform overview.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button className="btn btn-secondary text-sm">Download Logs</button>
                    <button className="btn btn-primary text-sm shadow-lg shadow-indigo-500/20">Generate Report</button>
                </div>
            </div>

            <N8nAssistant />

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { title: 'Total Revenue', value: '฿1,245,000', change: '+14.5%', icon: <TrendingUp size={20} />, colorCls: 'text-emerald-400', bgCls: 'bg-emerald-500/10', isUp: true },
                    { title: 'Active Orders', value: '342', change: '+5.2%', icon: <ShoppingCart size={20} />, colorCls: 'text-indigo-400', bgCls: 'bg-indigo-500/10', isUp: true },
                    { title: 'Low Stock Items', value: '18', change: '-2.4%', icon: <Package size={20} />, colorCls: 'text-amber-400', bgCls: 'bg-amber-500/10', isUp: false },
                    { title: 'New Customers', value: '1,204', change: '+22.1%', icon: <Users size={20} />, colorCls: 'text-rose-400', bgCls: 'bg-rose-500/10', isUp: true },
                ].map((kpi, index) => (
                    <div key={index} className="glass-card group hover:translate-y-[-4px] transition-all duration-300">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`${kpi.colorCls} ${kpi.bgCls} p-2.5 rounded-xl`}>
                                {kpi.icon}
                            </div>
                            <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${kpi.isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                {kpi.isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                {kpi.change}
                            </div>
                        </div>
                        <h3 className="text-slate-400 text-sm font-medium">{kpi.title}</h3>
                        <div className="text-2xl font-bold mt-1 text-white tracking-tight">{kpi.value}</div>
                    </div>
                ))}
            </div>

            {/* Charts & Activity Section */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Main Chart */}
                <div className="glass-card xl:col-span-2 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-xl font-bold text-white">Sales Performance</h2>
                            <p className="text-slate-400 text-sm">Year to date revenue analysis</p>
                        </div>
                        <select 
                    title="Select Time Range"
                    className="bg-slate-800/50 border border-white/10 rounded-lg text-xs px-3 py-1.5 text-slate-300 outline-none"
                >
                            <option>Last 7 Months</option>
                            <option>Last 12 Months</option>
                        </select>
                    </div>
                    <div className="h-[320px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data}>
                                <defs>
                                    <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.1}/>
                                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis 
                                    dataKey="name" 
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }} 
                                    dy={10}
                                />
                                <YAxis 
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    tickFormatter={(v) => `฿${v / 1000}k`}
                                />
                                <Tooltip
                                    cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                    itemStyle={{ color: '#fff', fontSize: '14px', fontWeight: 'card-bold' }}
                                    labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="sales" 
                                    stroke="var(--primary)" 
                                    strokeWidth={4} 
                                    dot={{ r: 4, fill: 'var(--primary)', strokeWidth: 2, stroke: '#1e293b' }} 
                                    activeDot={{ r: 8, strokeWidth: 0 }}
                                    animationDuration={1500}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="glass-card flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-white">Live Activity</h2>
                        <span className="text-indigo-400 bg-indigo-500/10 p-2 rounded-lg">
                            <Activity size={18} />
                        </span>
                    </div>
                    <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        {[
                            { msg: 'Order #4829 shipped to Bangkok', time: '10 mins ago', type: 'order', color: 'bg-blue-500' },
                            { msg: 'New Distributor Signed Up', time: '1 hour ago', type: 'user', color: 'bg-indigo-500' },
                            { msg: 'Stock alert: iPhone 15 Pro Max', time: '3 hours ago', type: 'stock', color: 'bg-amber-500' },
                            { msg: 'Payment received ฿12,500', time: '5 hours ago', type: 'finance', color: 'bg-emerald-500' },
                            { msg: 'System backup completed', time: '8 hours ago', type: 'system', color: 'bg-slate-500' },
                        ].map((activity, index) => (
                            <div key={index} className="flex gap-4 group">
                                <div className="relative">
                                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 z-10 relative ${activity.color} shadow-[0_0_8px_rgba(255,255,255,0.2)]`} />
                                    {index !== 4 && <div className="absolute top-4 left-[4.5px] w-[1px] h-full bg-white/10" />}
                                </div>
                                <div className="pb-4">
                                    <div className="text-sm font-semibold text-slate-200 group-hover:text-indigo-400 transition-colors duration-200">{activity.msg}</div>
                                    <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-bold">{activity.time}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="w-full mt-4 py-2 text-xs font-bold text-slate-400 hover:text-white border border-white/5 hover:border-white/10 rounded-lg transition-all duration-200">
                        View All Activity
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
