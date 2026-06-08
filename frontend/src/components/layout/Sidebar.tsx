import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    MessageSquare,
    TrendingUp,
    BrainCircuit,
    Truck,
    Handshake,
    Settings,
    Store,
} from 'lucide-react';
import { useLanguage } from '../../i18n';
import { cn } from '@/lib/utils';
import QuickLinksMenu from './QuickLinksMenu';

export interface SidebarProps {
    /** Desktop rail mode: collapse to 64px and show icons only */
    isCollapsed?: boolean;
    /** Inside mobile Sheet drawer. Always full-width text + close-on-click. */
    isMobile?: boolean;
    /** Called when a nav item is clicked — used to close mobile drawer */
    onItemClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
    isCollapsed = false,
    isMobile = false,
    onItemClick,
}) => {
    const { t } = useLanguage();
    const navigate = useNavigate();

    // When inside mobile Sheet, never render in collapsed form
    const collapsed = !isMobile && isCollapsed;

    function goSettings() {
        navigate('/settings');
        onItemClick?.();
    }

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
    ];

    return (
        <aside
            className={cn(
                'sidebar',
                collapsed && 'sidebar--collapsed',
                isMobile && 'sidebar--mobile',
            )}
            data-collapsed={collapsed ? 'true' : 'false'}
            aria-label={t.layout.sidebarSubtitle}
        >
            {/* Brand */}
            <div className="sidebar-header">
                <div className="brand-mark" aria-hidden="true">
                    <Store size={20} />
                </div>
                {!collapsed && (
                    <div className="min-w-0">
                        <h2 className="sidebar-logo truncate">CoreBiz Center</h2>
                        <p className="sidebar-subtitle truncate">{t.layout.sidebarSubtitle}</p>
                    </div>
                )}
            </div>

            {/* Nav */}
            <nav className="sidebar-nav">
                {menuItems.map((item, idx) => (
                    <React.Fragment key={item.path}>
                        <NavLink
                            to={item.path}
                            end={item.path === '/'}
                            onClick={onItemClick}
                            className={({ isActive }) =>
                                cn('nav-link', isActive && 'active', collapsed && 'nav-link--collapsed')
                            }
                            title={collapsed ? item.name : undefined}
                        >
                            {item.icon}
                            {!collapsed && <span className="truncate">{item.name}</span>}
                        </NavLink>
                        {/* "Link>>" quick-links menu sits 2nd, right under Dashboard */}
                        {idx === 0 && (
                            <QuickLinksMenu collapsed={collapsed} onItemClick={onItemClick} />
                        )}
                    </React.Fragment>
                ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
                <button
                    type="button"
                    onClick={goSettings}
                    className={cn('settings-link', collapsed && 'settings-link--collapsed')}
                    title={collapsed ? t.layout.systemSettings : undefined}
                >
                    <Settings size={18} />
                    {!collapsed && <span>{t.layout.systemSettings}</span>}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
