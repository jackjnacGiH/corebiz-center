/**
 * BulkEditProductsModal
 *
 * Boss Jack's bulk-edit flow:
 *   1. tick products in the Inventory list
 *   2. click "แก้ไขที่เลือก"
 *   3. THIS modal opens — admin picks WHICH fields to overwrite
 *      (each field has its own toggle), enters the new values,
 *      saves once → every selected product gets the same values.
 *
 * Fields NOT supported (per Boss Jack's "ข้อห้าม"):
 *   - sku  — unique per row, can't bulk-rename
 *   - id   — same
 *
 * "ราคาขายจริง" is exposed as a convenience that sets price=X and
 * clears discount, since it's a derived value (price - discount).
 */
import { useMemo, useState, type FormEvent } from 'react';
import {
    Loader2,
    AlertTriangle,
    CheckCircle,
    Percent,
    Tag,
    DollarSign,
    Weight,
    Hash,
    Star,
    FileText,
    Languages,
    Sparkles,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FEATURE_TAG_NONE, FEATURE_TAG_OPTIONS } from './ProductModal';
import type { ProductWithInventory } from '../lib/api';
import type { ProductUpdate } from '../lib/database.types';

interface BulkEditValues {
    name_th: string;
    name_en: string;
    cost: number;
    price: number;
    discount_value: number;
    discount_type: 'fixed' | 'percent';
    effective_price: number;
    weight_kg: number;
    min_order_qty: number;
    feature_tags: string[];
    description_th: string;
    description_en: string;
}

/** Per-field "apply this change?" toggles. Only enabled fields get sent
 *  in the resulting patch. */
type EnabledMap = { [K in keyof BulkEditValues]?: boolean };

interface BulkEditProductsModalProps {
    isOpen: boolean;
    selectedProducts: ProductWithInventory[];
    onClose: () => void;
    /** Caller persists the patch (e.g. productsApi.bulkUpdate(ids, patch)).
     *  Resolves with the row count actually updated. */
    onSave: (patch: ProductUpdate) => Promise<number>;
}

export default function BulkEditProductsModal({
    isOpen,
    selectedProducts,
    onClose,
    onSave,
}: BulkEditProductsModalProps) {
    const count = selectedProducts.length;

    const [enabled, setEnabled] = useState<EnabledMap>({});
    const [values, setValues] = useState<BulkEditValues>({
        name_th: '',
        name_en: '',
        cost: 0,
        price: 0,
        discount_value: 0,
        discount_type: 'fixed',
        effective_price: 0,
        weight_kg: 0,
        min_order_qty: 1,
        feature_tags: [],
        description_th: '',
        description_en: '',
    });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const anyFieldEnabled = useMemo(
        () => Object.values(enabled).some(Boolean),
        [enabled],
    );

    if (!isOpen) return null;

    function toggle<K extends keyof BulkEditValues>(key: K) {
        setEnabled((e) => ({ ...e, [key]: !e[key] }));
    }
    function setVal<K extends keyof BulkEditValues>(key: K, val: BulkEditValues[K]) {
        setValues((v) => ({ ...v, [key]: val }));
    }

    function toggleFeatureTag(tag: string) {
        // Mirror ProductModal logic: clicking "ไม่แสดง" clears everything,
        // any other tag deselects "ไม่แสดง" and toggles itself.
        if (tag === FEATURE_TAG_NONE) {
            setVal('feature_tags', []);
            return;
        }
        const next = values.feature_tags.includes(tag)
            ? values.feature_tags.filter((t) => t !== tag)
            : [...values.feature_tags, tag];
        setVal('feature_tags', next);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!anyFieldEnabled) {
            setErr('กรุณาเลือกอย่างน้อย 1 field ที่ต้องการแก้ไข');
            return;
        }
        // Build the patch from enabled fields only. Empty-string strings stay
        // empty (turn nullable cols into null), numbers stay numbers, etc.
        const patch: ProductUpdate = {};
        if (enabled.name_th) patch.name_th = values.name_th;
        if (enabled.name_en) patch.name_en = values.name_en || null;
        if (enabled.cost) patch.cost = values.cost;
        if (enabled.price) patch.price = values.price;
        if (enabled.discount_value || enabled.discount_type) {
            patch.discount_value = values.discount_value;
            patch.discount_type = values.discount_type;
        }
        if (enabled.effective_price) {
            // Shortcut: set price = X and clear discount so the customer
            // sees exactly X as the final price. Loses the original list price.
            patch.price = values.effective_price;
            patch.discount_value = 0;
            patch.discount_type = 'fixed';
        }
        if (enabled.weight_kg) patch.weight_kg = values.weight_kg;
        if (enabled.min_order_qty) patch.min_order_qty = Math.max(1, values.min_order_qty);
        if (enabled.feature_tags) {
            patch.feature_tags = values.feature_tags;
            // Keep is_featured boolean in sync (back-compat for any reader)
            patch.is_featured = values.feature_tags.length > 0;
        }
        if (enabled.description_th) patch.description_th = values.description_th || null;
        if (enabled.description_en) patch.description_en = values.description_en || null;

        setSaving(true);
        setErr(null);
        try {
            await onSave(patch);
            onClose();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && !saving && onClose()}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles size={20} className="text-violet-600" />
                        แก้ไขสินค้าหลายรายการพร้อมกัน
                    </DialogTitle>
                    <div className="text-sm text-slate-600">
                        เลือกแก้ไข <span className="font-semibold text-violet-700">{count}</span> รายการ —
                        เฉพาะ field ที่ติ๊กไว้จะถูกบันทึก
                    </div>
                </DialogHeader>

                {/* Selected products preview */}
                <div className="border border-slate-200 bg-slate-50 rounded-md px-3 py-2 max-h-24 overflow-y-auto text-xs">
                    <div className="font-semibold text-slate-600 mb-1">รายการที่เลือก:</div>
                    <div className="flex flex-wrap gap-1">
                        {selectedProducts.slice(0, 20).map((p) => (
                            <span
                                key={p.id}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono"
                                title={p.name_th}
                            >
                                {p.sku}
                            </span>
                        ))}
                        {selectedProducts.length > 20 && (
                            <span className="text-slate-500 italic">
                                และอีก {selectedProducts.length - 20} รายการ
                            </span>
                        )}
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {/* ────── ชื่อสินค้า ────── */}
                    <FieldGroup
                        icon={<Languages size={14} />}
                        title="ชื่อภาษาไทย"
                        enabled={!!enabled.name_th}
                        onToggle={() => toggle('name_th')}
                    >
                        <Input
                            value={values.name_th}
                            onChange={(e) => setVal('name_th', e.target.value)}
                            placeholder="เช่น กระดาษทรายกลม MIRKA GOLD 5"
                            disabled={!enabled.name_th}
                        />
                    </FieldGroup>

                    <FieldGroup
                        icon={<Languages size={14} />}
                        title="ชื่อภาษาอังกฤษ (English)"
                        enabled={!!enabled.name_en}
                        onToggle={() => toggle('name_en')}
                    >
                        <Input
                            value={values.name_en}
                            onChange={(e) => setVal('name_en', e.target.value)}
                            placeholder="e.g. MIRKA GOLD Velcro Sanding Disc 5"
                            disabled={!enabled.name_en}
                        />
                    </FieldGroup>

                    {/* ────── ราคา ────── */}
                    <FieldGroup
                        icon={<DollarSign size={14} />}
                        title="Cost (ราคาทุน)"
                        enabled={!!enabled.cost}
                        onToggle={() => toggle('cost')}
                    >
                        <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={values.cost}
                            onChange={(e) => setVal('cost', Number(e.target.value))}
                            disabled={!enabled.cost}
                            className="tabular-nums"
                        />
                    </FieldGroup>

                    <FieldGroup
                        icon={<Tag size={14} />}
                        title="ราคาตั้ง (Price)"
                        enabled={!!enabled.price}
                        onToggle={() => toggle('price')}
                    >
                        <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={values.price}
                            onChange={(e) => setVal('price', Number(e.target.value))}
                            disabled={!enabled.price}
                            className="tabular-nums"
                        />
                    </FieldGroup>

                    {/* ส่วนลด — 2 inputs treated as one logical group */}
                    <FieldGroup
                        icon={<Percent size={14} />}
                        title="ส่วนลด"
                        enabled={!!enabled.discount_value}
                        onToggle={() => toggle('discount_value')}
                    >
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={values.discount_value}
                                onChange={(e) => setVal('discount_value', Number(e.target.value))}
                                disabled={!enabled.discount_value}
                                className="tabular-nums flex-1"
                                placeholder="ค่าส่วนลด"
                            />
                            <select
                                value={values.discount_type}
                                onChange={(e) => setVal('discount_type', e.target.value as 'fixed' | 'percent')}
                                disabled={!enabled.discount_value}
                                className="h-9 px-3 border border-neutral-300 rounded-md text-sm bg-white disabled:opacity-50"
                            >
                                <option value="fixed">บาท (฿)</option>
                                <option value="percent">เปอร์เซ็นต์ (%)</option>
                            </select>
                        </div>
                    </FieldGroup>

                    <FieldGroup
                        icon={<DollarSign size={14} />}
                        title="ราคาขายจริง (set ราคาตั้ง = X, ล้างส่วนลด)"
                        enabled={!!enabled.effective_price}
                        onToggle={() => toggle('effective_price')}
                        hint="ราคาขายจริง = ราคาตั้ง - ส่วนลด — ติ๊กตรงนี้จะ set ราคาตั้ง = X และล้างส่วนลด = 0"
                    >
                        <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={values.effective_price}
                            onChange={(e) => setVal('effective_price', Number(e.target.value))}
                            disabled={!enabled.effective_price}
                            className="tabular-nums"
                        />
                    </FieldGroup>

                    {/* ────── คุณสมบัติ ────── */}
                    <FieldGroup
                        icon={<Weight size={14} />}
                        title="Weight (น้ำหนัก kg)"
                        enabled={!!enabled.weight_kg}
                        onToggle={() => toggle('weight_kg')}
                    >
                        <Input
                            type="number"
                            min="0"
                            step="0.001"
                            value={values.weight_kg}
                            onChange={(e) => setVal('weight_kg', Number(e.target.value))}
                            disabled={!enabled.weight_kg}
                            className="tabular-nums"
                        />
                    </FieldGroup>

                    <FieldGroup
                        icon={<Hash size={14} />}
                        title="ขั้นต่ำสั่งซื้อ (MOQ)"
                        enabled={!!enabled.min_order_qty}
                        onToggle={() => toggle('min_order_qty')}
                    >
                        <Input
                            type="number"
                            min="1"
                            step="1"
                            value={values.min_order_qty}
                            onChange={(e) => setVal('min_order_qty', Math.max(1, Number(e.target.value)))}
                            disabled={!enabled.min_order_qty}
                            className="tabular-nums"
                        />
                    </FieldGroup>

                    {/* ────── Feature tags ────── */}
                    <FieldGroup
                        icon={<Star size={14} />}
                        title="Feature tags"
                        enabled={!!enabled.feature_tags}
                        onToggle={() => toggle('feature_tags')}
                    >
                        <div className={cn('flex flex-wrap gap-1.5', !enabled.feature_tags && 'opacity-50 pointer-events-none')}>
                            <button
                                type="button"
                                onClick={() => toggleFeatureTag(FEATURE_TAG_NONE)}
                                className={cn(
                                    'px-2 py-1 rounded text-xs border transition',
                                    values.feature_tags.length === 0
                                        ? 'bg-slate-700 text-white border-slate-700'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50',
                                )}
                            >
                                {FEATURE_TAG_NONE}
                            </button>
                            {FEATURE_TAG_OPTIONS.map((tag) => {
                                const on = values.feature_tags.includes(tag);
                                return (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleFeatureTag(tag)}
                                        className={cn(
                                            'px-2 py-1 rounded text-xs border transition',
                                            on
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50',
                                        )}
                                    >
                                        {tag}
                                    </button>
                                );
                            })}
                        </div>
                    </FieldGroup>

                    {/* ────── คำอธิบาย ────── */}
                    <FieldGroup
                        icon={<FileText size={14} />}
                        title="คำอธิบายภาษาไทย"
                        enabled={!!enabled.description_th}
                        onToggle={() => toggle('description_th')}
                    >
                        <textarea
                            rows={3}
                            value={values.description_th}
                            onChange={(e) => setVal('description_th', e.target.value)}
                            disabled={!enabled.description_th}
                            className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm font-sans disabled:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            placeholder="รายละเอียดสินค้า..."
                        />
                    </FieldGroup>

                    <FieldGroup
                        icon={<FileText size={14} />}
                        title="คำอธิบายภาษาอังกฤษ"
                        enabled={!!enabled.description_en}
                        onToggle={() => toggle('description_en')}
                    >
                        <textarea
                            rows={3}
                            value={values.description_en}
                            onChange={(e) => setVal('description_en', e.target.value)}
                            disabled={!enabled.description_en}
                            className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm font-sans disabled:bg-slate-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
                            placeholder="Product description..."
                        />
                    </FieldGroup>
                </form>

                {/* Disallowed fields disclosure */}
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    🔒 <strong>SKU</strong> และ <strong>ID</strong> ไม่สามารถแก้พร้อมกันได้ — เนื่องจากต้องไม่ซ้ำกันในแต่ละสินค้า
                </div>

                {err && (
                    <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>{err}</span>
                    </div>
                )}

                <DialogFooter className="border-t border-slate-200 pt-3">
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                        ยกเลิก
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={saving || !anyFieldEnabled}
                        className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                    >
                        {saving ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <CheckCircle size={14} />
                        )}
                        {saving ? 'กำลังบันทึก...' : `บันทึก ${count} รายการ`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ─── Reusable field row ─────────────────────────────────────────────────────
// Each editable field is wrapped in this — a checkbox on the left enables the
// input on the right. Greyed out until enabled.
function FieldGroup({
    icon,
    title,
    enabled,
    onToggle,
    children,
    hint,
}: {
    icon: React.ReactNode;
    title: string;
    enabled: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    hint?: string;
}) {
    return (
        <div
            className={cn(
                'rounded-lg border p-3 transition-colors',
                enabled ? 'border-violet-300 bg-violet-50/30' : 'border-slate-200 bg-white',
            )}
        >
            <div className="flex items-start gap-3">
                <label className="flex items-center gap-2 cursor-pointer pt-1 select-none">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={onToggle}
                        className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                </label>
                <div className="flex-1 min-w-0">
                    <Label
                        className={cn(
                            'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-1.5',
                            enabled ? 'text-violet-800' : 'text-slate-500',
                        )}
                    >
                        <span className={cn(enabled ? 'text-violet-600' : 'text-slate-400')}>{icon}</span>
                        {title}
                    </Label>
                    {hint && <div className="text-[11px] text-slate-500 mb-2">{hint}</div>}
                    {children}
                </div>
            </div>
        </div>
    );
}
