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
import { useLanguage, type Language } from '../i18n';

const Layout: React.FC = () => {
    const { language, setLanguage, t } = useLanguage();

    const menuItems = [
        { name: t.nav.dashboard, path: '/', icon: <LayoutDashboard size={20} /> },
        { name: t.nav.ecommerce, path: '/ecommerce', icon: <ShoppingCart size={20} /> },
        { name: t.nav.inventory, path: '/inventory', icon: <Package size={20} /> },
        { name: t.nav.orders, path: '/orders', icon: <Truck size={20} /> },
        { name: t.nav.crm, path: '/crm', icon: <Users size={20} /> },
        { name: t.nav.chat, path: '/chat', icon: <MessageSquare size={20} /> },
        { name: t.nav.marketing, path: '/marketing', icon: <TrendingUp size={20} /> },
        { name: t.nav.affiliate, path: '/affiliate', icon: <Handshake size={20} /> },
        { name: t.nav.rag, path: '/rag', icon: <BrainCircuit size={20} /> },
        { name: t.nav.jnac, path: '/jnac', icon: <Bot size={20} />, external: true },
    ];

    const languageOptions: { value: Language; label: string }[] = [
        { value: 'th', label: t.common.thai },
        { value: 'en', label: t.common.english },
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
                        <p className="sidebar-subtitle">{t.layout.sidebarSubtitle}</p>
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
                    <button className="settings-link" title={t.layout.systemSettings}>
                        <Settings size={18} />
                        <span>{t.layout.systemSettings}</span>
                    </button>
                </div>
            </aside>

            <main className="main-content">
                <header className="header">
                    <div className="header-search-container">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder={t.layout.searchPlaceholder}
                            className="header-search-input"
                        />
                        <span className="search-shortcut">
                            <Command size={13} /> K
                        </span>
                    </div>

                    <div className="header-actions">
                        <div className="language-switch" role="group" aria-label={t.common.languageLabel}>
                            {languageOptions.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={language === option.value ? 'active' : ''}
                                    aria-pressed={language === option.value}
                                    onClick={() => setLanguage(option.value)}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <button className="header-icon-btn" title={t.layout.help}>
                            <CircleHelp size={20} />
                        </button>
                        <button className="notification-btn" title={t.layout.notifications}>
                            <Bell size={20} />
                            <span className="notification-dot"></span>
                        </button>
                        <div className="user-profile-trigger">
                            <div className="user-avatar">BJ</div>
                            <div>
                                <div className="user-info-name">Boss Jack</div>
                                <div className="user-info-role">{t.layout.adminWorkspace}</div>
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
