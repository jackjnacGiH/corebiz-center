import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    MessageSquare,
    TrendingUp,
    Settings,
    Bell,
    Search,
    BrainCircuit
} from 'lucide-react';

const Layout: React.FC = () => {
    const menuItems = [
        { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> },
        { name: 'E-Commerce', path: '/ecommerce', icon: <ShoppingCart size={20} /> },
        { name: 'Inventory', path: '/inventory', icon: <Package size={20} /> },
        { name: 'CRM & Customers', path: '/crm', icon: <Users size={20} /> },
        { name: 'Omni-Chat', path: '/chat', icon: <MessageSquare size={20} /> },
        { name: 'Marketing & Affiliates', path: '/marketing', icon: <TrendingUp size={20} /> },
        { name: 'Openclaw RAG', path: '/rag', icon: <BrainCircuit size={20} /> },
    ];

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className="sidebar">
                <div style={{ padding: '2rem 1.5rem', borderBottom: '1px solid var(--panel-border)' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, background: 'linear-gradient(45deg, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        CoreBiz Center
                    </h2>
                    <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>Unified Commerce Platform</p>
                </div>

                <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {menuItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            style={({ isActive }) => ({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                color: isActive ? '#fff' : 'var(--text-muted)',
                                background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                                borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                                transition: 'var(--transition)',
                                fontWeight: isActive ? 600 : 500
                            })}
                        >
                            {item.icon}
                            {item.name}
                        </NavLink>
                    ))}
                </nav>

                <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)' }}>
                    <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                        <Settings size={20} /> Settings
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {/* Header */}
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '300px' }} className="glass-card">
                        <Search size={18} className="text-muted" />
                        <input
                            type="text"
                            placeholder="Search anything..."
                            style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%' }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                        <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', position: 'relative' }}>
                            <Bell size={22} />
                            <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: 'var(--danger)', borderRadius: '50%' }}></span>
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--secondary), var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                ADMIN
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>System Admin</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Super User</div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Dynamic Page Content */}
                <div className="page-content">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default Layout;
