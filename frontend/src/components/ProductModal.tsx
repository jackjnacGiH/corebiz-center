import { useState, type FormEvent } from 'react';
import { Package, Tag, DollarSign, Hash, Barcode, Loader2 } from 'lucide-react';
import type { Category } from '../lib/database.types';
import type { ProductWithInventory } from '../lib/api';
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

export interface ProductFormData {
    sku: string;
    name_th: string;
    name_en: string;
    category_id: string | null;
    brand: string;
    unit: string;
    price: number;
    cost: number;
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
            category_id: null,
            brand: '',
            unit: 'ชิ้น',
            price: 0,
            cost: 0,
            status: 'active',
            initial_quantity: 0,
            reorder_level: 10,
        };
    }
    const inv0 = p.inventory[0];
    return {
        sku: p.sku,
        name_th: p.name_th,
        name_en: p.name_en ?? '',
        category_id: p.category_id,
        brand: p.brand ?? '',
        unit: p.unit,
        price: Number(p.price),
        cost: Number(p.cost ?? 0),
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
    const isNew = !editingProduct;

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
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                ✗ {err}
                            </div>
                        )}

                        {/* SKU + Status */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="prod-sku" className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                    <Barcode size={12} /> SKU (รหัสสินค้า)
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
                                    disabled={!isNew}
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

                        {/* Names */}
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

                        {/* Category + Brand */}
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

                        {/* Price + Cost + Unit */}
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

                        {/* Stock */}
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
                    </div>

                    {/* Footer */}
                    <DialogFooter className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 gap-2">
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
                            disabled={saving}
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
