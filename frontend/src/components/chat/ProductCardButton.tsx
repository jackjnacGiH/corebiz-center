import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search, X, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { productsApi, getEffectivePrice, type ProductWithInventory } from '../../lib/api';

/**
 * Composer button + searchable picker that attaches a product "card" (image
 * + formatted info from Inventory) into the chat composer, ready to send.
 *
 * The card text matches the format the AI bot already sends so admin replies
 * look consistent:
 *
 *   ✨ {name}
 *   🏷️ SKU: {sku}
 *   🔖 แบรนด์: {brand}
 *   💰 ราคา: {price} บาท/{unit} (จากปกติ {list} บาท) (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%)
 *   📦 สต็อก: {qty} {unit} (พร้อมส่ง)
 *   📐 ขั้นต่ำสั่งซื้อ: {moq} {unit}
 */

const nf = new Intl.NumberFormat('th-TH');

function heroImage(p: ProductWithInventory): string | null {
    if (!Array.isArray(p.images)) return null;
    const imgs = (p.images as unknown[]).filter((x): x is string => typeof x === 'string');
    return imgs[0] ?? null;
}

/** Build the product-card message text. Exported so the composer can reuse it. */
export function formatProductCard(p: ProductWithInventory): string {
    const eff = getEffectivePrice(p);
    const list = Number(p.price);
    const hasDiscount = eff < list;
    const unit = p.unit || 'ชิ้น';

    const lines: string[] = [];
    lines.push(`✨ ${p.name_th}`);
    lines.push(`🏷️ SKU: ${p.sku}`);
    if (p.brand) lines.push(`🔖 แบรนด์: ${p.brand}`);
    lines.push(
        hasDiscount
            ? `💰 ราคา: ${nf.format(eff)} บาท/${unit} (จากปกติ ${nf.format(list)} บาท) (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%)`
            : `💰 ราคา: ${nf.format(list)} บาท/${unit} (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%)`,
    );
    lines.push(
        p.total_quantity > 0
            ? `📦 สต็อก: ${nf.format(p.total_quantity)} ${unit} (พร้อมส่ง)`
            : `📦 สต็อก: สินค้าสั่งผลิต (ใช้เวลา ~3-5 วันทำการ)`,
    );
    if (p.min_order_qty && p.min_order_qty > 0) {
        lines.push(`📐 ขั้นต่ำสั่งซื้อ: ${nf.format(p.min_order_qty)} ${unit}`);
    }
    return lines.join('\n');
}

export default function ProductCardButton({
    onPick,
    disabled,
}: {
    /** (card text, hero image URL or null) → composer */
    onPick: (cardText: string, imageUrl: string | null) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [products, setProducts] = useState<ProductWithInventory[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const wrapRef = useRef<HTMLDivElement>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            const all = await productsApi.list();
            setProducts(all.filter((p) => p.status === 'active'));
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    // Lazy-load the catalog the first time the panel opens; reset search on close.
    useEffect(() => {
        if (open && products === null && !loading) void load();
        if (!open) setSearch('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

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

    const filtered = useMemo(() => {
        const list = products ?? [];
        const s = search.trim().toLowerCase();
        const res = !s
            ? list
            : list.filter(
                  (p) =>
                      p.name_th.toLowerCase().includes(s) ||
                      (p.name_en?.toLowerCase().includes(s) ?? false) ||
                      p.sku.toLowerCase().includes(s) ||
                      (p.brand?.toLowerCase().includes(s) ?? false),
              );
        return res.slice(0, 80);
    }, [products, search]);

    function pick(p: ProductWithInventory) {
        onPick(formatProductCard(p), heroImage(p));
        setOpen(false);
    }

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                title="แนบการ์ดสินค้า (ค้นหาจากแคตตาล็อก)"
                className={cn(
                    'grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed',
                    open && 'text-indigo-600 bg-indigo-50',
                )}
            >
                <Package size={18} />
            </button>

            {open && (
                <div className="absolute bottom-full mb-2 left-0 z-30 w-[360px] rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
                        <span className="text-xs font-bold text-neutral-700 inline-flex items-center gap-1.5">
                            <Package size={13} className="text-indigo-500" /> แนบการ์ดสินค้า
                        </span>
                        <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                            <X size={15} />
                        </button>
                    </div>

                    <div className="p-2 border-b border-neutral-100">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                autoFocus
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="ค้นหาชื่อสินค้า / SKU / แบรนด์..."
                                className="w-full pl-7 pr-2 h-8 rounded-md border border-neutral-200 bg-neutral-50 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                    </div>

                    {err && (
                        <div className="m-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5 flex items-start gap-1">
                            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                            <span>{err}</span>
                        </div>
                    )}

                    <div className="max-h-[300px] overflow-y-auto">
                        {loading && (
                            <div className="p-5 text-center text-xs text-neutral-500">
                                <Loader2 size={14} className="animate-spin inline mr-1" /> กำลังโหลดสินค้า...
                            </div>
                        )}
                        {!loading && filtered.length === 0 && (
                            <div className="p-5 text-center text-xs text-neutral-400">
                                {search ? 'ไม่พบสินค้าที่ค้นหา' : 'ไม่มีสินค้า'}
                            </div>
                        )}
                        {filtered.map((p) => {
                            const hero = heroImage(p);
                            const eff = getEffectivePrice(p);
                            const list = Number(p.price);
                            const hasDiscount = eff < list;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => pick(p)}
                                    className="w-full flex items-center gap-2.5 px-2 py-2 border-b border-neutral-50 hover:bg-indigo-50/40 text-left"
                                    title="คลิกเพื่อแนบการ์ดสินค้านี้"
                                >
                                    <div className="w-11 h-11 rounded-md border border-neutral-200 bg-white grid place-items-center overflow-hidden flex-shrink-0">
                                        {hero ? (
                                            <img src={hero} alt="" className="w-full h-full object-contain" loading="lazy" />
                                        ) : (
                                            <Package size={16} className="text-neutral-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-neutral-800 truncate">{p.name_th}</div>
                                        <div className="text-[10px] text-neutral-400 font-mono truncate">
                                            {p.sku}
                                            {p.brand ? ` · ${p.brand}` : ''}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={cn('text-[11px] font-bold tabular-nums', hasDiscount ? 'text-rose-600' : 'text-neutral-700')}>
                                                {nf.format(eff)} บาท
                                            </span>
                                            {hasDiscount && (
                                                <span className="text-[10px] line-through text-neutral-400 tabular-nums">{nf.format(list)}</span>
                                            )}
                                            <span
                                                className={cn(
                                                    'text-[10px] tabular-nums ml-auto',
                                                    p.total_quantity > 0 ? 'text-emerald-600' : 'text-amber-600',
                                                )}
                                            >
                                                {p.total_quantity > 0 ? `สต็อก ${nf.format(p.total_quantity)}` : 'สั่งผลิต'}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="px-3 py-1.5 border-t border-neutral-100 bg-neutral-50 text-[10px] text-neutral-400">
                        คลิกสินค้า → การ์ด (รูป + ข้อมูล) จะไปอยู่ในช่องพิมพ์ รอกดส่ง
                    </div>
                </div>
            )}
        </div>
    );
}
