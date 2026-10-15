import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** Defer closed tools, then keep their original mounted lifecycle after first use. */
export default function DeferredContent({ active, children }: { active: boolean; children: ReactNode }) {
    const [opened, setOpened] = useState(active);
    useEffect(() => { if (active) setOpened(true); }, [active]);
    if (!active && !opened) return null;
    return <Suspense fallback={active ? <div role="status" aria-label="Loading" className="flex justify-center p-4"><Loader2 size={20} className="animate-spin text-neutral-400" /></div> : null}>
        {children}
    </Suspense>;
}
