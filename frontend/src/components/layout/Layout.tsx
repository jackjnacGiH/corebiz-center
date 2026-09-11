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
import type { TopBarPageContent } from './TopBar';

export interface LayoutOutletContext {
    setTopBarContent: React.Dispatch<React.SetStateAction<TopBarPageContent | null>>;
}

const Layout: React.FC = () => {
    const { collapsed, mobileOpen, isMobile, toggleCollapsed, openMobile, closeMobile, setMobileOpen } =
        useSidebar();
    const location = useLocation();
    const [topBarContent, setTopBarContent] = React.useState<TopBarPageContent | null>(null);
    const outletContext = React.useMemo<LayoutOutletContext>(() => ({ setTopBarContent }), []);
    const heavyPrefetchStarted = React.useRef(false);

    // Auto-close mobile drawer when route changes
    React.useEffect(() => {
        if (mobileOpen) closeMobile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // Warm the heavy lists shortly after login so the first visit to
    // E-Commerce / Inventory / CRM feels instant (background, best-effort).
    // Shipping has its own targeted search endpoints. Do not make it compete
    // with full product/customer prefetches while its critical data is loading.
    React.useEffect(() => {
        if (heavyPrefetchStarted.current || location.pathname.startsWith('/shipping')) return;
        const t = setTimeout(() => {
            heavyPrefetchStarted.current = true;
            prefetchList(CK.products, () => productsApi.list());
            prefetchList(CK.categories, () => categoriesApi.list());
            prefetchList(CK.warehouses, () => warehousesApi.list());
            prefetchList(CK.customers, () => customersApi.list());
        }, 1200);
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
