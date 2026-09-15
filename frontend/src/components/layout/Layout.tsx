import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useSidebar } from '@/hooks/useSidebar';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BackToTop from '../BackToTop';
import { cn } from '@/lib/utils';
import { prefetchList, CK } from '../../lib/cache';
import { productsApi, customersApi, categoriesApi, warehousesApi } from '../../lib/api';
import { shippingApi } from '../../lib/shipping-api';
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
    const heavyPrefetchStarted = React.useRef(false);
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
            location.pathname.startsWith('/shipping')
        ) return;
        const t = setTimeout(() => {
            shippingPrefetchScope.current = shippingCacheScope;
            void shippingApi.initial(0, '', { cacheScope: shippingCacheScope }).catch(() => {
                if (shippingPrefetchScope.current === shippingCacheScope) {
                    shippingPrefetchScope.current = '';
                }
            });
        }, 150);
        return () => clearTimeout(t);
    }, [location.pathname, shippingCacheScope]);

    // Warm the heavy lists after the Shipping request has had a head start.
    // These remain background-only and never block route rendering.
    React.useEffect(() => {
        if (heavyPrefetchStarted.current || location.pathname.startsWith('/shipping')) return;
        const t = setTimeout(() => {
            heavyPrefetchStarted.current = true;
            prefetchList(CK.products, () => productsApi.list());
            prefetchList(CK.categories, () => categoriesApi.list());
            prefetchList(CK.warehouses, () => warehousesApi.list());
            prefetchList(CK.customers, () => customersApi.list());
        }, 2500);
        return () => clearTimeout(t);
    }, [location.pathname]);

    return (
        <div className={cn('app-layout', collapsed && !isMobile && 'app-layout--collapsed')}>
            {/* Desktop sidebar — hidden on mobile, swapped for Sheet drawer */}
            {!isMobile && <Sidebar isCollapsed={collapsed} />}

            {/* Mobile drawer — radix-ui Sheet */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                    side="left"
                    className="p-0 w-[85vw] max-w-[320px] sm:w-[280px] sm:max-w-[280px]"
                    showCloseButton={false}
                >
                    {/* Visually-hidden title for screen readers (radix requires it) */}
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <Sidebar isMobile onItemClick={closeMobile} />
                </SheetContent>
            </Sheet>

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
