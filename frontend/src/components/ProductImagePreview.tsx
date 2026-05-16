import { useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProductImagePreviewProps {
    /** All public image URLs for the product. First item is the hero image. */
    images: string[];
    /** Used as `alt` text on the rendered images */
    alt: string;
}

/**
 * Hover-card body that shows a single product's full image gallery:
 *   ┌───────────────────────────────┐
 *   │                               │
 *   │      ACTIVE IMAGE             │  ← 280×280, object-contain
 *   │      (right-click to save)    │
 *   │                               │
 *   ├───────────────────────────────┤
 *   │ [t1][t2][t3][t4][t5]   1/5    │  ← thumbnails 40px, hover to switch
 *   ├───────────────────────────────┤
 *   │ คลิกขวาเพื่อ copy / save รูป      │  ← hint
 *   └───────────────────────────────┘
 *
 * `<img>` is rendered as a normal element (no `pointer-events-none`,
 * no `onContextMenu` handler) so the browser's native context menu
 * — including "Copy image" / "Save image as…" — works unmodified.
 */
export default function ProductImagePreview({ images, alt }: ProductImagePreviewProps) {
    const [activeIdx, setActiveIdx] = useState(0);
    if (images.length === 0) return null;

    const safeIdx = Math.min(activeIdx, images.length - 1);
    const activeUrl = images[safeIdx];

    return (
        <div className="w-[320px] flex flex-col">
            {/* Main image */}
            <div className="bg-white p-2 flex items-center justify-center">
                <img
                    src={activeUrl}
                    alt={`${alt} — รูปที่ ${safeIdx + 1}`}
                    className="w-full h-[280px] object-contain rounded"
                />
            </div>

            {/* Thumbnail row (only when there's more than one image) */}
            {images.length > 1 && (
                <div className="flex items-center gap-1.5 px-2 py-2 bg-neutral-50 border-t border-neutral-200">
                    <div className="flex gap-1.5 overflow-x-auto flex-1">
                        {images.map((url, i) => (
                            <button
                                key={`${url}-${i}`}
                                type="button"
                                onMouseEnter={() => setActiveIdx(i)}
                                onFocus={() => setActiveIdx(i)}
                                onClick={() => setActiveIdx(i)}
                                className={cn(
                                    'w-11 h-11 rounded-md border-2 overflow-hidden flex-shrink-0 transition bg-white',
                                    i === safeIdx
                                        ? 'border-indigo-500 ring-1 ring-indigo-200'
                                        : 'border-neutral-200 opacity-60 hover:opacity-100 hover:border-neutral-300',
                                )}
                                title={`รูปที่ ${i + 1}`}
                            >
                                <img
                                    src={url}
                                    alt=""
                                    className="w-full h-full object-cover pointer-events-none"
                                    draggable={false}
                                />
                            </button>
                        ))}
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-neutral-500 flex-shrink-0 px-1">
                        {safeIdx + 1}/{images.length}
                    </span>
                </div>
            )}

            {/* Right-click hint */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-50 border-t border-neutral-200 text-[10px] text-neutral-500">
                <MousePointerClick size={11} />
                คลิกขวาที่รูปเพื่อ Copy / Save
            </div>
        </div>
    );
}
