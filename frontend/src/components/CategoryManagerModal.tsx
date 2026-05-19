/**
 * CategoryManagerModal — CRUD UI for the knowledge_categories table.
 *
 * Used from OpenclawRAG when the operator wants to add / rename / delete
 * a category from the "หมวด" dropdown. The underlying `value` (slug) is
 * what flows into knowledge_chunks.source_type, so we expose it as a
 * read-only-after-create field by default — renaming the label is the
 * normal operation, renaming the value is reserved for the "edit" form.
 */
import { useEffect, useState } from 'react';
import {
    FolderOpen,
    Plus,
    Pencil,
    Trash2,
    Save,
    X,
    Loader2,
    AlertCircle,
    GripVertical,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { knowledgeCategoriesApi, type KnowledgeCategory } from '../lib/api';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Called after any change so the parent can refresh its dropdown options. */
    onChanged?: () => void;
}

export default function CategoryManagerModal({ isOpen, onClose, onChanged }: Props) {
    const [cats, setCats] = useState<KnowledgeCategory[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftLabel, setDraftLabel] = useState('');
    const [draftValue, setDraftValue] = useState('');
    const [draftSort, setDraftSort] = useState<number>(0);
    const [savingRow, setSavingRow] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [newValue, setNewValue] = useState('');
    const [newLabel, setNewLabel] = useState('');
    const [adding, setAdding] = useState(false);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setCats(await knowledgeCategoriesApi.list());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (isOpen) void load();
    }, [isOpen]);

    function startEdit(cat: KnowledgeCategory) {
        setEditingId(cat.id);
        setDraftLabel(cat.label);
        setDraftValue(cat.value);
        setDraftSort(cat.sort_order);
        setErr(null);
    }

    function cancelEdit() {
        setEditingId(null);
        setDraftLabel('');
        setDraftValue('');
        setDraftSort(0);
        setErr(null);
    }

    async function saveEdit(id: string) {
        if (!draftLabel.trim()) return;
        if (!/^[a-z0-9_-]+$/.test(draftValue)) {
            setErr('value ต้องเป็น lowercase + ตัวเลข + _ / - เท่านั้น');
            return;
        }
        setSavingRow(true);
        setErr(null);
        try {
            await knowledgeCategoriesApi.update(id, {
                label: draftLabel,
                value: draftValue,
                sort_order: draftSort,
            });
            await load();
            cancelEdit();
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSavingRow(false);
        }
    }

    async function handleDelete(cat: KnowledgeCategory) {
        if (
            !window.confirm(
                `ลบหมวด "${cat.label}" (${cat.value}) ใช่ไหม?\n\n` +
                    `เอกสารที่ใช้หมวดนี้อยู่จะยังอยู่ในระบบ แต่ตอนเพิ่มเอกสารใหม่จะไม่เห็นในตัวเลือก`,
            )
        )
            return;
        try {
            await knowledgeCategoriesApi.remove(cat.id);
            await load();
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function handleAdd() {
        if (!newValue.trim() || !newLabel.trim()) {
            setErr('กรุณาใส่ทั้ง value และ label');
            return;
        }
        if (!/^[a-z0-9_-]+$/.test(newValue)) {
            setErr('value ต้องเป็น lowercase + ตัวเลข + _ / - เท่านั้น');
            return;
        }
        if (cats.some((c) => c.value === newValue.trim().toLowerCase())) {
            setErr(`value "${newValue}" มีอยู่แล้ว — เลือกอันใหม่`);
            return;
        }
        setAdding(true);
        setErr(null);
        try {
            const nextSort =
                cats.length === 0
                    ? 10
                    : Math.max(...cats.map((c) => c.sort_order)) + 10;
            await knowledgeCategoriesApi.create({
                value: newValue,
                label: newLabel,
                sort_order: nextSort,
            });
            await load();
            setNewValue('');
            setNewLabel('');
            setShowAdd(false);
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setAdding(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col">
                <DialogHeader className="px-6 py-4 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <FolderOpen size={16} className="text-white" />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-bold text-neutral-900">
                                จัดการหมวดความรู้
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                                เพิ่ม / แก้ไข / ลบ ตัวเลือกในช่อง "หมวด" ของฟอร์มเพิ่มความรู้
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                    {err && (
                        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                            <span>{err}</span>
                        </div>
                    )}

                    {loading && (
                        <div className="text-center py-8 text-neutral-500 text-sm">
                            <Loader2 size={16} className="inline animate-spin mr-2" />
                            กำลังโหลด...
                        </div>
                    )}

                    {!loading && (
                        <>
                            {/* Table */}
                            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                    <div className="col-span-1 text-center">#</div>
                                    <div className="col-span-3">Value (slug)</div>
                                    <div className="col-span-5">Label (แสดงในระบบ)</div>
                                    <div className="col-span-1 text-center">Order</div>
                                    <div className="col-span-2 text-right">จัดการ</div>
                                </div>
                                {cats.length === 0 && (
                                    <div className="px-3 py-8 text-center text-sm text-neutral-500">
                                        ยังไม่มีหมวด — เริ่มเพิ่มหมวดแรก
                                    </div>
                                )}
                                {cats.map((cat, idx) => (
                                    <div
                                        key={cat.id}
                                        className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-neutral-100 last:border-0 items-center text-sm"
                                    >
                                        <div className="col-span-1 text-center text-neutral-400">
                                            <GripVertical size={12} className="inline" />
                                            <span className="ml-1 text-[10px] tabular-nums">{idx + 1}</span>
                                        </div>

                                        {editingId === cat.id ? (
                                            <>
                                                <div className="col-span-3">
                                                    <Input
                                                        value={draftValue}
                                                        onChange={(e) =>
                                                            setDraftValue(e.target.value.toLowerCase())
                                                        }
                                                        placeholder="slug"
                                                        className="h-8 text-xs font-mono"
                                                    />
                                                </div>
                                                <div className="col-span-5">
                                                    <Input
                                                        value={draftLabel}
                                                        onChange={(e) => setDraftLabel(e.target.value)}
                                                        placeholder="ป้ายชื่อ"
                                                        className="h-8 text-xs"
                                                        autoFocus
                                                    />
                                                </div>
                                                <div className="col-span-1">
                                                    <Input
                                                        type="number"
                                                        value={draftSort}
                                                        onChange={(e) =>
                                                            setDraftSort(Number(e.target.value) || 0)
                                                        }
                                                        className="h-8 text-xs tabular-nums px-1.5"
                                                    />
                                                </div>
                                                <div className="col-span-2 flex items-center justify-end gap-1">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => void saveEdit(cat.id)}
                                                        disabled={savingRow || !draftLabel.trim()}
                                                        className="h-7 px-2 bg-indigo-500 hover:bg-indigo-600"
                                                        title="บันทึก"
                                                    >
                                                        {savingRow ? (
                                                            <Loader2 size={11} className="animate-spin" />
                                                        ) : (
                                                            <Save size={11} />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={cancelEdit}
                                                        disabled={savingRow}
                                                        className="h-7 px-2"
                                                        title="ยกเลิก"
                                                    >
                                                        <X size={11} />
                                                    </Button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="col-span-3">
                                                    <code className="text-[11px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">
                                                        {cat.value}
                                                    </code>
                                                </div>
                                                <div className="col-span-5 text-neutral-900">
                                                    {cat.label}
                                                </div>
                                                <div className="col-span-1 text-center text-xs text-neutral-500 tabular-nums">
                                                    {cat.sort_order}
                                                </div>
                                                <div className="col-span-2 flex items-center justify-end gap-1">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => startEdit(cat)}
                                                        className="h-7 px-2 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                                                        title="แก้ไข"
                                                    >
                                                        <Pencil size={11} />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => void handleDelete(cat)}
                                                        className="h-7 px-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                                                        title="ลบ"
                                                    >
                                                        <Trash2 size={11} />
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Add new */}
                            {!showAdd && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAdd(true);
                                        setNewValue('');
                                        setNewLabel('');
                                        setErr(null);
                                    }}
                                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-indigo-300 bg-white hover:bg-indigo-50 text-sm font-medium text-indigo-700 transition"
                                >
                                    <Plus size={14} /> เพิ่มหมวดใหม่
                                </button>
                            )}

                            {showAdd && (
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
                                    <div className="text-xs font-semibold text-indigo-900">
                                        เพิ่มหมวดใหม่
                                    </div>
                                    <div className="grid grid-cols-12 gap-2">
                                        <div className="col-span-4 space-y-1.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-neutral-600 font-bold">
                                                Value (slug)
                                            </Label>
                                            <Input
                                                value={newValue}
                                                onChange={(e) => setNewValue(e.target.value.toLowerCase())}
                                                placeholder="เช่น warranty"
                                                className="h-9 text-sm font-mono"
                                            />
                                            <p className="text-[10px] text-neutral-500">
                                                lowercase + ตัวเลข + _ - เท่านั้น
                                            </p>
                                        </div>
                                        <div className="col-span-6 space-y-1.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-neutral-600 font-bold">
                                                Label (ที่แสดง)
                                            </Label>
                                            <Input
                                                value={newLabel}
                                                onChange={(e) => setNewLabel(e.target.value)}
                                                placeholder="เช่น การรับประกัน"
                                                className="h-9 text-sm"
                                            />
                                        </div>
                                        <div className="col-span-2 flex items-end gap-1">
                                            <Button
                                                type="button"
                                                onClick={() => void handleAdd()}
                                                disabled={adding || !newValue.trim() || !newLabel.trim()}
                                                className="h-9 flex-1 bg-indigo-500 hover:bg-indigo-600 gap-1"
                                            >
                                                {adding ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Plus size={12} />
                                                )}
                                                เพิ่ม
                                            </Button>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowAdd(false)}
                                        className="text-[11px] text-neutral-500 hover:text-neutral-700 hover:underline"
                                    >
                                        ยกเลิก
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50 flex justify-end">
                    <Button type="button" variant="outline" onClick={onClose}>
                        ปิด
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
