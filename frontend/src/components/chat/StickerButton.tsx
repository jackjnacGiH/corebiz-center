import { useEffect, useRef, useState } from 'react';
import { Sticker, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Composer button + popover that sends a sticker into the chat — one tap, like
 * LINE. Stickers are static PNGs hosted under the app's public folder
 * (/center/stickers/sticker_NN.png), so a sticker is just an already-hosted
 * image: clicking one sends `![image](absoluteUrl)` which line-push turns into
 * a native LINE image message and the web widget renders inline. No upload,
 * no backend change.
 */

const COUNT = 15;
const pad = (n: number) => String(n).padStart(2, '0');

/** Absolute URL — LINE's image message needs a public https URL, not relative. */
export function stickerUrl(n: number): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base}stickers/sticker_${pad(n)}.png`;
}

export default function StickerButton({
  onSend,
  disabled,
}: {
  /** Called with the sticker's absolute URL when one is picked. */
  onSend: (url: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(n: number) {
    setOpen(false);
    void onSend(stickerUrl(n));
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="ส่งสติกเกอร์"
        className={cn(
          'grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'text-indigo-600 bg-indigo-50',
        )}
      >
        <Sticker size={18} />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-30 w-[300px] rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
            <span className="text-xs font-bold text-neutral-700 inline-flex items-center gap-1.5">
              <Sticker size={13} className="text-indigo-500" /> สติกเกอร์
            </span>
            <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
              <X size={15} />
            </button>
          </div>
          <div className="p-2 grid grid-cols-4 gap-1.5 max-h-[260px] overflow-y-auto">
            {Array.from({ length: COUNT }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => pick(n)}
                title={`สติกเกอร์ ${n}`}
                className="aspect-square rounded-lg hover:bg-indigo-50 active:scale-95 p-1 transition"
              >
                <img
                  src={stickerUrl(n)}
                  alt={`sticker ${n}`}
                  loading="lazy"
                  className="w-full h-full object-contain"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
