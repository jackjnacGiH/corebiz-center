import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'corebiz.sidebar.collapsed';
const MOBILE_BREAKPOINT = 768; // matches Tailwind md:

function readCollapsed(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Sidebar state with three concerns:
 *   - `collapsed`   : desktop "rail mode" (240 → 64 px). Persisted in localStorage.
 *   - `mobileOpen`  : mobile drawer open/close (Sheet).
 *   - `isMobile`    : derived from window width; controls which UI we render.
 *
 * Also wires Cmd/Ctrl+B to toggle collapse on desktop.
 */
export function useSidebar() {
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
    const [mobileOpen, setMobileOpen] = useState<boolean>(false);
    const [isMobile, setIsMobile] = useState<boolean>(() =>
        typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT,
    );

    // Persist collapsed flag
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
        } catch {
            /* ignore quota / private mode */
        }
    }, [collapsed]);

    // Track viewport size
    useEffect(() => {
        function onResize() {
            const mobile = window.innerWidth < MOBILE_BREAKPOINT;
            setIsMobile(mobile);
            if (!mobile) setMobileOpen(false); // close drawer when growing past breakpoint
        }
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Cmd/Ctrl + B → toggle collapse (desktop only)
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                if (window.innerWidth >= MOBILE_BREAKPOINT) {
                    setCollapsed((c) => !c);
                }
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
    const openMobile = useCallback(() => setMobileOpen(true), []);
    const closeMobile = useCallback(() => setMobileOpen(false), []);

    return {
        collapsed,
        mobileOpen,
        isMobile,
        toggleCollapsed,
        openMobile,
        closeMobile,
        setMobileOpen,
    };
}
