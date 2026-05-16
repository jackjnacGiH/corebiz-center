import { useRef, useState, type FormEvent, type ChangeEvent, type DragEvent } from 'react';
import {
    Package,
    Tag,
    DollarSign,
    Hash,
    Barcode,
    Loader2,
    ImagePlus,
    X,
    AlertTriangle,
    Weight,
    Star,
    GripVertical,
} from 'lucide-react';
import type { Category } from '../lib/database.types';
import type { ProductWithInventory } from '../lib/api';
import { uploadProductImage, deleteProductImage, validateImage } from '../lib/storage';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MAX_IMAGES = 5;

export interface ProductFormData {
    sku: string;
    name_th: string;
    name_en: string;
    description_th: string;
    description_en: string;
    images: string[]; // public URLs
    category_id: string | null;
    brand: string;
    unit: string;
    price: number;
    cost: number;
    weight_kg: number;
    is_featured: boolean;
    status: 'active' | 'draft' | 'archived';
    /** Used only when creating a new product — initial qty in default warehouse */
    initial_quantity: number;
    reorder_level: number;
}

interface ProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: ProductFormData) => Promise<void> | void;
    editingProduct?: ProductWithInventory | null;
    categories: Category[];
}

const UNITS = ['ชิ้น', 'กล่อง', 'ชุด', 'คู่', 'ม้วน', 'แพ็ค', 'ลัง'];

const selectClass =
    'w-full h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

function buildInitialForm(p: ProductWithInventory | null | undefined): ProductFormData {
    if (!p) {
        return {
            sku: '',
            name_th: '',
            name_en: '',
            description_th: '',
            description_en: '',
            images: [],
            category_id: null,
            brand: '',
            unit: 'ชิ้น',
            price: 0,
            cost: 0,
            weight_kg: 0,
            is_featured: false,
            status: 'active',
            initial_quantity: 0,
            reorder_level: 10,
        };
    }
    const inv0 = p.inventory[0];
    // images stored as jsonb (string[] of public URLs)
    const imgs = Array.isArray(p.images)
        ? (p.images as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
    return {
        sku: p.sku,
        name_th: p.name_th,
        name_en: p.name_en ?? '',
        description_th: p.description_th ?? '',
        description_en: p.description_en ?? '',
        images: imgs,
        category_id: p.category_id,
        brand: p.brand ?? '',
        unit: p.unit,
        price: Number(p.price),
        cost: Number(p.cost ?? 0),
        weight_kg: Number(p.weight_kg ?? 0),
        is_featured: Boolean(p.is_featured),
        status: p.status as ProductFormData['status'],
        initial_quantity: inv0?.quantity ?? 0,
        reorder_level: inv0?.reorder_level ?? 10,
    };
}

export default function ProductModal(props: ProductModalProps) {
    const { isOpen, editingProduct } = props;
    if (!isOpen) return null;
    return <ProductModalForm key={editingProduct?.id ?? 'new'} {...props} />;
}

function ProductModalForm({
    isOpen,
    onClose,
    onSave,
    editingProduct,
    categories,
}: ProductModalProps) {
    const [form, setForm] = useState<ProductFormData>(() => buildInitialForm(editingProduct));
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isNew = !editingProduct;

    /** Stable namespace under which uploaded files live. For a new product we
        mint a one-off key — the files end up under `pending-xxx/...` regardless
        of which product they later belong to. */
    const productKeyRef = useRef<string>(
        editingProduct?.id ?? `pending-${Math.random().toString(36).slice(2, 10)}`,
    );

    async function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        // reset input so picking the same file again still fires the event
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (files.length === 0) return;

        const slotsLeft = MAX_IMAGES - form.images.length;
        if (slotsLeft <= 0) {
            setErr(`อัปโหลดได้สูงสุด ${MAX_IMAGES} รูป — ลบรูปเก่าก่อน`);
            return;
        }
        const toUpload = files.slice(0, slotsLeft);
        if (files.length > slotsLeft) {
            setErr(
                `เลือกมา ${files.length} ไฟล์ แต่เหลือช่องว่างแค่ ${slotsLeft} — รับไปแค่ ${slotsLeft} ไฟล์แรก`,
            );
        } else {
            setErr(null);
        }

        // Quick client-side validation before kicking off uploads
        try {
            for (const f of toUpload) validateImage(f);
        } catch (e) {
            setErr((e as Error).message);
            return;
        }

        setUploadingCount(toUpload.length);
        try {
            const urls = await Promise.all(
                toUpload.map((f) => uploadProductImage(f, productKeyRef.current)),
            );
            setForm((prev) => ({ ...prev, images: [...prev.images, ...urls] }));
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setUploadingCount(0);
        }
    }

    function removeImage(url: string) {
        setForm((prev) => ({ ...prev, images: prev.images.filter((u) => u !== url) }));
        // Fire-and-forget cleanup from storage (best-effort)
        void deleteProductImage(url);
    }

    // ── Drag-and-drop reorder ──────────────────────────────────────────
    // Index 0 is the "hero" image shown in Inventory thumbnail column and
    // the Ecommerce product card. Reordering changes which image is the hero.

    function handleDragStart(e: DragEvent<HTMLDivElement>, index: number) {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires non-empty data to allow drag
        e.dataTransfer.setData('text/plain', String(index));
    }

    function handleDragOver(e: DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (index !== dragOverIndex) setDragOverIndex(index);
    }

    function handleDragLeave() {
        setDragOverIndex(null);
    }

    function handleDrop(e: DragEvent<HTMLDivElement>, targetIndex: number) {
        e.preventDefault();
        setDragOverIndex(null);
        if (draggedIndex === null || draggedIndex === targetIndex) {
            setDraggedIndex(null);
            return;
        }
        setForm((prev) => {
            const next = [...prev.images];
            const [moved] = next.splice(draggedIndex, 1);
            next.splice(targetIndex, 0, moved);
            return { ...prev, images: next };
        });
        setDraggedIndex(null);
    }

    function handleDragEnd() {
        setDraggedIndex(null);
        setDragOverIndex(null);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
            await onSave(form);
            onClose();
        } catch (e2) {
            setErr((e2 as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col">
                {/* Header */}
                <DialogHeader className="px-6 py-5 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <Package size={20} className="text-white" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-lg font-bold text-neutral-900">
                                {isNew ? 'เพิ่มสินค้าใหม่' : 'แก้ไขข้อมูลสินค้า'}
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5 uppercase tracking-wider font-semibold font-mono">
                                {isNew ? 'New Product' : `SKU: ${editingProduct?.sku}`}
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                <form
                    onSubmit={handleSubmit}
                    className="flex flex-col overflow-hidden flex-1"
                >
                    <div className="px-6 py-5 space-y-5 overflow-y-auto">
                        {err && (
                            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                                <span>{err}</span>
                            </div>
                        )}

                        {/* ── Images uploader ─────────────────────────── */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                <ImagePlus size={12} /> รูปสินค้า ({form.images.length}/{MAX_IMAGES})
                            </Label>
                            <div className="grid grid-cols-5 gap-3">
                                {form.images.map((url, idx) => {
                                    const isHero = idx === 0;
                                    const isDragging = draggedIndex === idx;
                                    const isDragOver = dragOverIndex === idx && draggedIndex !== idx;
                                    return (
                                        <div
                                            key={url}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, idx)}
                                            onDragOver={(e) => handleDragOver(e, idx)}
                                            onDragLeave={handleDragLeave}
                                            onDrop={(e) => handleDrop(e, idx)}
                                            onDragEnd={handleDragEnd}
                                            className={cn(
                                                'group relative aspect-square rounded-lg border bg-neutral-50 overflow-hidden cursor-grab active:cursor-grabbing transition',
                                                isHero
                                                    ? 'border-amber-300 ring-2 ring-amber-200'
                                                    : 'border-neutral-200',
                                                isDragging && 'opacity-40',
                                                isDragOver &&
                                                    'ring-2 ring-indigo-400 border-indigo-400 scale-105',
                                            )}
                                            title={
                                                isHero
                                                    ? 'รูป hero — แสดงในตาราง Inventory + Ecommerce. ลากเพื่อย้ายตำแหน่ง'
                                                    : 'ลากเพื่อจัดลำดับ — รูปแรก (#1) คือรูปที่แสดง'
                                            }
                                        >
                                            <img
                                                src={url}
                                                alt={`product ${idx + 1}`}
                                                className="w-full h-full object-cover pointer-events-none"
                                                loading="lazy"
                                                draggable={false}
                                            />

                                            {/* Drag handle hint (top-left) */}
                                            <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded bg-white/90 border border-neutral-200 grid place-items-center text-neutral-500 opacity-0 group-hover:opacity-100 transition">
                                                <GripVertical size={12} />
                                            </div>

                                            {/* Hero badge (#1 = first image, used everywhere) */}
                                            {isHero && (
                                                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                                                    <Star size={9} className="fill-white" />
                                                    หลัก
                                                </div>
                                            )}
                                            {!isHero && (
                                                <div className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-white/90 border border-neutral-200 text-neutral-700 text-[10px] font-bold grid place-items-center">
                                                    {idx + 1}
                                                </div>
                                            )}

                                            {/* Remove button */}
                                            <button
                                                type="button"
                                                onClick={() => removeImage(url)}
                                                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/95 border border-neutral-200 shadow-sm grid place-items-center text-neutral-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition opacity-0 group-hover:opacity-100"
                                                title="ลบรูปนี้"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {form.images.length < MAX_IMAGES && (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploadingCount > 0}
                                        className="aspect-square rounded-lg border-2 border-dashed border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50 transition flex flex-col items-center justify-center gap-1 text-neutral-500 hover:text-indigo-700 disabled:opacity-50"
                                    >
                                        {uploadingCount > 0 ? (
                                            <>
                                                <Loader2 size={20} className="animate-spin" />
                                                <span className="text-[10px] font-semibold">
                                                    กำลังอัปโหลด...
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <ImagePlus size={20} />
                                                <span className="text-[10px] font-semibold">
                                                    เพิ่มรูป
                                                </span>
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                            <p className="text-[11px] text-neutral-500">
                                JPG / PNG / WebP / GIF · ขนาดไม่เกิน 5 MB · สูงสุด {MAX_IMAGES} รูป ·{' '}
                                <span className="font-medium text-amber-700">
                                    ลากรูปเพื่อจัดลำดับ — รูปที่ #1 (มีดาว) คือรูปหลักใน Inventory + Ecommerce
                                </span>
                            </p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                multiple
                                onChange={handleFilesPicked}
                                className="hidden"
                            />
                        </div>

                        {/* ── SKU + Status ────────────────────────────── */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="prod-sku" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Barcode size={12} /> SKU (รหัสสินค้า) *
                                </Label>
                                <Input
                                    id="prod-sku"
                                    type="text"
                                    required
                                    placeholder="เช่น ABR-001"
                                    value={form.sku}
                                    onChange={(e) =>
                                        setForm({ ...form, sku: e.target.value.toUpperCase() })
                                    }
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="prod-status" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    สถานะ
                                </Label>
                                <select
                                    id="prod-status"
                                    className={selectClass}
                                    value={form.status}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            status: e.target.value as ProductFormData['status'],
                                        })
                                    }
                                >
                                    <option value="active">Active</option>
                                    <option value="draft">Draft</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </div>
                        </div>

                        {/* ── Names ───────────────────────────────────── */}
                        <div className="space-y-2">
                            <Label htmlFor="prod-name-th" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                <Tag size={12} /> ชื่อภาษาไทย *
                            </Label>
                            <Input
                                id="prod-name-th"
                                type="text"
                                required
                                placeholder="เช่น ใบเจียรเหล็ก 4 นิ้ว"
                                value={form.name_th}
                                onChange={(e) => setForm({ ...form, name_th: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="prod-name-en" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                <Tag size={12} /> Name (English) — optional
                            </Label>
                            <Input
                                id="prod-name-en"
                                type="text"
                                placeholder="e.g. Grinding Disc 4 inch"
                                value={form.name_en}
                                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                            />
                        </div>

                        {/* ── Description (TH/EN) ─────────────────────── */}
                        <div className="space-y-2">
                            <Label htmlFor="prod-desc-th" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                รายละเอียดสินค้า (ภาษาไทย)
                            </Label>
                            <textarea
                                id="prod-desc-th"
                                rows={4}
                                placeholder="เช่น สเปคสินค้า, จุดเด่น, การใช้งาน..."
                                value={form.description_th}
                                onChange={(e) =>
                                    setForm({ ...form, description_th: e.target.value })
                                }
                                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y"
                            />
                        </div>

                        <details className="group">
                            <summary className="cursor-pointer text-xs font-semibold text-neutral-500 uppercase tracking-wider hover:text-indigo-700 transition select-none">
                                + Description (English) — optional
                            </summary>
                            <div className="space-y-2 mt-2">
                                <textarea
                                    id="prod-desc-en"
                                    rows={4}
                                    placeholder="e.g. specs, key features, use cases..."
                                    value={form.description_en}
                                    onChange={(e) =>
                                        setForm({ ...form, description_en: e.target.value })
                                    }
                                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y"
                                />
                            </div>
                        </details>

                        {/* ── Category + Brand ────────────────────────── */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="prod-cat" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Package size={12} /> หมวดหมู่
                                </Label>
                                <select
                                    id="prod-cat"
                                    className={selectClass}
                                    value={form.category_id ?? ''}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            category_id: e.target.value || null,
                                        })
                                    }
                                >
                                    <option value="">— ไม่ระบุ —</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name_th}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="prod-brand" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    แบรนด์
                                </Label>
                                <Input
                                    id="prod-brand"
                                    type="text"
                                    placeholder="เช่น Bosch, 3M"
                                    value={form.brand}
                                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* ── Price + Cost + Unit ─────────────────────── */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="prod-price" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <DollarSign size={12} /> ราคาขาย (฿)
                                </Label>
                                <Input
                                    id="prod-price"
                                    type="number"
                                    required
                                    min="0"
                                    step="0.01"
                                    value={form.price}
                                    onChange={(e) =>
                                        setForm({ ...form, price: Number(e.target.value) })
                                    }
                                    className="tabular-nums"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="prod-cost" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    ต้นทุน (฿)
                                </Label>
                                <Input
                                    id="prod-cost"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.cost}
                                    onChange={(e) =>
                                        setForm({ ...form, cost: Number(e.target.value) })
                                    }
                                    className="tabular-nums"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="prod-unit" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    หน่วย
                                </Label>
                                <select
                                    id="prod-unit"
                                    className={selectClass}
                                    value={form.unit}
                                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                                >
                                    {UNITS.map((u) => (
                                        <option key={u} value={u}>
                                            {u}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* ── Stock ───────────────────────────────────── */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="prod-qty" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Hash size={12} /> {isNew ? 'จำนวนเริ่มต้น' : 'จำนวนคงเหลือ'}
                                </Label>
                                <Input
                                    id="prod-qty"
                                    type="number"
                                    required
                                    min="0"
                                    value={form.initial_quantity}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            initial_quantity: Number(e.target.value),
                                        })
                                    }
                                    className="tabular-nums"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="prod-reorder" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    จุดสั่งซื้อใหม่ (Reorder)
                                </Label>
                                <Input
                                    id="prod-reorder"
                                    type="number"
                                    required
                                    min="0"
                                    value={form.reorder_level}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            reorder_level: Number(e.target.value),
                                        })
                                    }
                                    className="tabular-nums"
                                />
                            </div>
                        </div>

                        {/* ── Weight + Featured ──────────────────────── */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label htmlFor="prod-weight" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Weight size={12} /> น้ำหนัก (kg)
                                </Label>
                                <Input
                                    id="prod-weight"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={form.weight_kg}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            weight_kg: Number(e.target.value),
                                        })
                                    }
                                    className="tabular-nums"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Star size={12} /> สินค้าแนะนำ
                                </Label>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setForm((f) => ({ ...f, is_featured: !f.is_featured }))
                                    }
                                    className={cn(
                                        'h-9 w-full flex items-center justify-between gap-2 rounded-md border px-3 text-sm transition',
                                        form.is_featured
                                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                                            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
                                    )}
                                    role="switch"
                                    aria-checked={form.is_featured}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <Star
                                            size={14}
                                            className={cn(
                                                form.is_featured
                                                    ? 'fill-amber-500 text-amber-500'
                                                    : 'text-neutral-400',
                                            )}
                                        />
                                        {form.is_featured ? 'Featured' : 'ปกติ'}
                                    </span>
                                    <span
                                        className={cn(
                                            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                                            form.is_featured ? 'bg-amber-500' : 'bg-neutral-300',
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                                                form.is_featured
                                                    ? 'translate-x-4'
                                                    : 'translate-x-0.5',
                                            )}
                                        />
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <DialogFooter
                        className={cn(
                            'px-6 py-4 border-t border-neutral-200 bg-neutral-50 gap-2',
                            uploadingCount > 0 && 'opacity-60 pointer-events-none',
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={saving}
                        >
                            ยกเลิก
                        </Button>
                        <Button
                            type="submit"
                            disabled={saving || uploadingCount > 0}
                            className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                        >
                            {saving && <Loader2 size={14} className="animate-spin" />}
                            {saving
                                ? 'กำลังบันทึก...'
                                : isNew
                                  ? 'เพิ่มสินค้า'
                                  : 'บันทึก'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
