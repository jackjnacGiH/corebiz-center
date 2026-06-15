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

const Layout: React.FC = () => {
    const { collapsed, mobileOpen, isMobile, toggleCollapsed, openMobile, closeMobile, setMobileOpen } =
        useSidebar();
    const location = useLocation();

    // Auto-close mobile drawer when route changes
    React.useEffect(() => {
        if (mobileOpen) closeMobile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // Warm the heavy lists shortly after login so the first visit to
    // E-Commerce / Inventory / CRM feels instant (background, best-effort).
    // Deferred so it doesn't compete with the landing page's own fetch.
    React.useEffect(() => {
        const t = setTimeout(() => {
            prefetchList(CK.products, () => productsApi.list());
            prefetchList(CK.categories, () => categoriesApi.list());
            prefetchList(CK.warehouses, () => warehousesApi.list());
            prefetchList(CK.customers, () => customersApi.list());
        }, 1200);
        return () => clearTimeout(t);
    }, []);

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
                />
                <div className="page-content">
                    <Outlet />
                </div>
                <BackToTop />
            </main>
        </div>
    );
};

export default Layout;
