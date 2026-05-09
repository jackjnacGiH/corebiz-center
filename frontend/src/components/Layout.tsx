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
    Handshake,
    Bot,
    ChevronDown,
    CircleHelp,
    Command,
    Store
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
        { name: 'JNAC Admin Chat', path: '/jnac', icon: <Bot size={20} />, external: true },
    ];

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="brand-mark">
                        <Store size={20} />
                    </div>
                    <div>
                        <h2 className="sidebar-logo">CoreBiz Center</h2>
                        <p className="sidebar-subtitle">Commerce operations</p>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {menuItems.map((item) =>
                        item.external ? (
                            <a key={item.path} href={item.path} className="nav-link">
                                {item.icon}
                                {item.name}
                            </a>
                        ) : (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                            >
                                {item.icon}
                                {item.name}
                            </NavLink>
                        )
                    )}
                </nav>

                <div className="sidebar-footer">
                    <button className="settings-link" title="System Settings">
                        <Settings size={18} />
                        <span>System settings</span>
                    </button>
                </div>
            </aside>

            <main className="main-content">
                <header className="header">
                    <div className="header-search-container">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Search orders, products, customers..."
                            className="header-search-input"
                        />
                        <span className="search-shortcut">
                            <Command size={13} /> K
                        </span>
                    </div>

                    <div className="header-actions">
                        <button className="header-icon-btn" title="Help">
                            <CircleHelp size={20} />
                        </button>
                        <button className="notification-btn" title="Notifications">
                            <Bell size={20} />
                            <span className="notification-dot"></span>
                        </button>
                        <div className="user-profile-trigger">
                            <div className="user-avatar">BJ</div>
                            <div>
                                <div className="user-info-name">Boss Jack</div>
                                <div className="user-info-role">Admin workspace</div>
                            </div>
                            <ChevronDown size={16} className="profile-chevron" />
                        </div>
                    </div>
                </header>

                <div className="page-content">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default Layout;
