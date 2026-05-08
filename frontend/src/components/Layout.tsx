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
    BrainCircuit,
    Truck,
    Handshake
} from 'lucide-react';

const Layout: React.FC = () => {
    const menuItems = [
        { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> },
        { name: 'E-Commerce', path: '/ecommerce', icon: <ShoppingCart size={20} /> },
        { name: 'Inventory', path: '/inventory', icon: <Package size={20} /> },
        { name: 'Orders', path: '/orders', icon: <Truck size={20} /> },
        { name: 'CRM & Customers', path: '/crm', icon: <Users size={20} /> },
        { name: 'Omni-Chat', path: '/chat', icon: <MessageSquare size={20} /> },
        { name: 'Marketing & Affiliates', path: '/marketing', icon: <TrendingUp size={20} /> },
        { name: 'Affiliate', path: '/affiliate', icon: <Handshake size={20} /> },
        { name: 'Openclaw RAG', path: '/rag', icon: <BrainCircuit size={20} /> },
    ];

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <h2 className="sidebar-logo">
                        CoreBiz Center
                    </h2>
                    <p className="text-sm text-muted mt-1">Unified Commerce Platform</p>
                </div>

                <nav className="sidebar-nav">
                    {menuItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        >
                            {item.icon}
                            {item.name}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <button className="btn btn-secondary w-full justify-start" title="System Settings">
                        <Settings size={20} /> Settings
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {/* Header */}
                <header className="header">
                    <div className="header-search-container glass-card">
                        <Search size={18} className="text-muted" />
                        <input
                            type="text"
                            placeholder="Search anything..."
                            className="header-search-input"
                        />
                    </div>

                    <div className="header-actions">
                        <button className="notification-btn" title="Notifications">
                            <Bell size={22} />
                            <span className="notification-dot"></span>
                        </button>
                        <div className="user-profile-trigger">
                            <div className="user-avatar">
                                ADMIN
                            </div>
                            <div>
                                <div className="user-info-name">System Admin</div>
                                <div className="user-info-role">Super User</div>
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
