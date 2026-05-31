import {
    useEffect,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { X, Maximize2, Loader2, Send } from 'lucide-react';

/**
 * Capture a single still frame of the screen / a window / a tab using the
 * browser Screen Capture API and return it as a PNG data-URL.
 *
 * We grab exactly one frame then immediately stop the track, so there's no
 * lingering "you are sharing your screen" bar — it behaves like a one-shot
 * screenshot. Requires a secure context (HTTPS or localhost); production is
 * HTTPS so this works. Throws if the browser has no getDisplayMedia, and
 * rejects with NotAllowedError / AbortError if the user dismisses the picker
 * (callers treat that as a silent cancel).
 */
export async function captureScreen(): Promise<string> {
    const md = navigator.mediaDevices;
    if (!md || typeof md.getDisplayMedia !== 'function') {
        throw new Error('เบราว์เซอร์นี้ไม่รองรับการจับภาพหน้าจอ — ลองใช้ Chrome/Edge เวอร์ชันล่าสุด');
    }
    const stream = await md.getDisplayMedia({ video: true, audio: false });
    try {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => resolve();
        });
        await video.play();
        // Let one frame paint before grabbing it.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('ไม่สามารถอ่านภาพหน้าจอได้');
        ctx.drawImage(video, 0, 0);
        return canvas.toDataURL('image/png');
    } finally {
        stream.getTracks().forEach((t) => t.stop());
    }
}

interface Rect { x: number; y: number; w: number; h: number }

const MAX_SIDE = 1920;          // cap the longest side of the export
const PNG_SIZE_CAP = 4.5 * 1024 * 1024; // fall back to JPEG above this

/**
 * Crop modal: shows a captured (or any) image and lets the agent drag a
 * rectangle to pick the region to send. Returns the cropped region as a
 * Blob (PNG, or JPEG if PNG would be too large), downscaled so the longest
 * side is ≤ 1920px to keep the upload well under the 5 MB limit.
 */
export default function ImageCropModal({
    src,
    onSend,
    onCancel,
}: {
    src: string;
    /** Crop the selected region (or whole image) and send it right away. */
    onSend: (blob: Blob) => void;
    onCancel: () => void;
}) {
    const imgRef = useRef<HTMLImageElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [sel, setSel] = useState<Rect | null>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [busy, setBusy] = useState(false);

    // Focus the modal on open so Enter (send) / Esc (cancel) work immediately,
    // without the agent having to click anything first.
    useEffect(() => {
        rootRef.current?.focus();
    }, []);

    /** Pointer position relative to the displayed image, clamped to bounds. */
    function relPoint(e: ReactMouseEvent) {
        const img = imgRef.current;
        if (!img) return { x: 0, y: 0 };
        const r = img.getBoundingClientRect();
        return {
            x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
            y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
        };
    }

    function onDown(e: ReactMouseEvent) {
        e.preventDefault();
        const p = relPoint(e);
        dragStart.current = p;
        setSel({ x: p.x, y: p.y, w: 0, h: 0 });
    }
    function onMove(e: ReactMouseEvent) {
        if (!dragStart.current) return;
        const p = relPoint(e);
        const s = dragStart.current;
        setSel({
            x: Math.min(s.x, p.x),
            y: Math.min(s.y, p.y),
            w: Math.abs(p.x - s.x),
            h: Math.abs(p.y - s.y),
        });
    }
    function onUp() {
        dragStart.current = null;
    }

    function selectAll() {
        const img = imgRef.current;
        if (!img) return;
        const r = img.getBoundingClientRect();
        setSel({ x: 0, y: 0, w: r.width, h: r.height });
    }

    function onKeyDown(e: ReactKeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSend();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    }

    function doSend() {
        const img = imgRef.current;
        if (!img || busy) return;
        const r = img.getBoundingClientRect();
        const scaleX = img.naturalWidth / r.width;
        const scaleY = img.naturalHeight / r.height;
        // Use the drawn selection, or the whole image if there's none / it's tiny.
        const region = sel && sel.w > 4 && sel.h > 4 ? sel : { x: 0, y: 0, w: r.width, h: r.height };
        const sx = Math.round(region.x * scaleX);
        const sy = Math.round(region.y * scaleY);
        const sw = Math.max(1, Math.round(region.w * scaleX));
        const sh = Math.max(1, Math.round(region.h * scaleY));

        // Downscale so the longest side is ≤ MAX_SIDE.
        let outW = sw, outH = sh;
        const longest = Math.max(sw, sh);
        if (longest > MAX_SIDE) {
            const k = MAX_SIDE / longest;
            outW = Math.max(1, Math.round(sw * k));
            outH = Math.max(1, Math.round(sh * k));
        }

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

        setBusy(true);
        const finish = (blob: Blob | null) => {
            setBusy(false);
            if (blob) onSend(blob);
            else onCancel();
        };
        // Prefer PNG (crisp text); fall back to JPEG if it's too heavy.
        canvas.toBlob((png) => {
            if (png && png.size <= PNG_SIZE_CAP) {
                finish(png);
            } else {
                canvas.toBlob((jpg) => finish(jpg ?? png), 'image/jpeg', 0.9);
            }
        }, 'image/png');
    }

    const hasSelection = !!sel && sel.w > 4 && sel.h > 4;

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4 outline-none"
            onMouseMove={onMove}
            onMouseUp={onUp}
        >
            <div className="bg-white rounded-xl shadow-2xl overflow-hidden w-full max-w-[880px] flex flex-col">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
                    <span className="text-sm font-bold text-neutral-800">
                        ลากเมาส์เลือกพื้นที่ แล้วกด Enter เพื่อส่ง
                    </span>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-neutral-400 hover:text-neutral-700"
                        title="ปิด"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-3 bg-neutral-100 overflow-auto grid place-items-center" style={{ maxHeight: '70vh' }}>
                    <div
                        className="relative inline-block select-none cursor-crosshair leading-none"
                        onMouseDown={onDown}
                    >
                        <img
                            ref={imgRef}
                            src={src}
                            alt=""
                            draggable={false}
                            className="block max-w-full max-h-[62vh] object-contain"
                        />
                        {/* Selection rectangle */}
                        {sel && sel.w > 0 && sel.h > 0 && (
                            <div
                                className="absolute border-2 border-indigo-500 bg-indigo-500/15 pointer-events-none"
                                style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
                            />
                        )}
                        {/* Hint until the user starts dragging */}
                        {!hasSelection && (
                            <div className="absolute inset-0 grid place-items-center pointer-events-none">
                                <span className="px-3 py-1.5 rounded-full bg-black/55 text-white text-xs font-medium">
                                    ลากเพื่อเลือกพื้นที่ แล้วกด Enter เพื่อส่ง (หรือกด “ทั้งภาพ”)
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-200 bg-white">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-9 px-4 rounded-md text-sm font-semibold text-neutral-600 hover:bg-neutral-100"
                    >
                        ยกเลิก
                    </button>
                    <button
                        type="button"
                        onClick={selectAll}
                        className="h-9 px-4 rounded-md text-sm font-semibold text-neutral-700 border border-neutral-200 hover:bg-neutral-50 inline-flex items-center gap-1.5"
                    >
                        <Maximize2 size={14} /> ทั้งภาพ
                    </button>
                    <button
                        type="button"
                        onClick={doSend}
                        disabled={busy}
                        className="h-9 px-4 rounded-md text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        ส่ง (Enter)
                    </button>
                </div>
            </div>
        </div>
    );
}
