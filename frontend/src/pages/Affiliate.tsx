import React, { useState } from 'react';
import { 
    Link as LinkIcon, 
    Copy, 
    TrendingUp, 
    ShoppingBag, 
    DollarSign, 
    CheckCircle2, 
    Clock, 
    ExternalLink,
    ChevronRight,
    Search
} from 'lucide-react';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer 
} from 'recharts';

const mockChartData = [
    { name: '01 Apr', sales: 4000, commission: 2400 },
    { name: '02 Apr', sales: 3000, commission: 1398 },
    { name: '03 Apr', sales: 2000, commission: 9800 },
    { name: '04 Apr', sales: 2780, commission: 3908 },
    { name: '05 Apr', sales: 1890, commission: 4800 },
    { name: '06 Apr', sales: 2390, commission: 3800 },
    { name: '07 Apr', sales: 3490, commission: 4300 },
];

const mockRecentReferrals = [
    { id: '1', date: '2026-04-07 14:12', user: 'Somchai Jaidee', order: '#ORD-9921', amount: 12500, commission: 1250, status: 'Success' },
    { id: '2', date: '2026-04-07 11:45', user: 'Wichai Rakthai', order: '#ORD-9918', amount: 3200, commission: 320, status: 'Pending' },
    { id: '3', date: '2026-04-06 20:05', user: 'Anong Sornsin', order: '#ORD-9905', amount: 8400, commission: 840, status: 'Success' },
    { id: '4', date: '2026-04-06 18:30', user: 'Piti Manee', order: '#ORD-9902', amount: 1500, commission: 150, status: 'Success' },
    { id: '5', date: '2026-04-05 09:12', user: 'Somsak King', order: '#ORD-9888', amount: 45000, commission: 4500, status: 'Cancelled' },
];

const Affiliate: React.FC = () => {
    const [referralLink] = useState('https://corebiz.center/ref?id=AFFID9902');
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">ระบบตัวแทนขาย (Affiliate Dashboard)</h1>
                    <p className="text-muted text-sm mt-1">ติดตามประสิทธิภาพการแนะนำเพื่อนและรายได้ของคุณ</p>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-secondary flex items-center gap-2">
                        <DollarSign size={18} /> แจ้งถอนเงิน
                    </button>
                    <button className="btn btn-primary flex items-center gap-2 text-white">
                        <ExternalLink size={18} /> ดูคู่มือตัวแทน
                    </button>
                </div>
            </div>

            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-card p-6 flex items-start justify-between">
                    <div>
                        <p className="text-sm text-muted mb-1">ยอดคลิกลิงก์สะสม</p>
                        <h3 className="text-2xl font-bold">1,452</h3>
                        <span className="text-xs text-green-500 font-medium flex items-center mt-2">
                            <TrendingUp size={12} className="mr-1" /> +12% จากสัปดาห์ที่แล้ว
                        </span>
                    </div>
                    <div className="p-3 rounded-xl bg-primary/10 text-primary">
                        <LinkIcon size={24} />
                    </div>
                </div>
                
                <div className="glass-card p-6 flex items-start justify-between">
                    <div>
                        <p className="text-sm text-muted mb-1">จำนวนออเดอร์ยอดคงเหลือ</p>
                        <h3 className="text-2xl font-bold">84</h3>
                        <span className="text-xs text-green-500 font-medium flex items-center mt-2">
                            <TrendingUp size={12} className="mr-1" /> +5% จากสัปดาห์ที่แล้ว
                        </span>
                    </div>
                    <div className="p-3 rounded-xl bg-orange-500/10 text-orange-500">
                        <ShoppingBag size={24} />
                    </div>
                </div>

                <div className="glass-card p-6 flex items-start justify-between">
                    <div>
                        <p className="text-sm text-muted mb-1">ค่าคอมมิชชันรอเบิก (฿)</p>
                        <h3 className="text-2xl font-bold text-primary">฿12,450.00</h3>
                        <button className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full mt-2 font-medium hover:bg-primary/20 transition-colors">
                            รออนุมัติ: ฿3,200
                        </button>
                    </div>
                    <div className="p-3 rounded-xl bg-green-500/10 text-green-500">
                        <DollarSign size={24} />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Affiliate Link Section */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="glass-card p-6">
                        <h4 className="font-semibold mb-4 flex items-center gap-2">
                            <LinkIcon size={18} className="text-primary" /> ลิงก์แนะนำของคุณ
                        </h4>
                        <p className="text-sm text-muted mb-4">
                            แชร์ลิงก์นี้ให้กับเพื่อนหรือลูกค้าของคุณเพื่อรับค่าคอมมิชชันเมื่อมีการสั่งซื้อ
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-background/50 border border-border rounded-lg mb-4">
                            <input 
                                type="text" 
                                value={referralLink} 
                                readOnly 
                                title="Referral Link"
                                className="bg-transparent border-none focus:ring-0 text-sm flex-1 truncate"
                            />
                            <button 
                                onClick={handleCopy}
                                className={`p-2 rounded-md transition-all ${copied ? 'bg-green-500 text-white' : 'hover:bg-primary/10 text-primary'}`}
                                title="Copy Link"
                            >
                                {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button className="btn btn-secondary text-xs h-9">แชร์ไป Facebook</button>
                            <button className="btn btn-secondary text-xs h-9">แชร์ไป Line</button>
                        </div>
                    </div>

                    <div className="glass-card p-6">
                        <h4 className="font-semibold mb-4">ระดับโปรแกรม (Affiliate Tier)</h4>
                        <div className="space-y-4">
                            <div className="flex justify-between items-end mb-1 text-sm">
                                <span className="font-medium">Silver Member (5%)</span>
                                <span className="text-xs text-muted">เป้าหมาย: ฿100,000</span>
                            </div>
                            <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                                <div className="bg-primary h-full w-[65%]"></div>
                            </div>
                            <p className="text-xs text-muted text-center">
                                มียอดขายสะสมอีกเพียง ฿35,000 เพื่อเลื่อนเป็น Gold (8%)
                            </p>
                        </div>
                    </div>
                </div>

                {/* Performance Chart */}
                <div className="lg:col-span-2 glass-card p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="font-semibold">สถิติผลตอบแทน (ย้อนหลัง 7 วัน)</h4>
                        <select className="bg-background border border-border rounded-md px-2 py-1 text-xs" title="Select time range">
                            <option>7 วันล่าสุด</option>
                            <option>30 วันล่าสุด</option>
                        </select>
                    </div>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={mockChartData}>
                                <defs>
                                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis 
                                    dataKey="name" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fontSize: 12, fill: 'var(--text-muted)'}}
                                />
                                <YAxis 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fontSize: 12, fill: 'var(--text-muted)'}}
                                />
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'rgba(23, 23, 23, 0.95)', 
                                        borderRadius: '12px', 
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)'
                                    }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="sales" 
                                    stroke="var(--primary)" 
                                    fillOpacity={1} 
                                    fill="url(#colorSales)" 
                                    strokeWidth={3}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 mt-6 pt-6 border-t border-border/50">
                        <div className="text-center border-r border-border/50">
                            <p className="text-xs text-muted">Conversion Rate</p>
                            <p className="text-lg font-bold">5.78%</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-muted">เฉลี่ยต่อออเดอร์</p>
                            <p className="text-lg font-bold">฿1,480</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Referrals Table */}
            <div className="glass-card overflow-hidden">
                <div className="p-6 border-b border-border/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h4 className="font-semibold">รายชื่อผู้สมัครหรือออเดอร์ล่าสุด</h4>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                        <input 
                            type="text" 
                            placeholder="ค้นหาลูกค้า/ออเดอร์..." 
                            title="Search referrals"
                            className="pl-10 pr-4 py-1.5 bg-background/50 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none transition-all w-full md:w-64"
                        />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-muted/30 text-xs font-semibold text-muted uppercase tracking-wider">
                                <th className="px-6 py-4">วันที่ - เวลา</th>
                                <th className="px-6 py-4">ลูกค้า / เลขออเดอร์</th>
                                <th className="px-6 py-4 text-right">ยอดสั่งซื้อ</th>
                                <th className="px-6 py-4 text-center">สถานะค่าคอมมิชชัน</th>
                                <th className="px-6 py-4 text-right">ค่าคอมมิชชัน</th>
                                <th className="px-6 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {mockRecentReferrals.map((item) => (
                                <tr key={item.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-4 text-sm font-medium">
                                        <p>{item.date.split(' ')[0]}</p>
                                        <p className="text-xs text-muted font-normal">{item.date.split(' ')[1]}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                                {item.user.split(' ')[0][0]}{item.user.split(' ')[1]?.[0] || ''}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold">{item.user}</p>
                                                <p className="text-xs text-muted">{item.order}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-semibold text-right">
                                        ฿{item.amount.toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                            item.status === 'Success' ? 'bg-green-500/10 text-green-500' :
                                            item.status === 'Pending' ? 'bg-orange-500/10 text-orange-500' :
                                            'bg-red-500/10 text-red-500'
                                        }`}>
                                            {item.status === 'Pending' && <Clock size={12} className="mr-1" />}
                                            {item.status === 'Success' && <CheckCircle2 size={12} className="mr-1" />}
                                            {item.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-bold text-primary text-right">
                                        ฿{item.commission.toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-1 rounded-md text-muted hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all" title="View details">
                                            <ChevronRight size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-border/50 flex items-center justify-center">
                    <button className="text-sm font-medium text-primary hover:underline">ดูประวัติทั้งหมด</button>
                </div>
            </div>
        </div>
    );
};

export default Affiliate;
