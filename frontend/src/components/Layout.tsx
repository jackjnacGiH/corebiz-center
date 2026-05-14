import React, { useState, useRef, useEffect } from 'react';
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
    Store,
    LogOut,
    UserCircle
} from 'lucide-react';
import { useLanguage, type Language } from '../i18n';
import { useAuth } from '../lib/AuthProvider';
import { signOut } from '../lib/auth';

const Layout: React.FC = () => {
    const { language, setLanguage, t } = useLanguage();
    const { profile } = useAuth();
    const [profileMenuOpen, setProfileMenuOpen] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
                setProfileMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const initials = profile?.full_name
        ? profile.full_name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
        : profile?.email?.slice(0, 2).toUpperCase() ?? '??';

    const displayName = profile?.full_name ?? profile?.email ?? 'User';
    const roleLabel = profile?.role
        ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
        : t.layout.adminWorkspace;

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
                        <div className="user-profile-trigger relative" ref={profileMenuRef}>
                            <button
                                type="button"
                                onClick={() => setProfileMenuOpen(o => !o)}
                                className="flex items-center gap-3 cursor-pointer w-full text-left bg-transparent border-0 p-0"
                            >
                                {profile?.avatar_url ? (
                                    <img src={profile.avatar_url} alt={displayName} className="user-avatar rounded-full" />
                                ) : (
                                    <div className="user-avatar">{initials}</div>
                                )}
                                <div>
                                    <div className="user-info-name">{displayName}</div>
                                    <div className="user-info-role">{roleLabel}</div>
                                </div>
                                <ChevronDown size={16} className={`profile-chevron transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {profileMenuOpen && (
                                <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-slate-900 border border-white/10 shadow-2xl shadow-black/50 overflow-hidden z-50">
                                    <div className="px-4 py-3 border-b border-white/5">
                                        <div className="text-sm font-semibold text-white truncate">{displayName}</div>
                                        <div className="text-xs text-slate-400 truncate">{profile?.email}</div>
                                        {profile?.provider && (
                                            <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">
                                                via {profile.provider}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition"
                                        onClick={() => setProfileMenuOpen(false)}
                                    >
                                        <UserCircle size={16} />
                                        {t.layout.adminWorkspace}
                                    </button>
                                    <button
                                        type="button"
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 transition border-t border-white/5"
                                        onClick={() => signOut()}
                                    >
                                        <LogOut size={16} />
                                        {t.layout.signOut}
                                    </button>
                                </div>
                            )}
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
