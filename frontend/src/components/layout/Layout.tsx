import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import MobileSidebarDrawerHost from './MobileSidebarDrawerHost';
import { useSidebar } from '@/hooks/useSidebar';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BackToTop from '../BackToTop';
import { cn } from '@/lib/utils';
import { useAuth } from '../../lib/AuthProvider';
import type { TopBarPageContent } from './TopBar';

export interface LayoutOutletContext {
    setTopBarContent: React.Dispatch<React.SetStateAction<TopBarPageContent | null>>;
}

const Layout: React.FC = () => {
    const { collapsed, mobileOpen, isMobile, toggleCollapsed, openMobile, closeMobile, setMobileOpen } =
        useSidebar();
    const location = useLocation();
    const { session, profile } = useAuth();
    const [topBarContent, setTopBarContent] = React.useState<TopBarPageContent | null>(null);
    const outletContext = React.useMemo<LayoutOutletContext>(() => ({ setTopBarContent }), []);
    const shippingPrefetchScope = React.useRef('');
    const shippingCacheScope = session && profile && ['owner', 'admin', 'staff'].includes(profile.role)
        ? `${session.user.id}:${profile.role}`
        : '';

    // Auto-close mobile drawer when route changes
    React.useEffect(() => {
        if (mobileOpen) closeMobile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // Shipping is an operational priority. Warm its bounded first page before
    // the much larger catalogue/CRM lists so the first menu click can share the
    // in-flight request or render the session cache immediately.
    React.useEffect(() => {
        if (
            !shippingCacheScope ||
            shippingPrefetchScope.current === shippingCacheScope ||
            // The inbox is a foreground priority on slower connections. Keep
            // speculative Shipping data out of its initial request waterfall.
            location.pathname === '/chat' || location.pathname === '/chat/' ||
            location.pathname.startsWith('/shipping')
        ) return;
        let disposed = false;
        let started = false;
        let completed = false;
        const t = setTimeout(async () => {
            started = true;
            shippingPrefetchScope.current = shippingCacheScope;
            try {
                const { shippingApi } = await import('../../lib/shipping-api');
                if (disposed) return;
                await shippingApi.initial(0, '', { cacheScope: shippingCacheScope });
                completed = true;
            } catch {
                if (!disposed && shippingPrefetchScope.current === shippingCacheScope) {
                    shippingPrefetchScope.current = '';
                }
            }
        }, 150);
        return () => {
            disposed = true;
            clearTimeout(t);
            if (started && !completed && shippingPrefetchScope.current === shippingCacheScope) shippingPrefetchScope.current = '';
        };
    }, [location.pathname, shippingCacheScope]);

    return (
        <div className={cn('app-layout', collapsed && !isMobile && 'app-layout--collapsed')}>
            {/* Desktop sidebar — hidden on mobile, swapped for Sheet drawer */}
            {!isMobile && <Sidebar isCollapsed={collapsed} />}

            {/* Desktop never downloads the mobile-only dialog. */}
            {isMobile && <MobileSidebarDrawerHost open={mobileOpen} onOpenChange={setMobileOpen} onItemClick={closeMobile} />}

            <main className="main-content">
                <TopBar
                    isMobile={isMobile}
                    onToggleSidebar={toggleCollapsed}
                    onOpenMobileMenu={openMobile}
                    pageContent={topBarContent}
                />
                <div className="page-content">
                    <Outlet context={outletContext} />
                </div>
                <BackToTop />
            </main>
        </div>
    );
};

export default Layout;
