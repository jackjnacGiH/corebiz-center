import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Floating "กลับขึ้นด้านบน" (back-to-top) button.
 *
 * Mounted once in the app Layout. It watches the window scroll position and
 * only appears after the user has scrolled past `threshold` px — so it shows up
 * on long, scrollable pages (catalog, inventory, CRM, …) and stays hidden on
 * short pages or full-height views (e.g. chat) where the window never scrolls.
 * Clicking smooth-scrolls back to the top.
 *
 * z-40 keeps it above normal page content but below modal/drawer overlays
 * (z-50 and up), so it tucks behind dialogs instead of floating over them.
 */
export default function BackToTop({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll(); // sync on mount / route change
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [threshold]);

  return (
    <button
      type="button"
      aria-label="กลับขึ้นด้านบน"
      title="กลับขึ้นด้านบน"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'fixed bottom-5 right-5 z-40 grid place-items-center h-11 w-11 rounded-full',
        'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 ring-1 ring-black/5',
        'transition-all duration-200 ease-out hover:bg-indigo-700 hover:-translate-y-0.5',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-3 pointer-events-none',
      )}
    >
      <ArrowUp size={20} />
    </button>
  );
}
