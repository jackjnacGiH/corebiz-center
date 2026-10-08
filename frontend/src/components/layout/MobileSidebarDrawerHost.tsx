import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';

export interface MobileSidebarDrawerProps { open: boolean; onOpenChange: (open: boolean) => void; onItemClick: () => void }

let pendingModule: Promise<typeof import('./MobileSidebarDrawer')> | null = null;
function loadDrawer() {
  pendingModule ??= import('./MobileSidebarDrawer').catch((error: unknown) => { pendingModule = null; throw error; });
  return pendingModule;
}

/** Dialog code is optional until mobile navigation opens; import failures stay
 * inside this drawer so the current page and its drafts remain mounted. */
export default function MobileSidebarDrawerHost(props: MobileSidebarDrawerProps) {
  const { open, onOpenChange } = props;
  const [Drawer, setDrawer] = useState<ComponentType<MobileSidebarDrawerProps> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fallbackRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open || Drawer) return;
    let disposed = false;
    setError(false);
    void loadDrawer().then((module) => { if (!disposed) setDrawer(() => module.default); })
      .catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [open, Drawer, attempt]);
  useEffect(() => {
    const dialog = fallbackRef.current;
    if (!open || Drawer || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open, Drawer]);
  if (Drawer) return <Drawer {...props} />;
  if (!open) return null;
  return (
    <dialog ref={fallbackRef} aria-label="Navigation" onCancel={(event) => { event.preventDefault(); onOpenChange(false); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onOpenChange(false);
      }}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[85vw] max-w-[320px] border-0 bg-white p-5 shadow-lg backdrop:bg-black/50 sm:w-[280px] sm:max-w-[280px]">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm">Navigation</strong>
        <button autoFocus type="button" onClick={() => onOpenChange(false)} className="rounded-md border px-3 py-1.5 text-xs">ปิด</button>
      </div>
      {error ? <div role="alert" className="mt-6 text-sm text-red-700">
        โหลดเมนูไม่สำเร็จ
        <button type="button" className="mt-3 block rounded-md border px-3 py-2 text-neutral-700" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>ลองใหม่</button>
      </div> : <div role="status" className="mt-6 flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" /> กำลังโหลดเมนู…</div>}
    </dialog>
  );
}
