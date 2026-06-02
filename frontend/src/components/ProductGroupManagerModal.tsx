/**
 * ProductGroupManagerModal — admin UI for managing product_groups.
 *
 * Layout (two-pane):
 *   ┌─ Groups ──────────────┐  ┌─ Members of selected ────┐
 *   │ + Create new          │  │ [Group cover image]      │
 *   │ • MIRKA GOLD 5"  (12) │  │ Edit name/desc/cover     │
 *   │ • CS310X 72P 4" (6)   │  │ ────────────────────────│
 *   │ ...                   │  │ ☑ SKU #60   ฿15  1500   │
 *   └───────────────────────┘  │ ☑ SKU #80   ฿15  1500   │
 *                              │ + เพิ่มสินค้าเข้ากลุ่ม...      │
 *                              └────────────────────────────┘
 *
 * What's editable:
 *   - Group name / description / cover_image (replace via upload)
 *   - Member list: add by SKU search, remove by × button per row
 *
 * Constraints:
 *   - Group is display-only — never has a SKU, never bought directly.
 *   - One product belongs to AT MOST one group; assigning a SKU here
 *     overwrites whatever group it was previously in.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Boxes,
    Plus,
    Pencil,
    Trash2,
    X,
    Loader2,
    AlertCircle,
    Image as ImageIcon,
    Search,
    Save,
    ChevronRight,
    Upload,
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
import {
    productGroupsApi,
    productsApi,
    type ProductGroup,
    type ProductGroupWithStats,
    type ProductWithInventory,
} from '../lib/api';
import { cn } from '@/lib/utils';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onChanged?: () => void;
}

function formatTHB(v: number | string): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        maximumFractionDigits: 0,
    }).format(Number(v));
}

export default function ProductGroupManagerModal({ isOpen, onClose, onChanged }: Props) {
    const [groups, setGroups] = useState<ProductGroupWithStats[]>([]);
    const [products, setProducts] = useState<ProductWithInventory[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');

    async function loadAll() {
        setLoading(true);
        setErr(null);
        try {
            const [g, p] = await Promise.all([
                productGroupsApi.list(),
                productsApi.list(),
            ]);
            setGroups(g);
            setProducts(p);
            // Auto-select first group if nothing selected yet
            if (!selectedId && g.length > 0) setSelectedId(g[0].id);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (isOpen) void loadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const selectedGroup = useMemo(
        () => groups.find((g) => g.id === selectedId) ?? null,
        [groups, selectedId],
    );

    const filteredGroups = useMemo(() => {
        const q = groupSearch.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter(
            (g) =>
                g.name.toLowerCase().includes(q) ||
                (g.description?.toLowerCase().includes(q) ?? false),
        );
    }, [groups, groupSearch]);

    const members = useMemo(
        () => products.filter((p) => p.group_id === selectedId),
        [products, selectedId],
    );

    const unassigned = useMemo(
        () => products.filter((p) => !p.group_id),
        [products],
    );

    async function handleCreate(name: string) {
        try {
            const next =
                groups.length === 0
                    ? 10
                    : Math.max(...groups.map((g) => g.sort_order)) + 10;
            const g = await productGroupsApi.create({ name, sort_order: next });
            await loadAll();
            setSelectedId(g.id);
            setShowCreate(false);
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function handleDeleteGroup(g: ProductGroup) {
        if (
            !window.confirm(
                `ลบกลุ่ม "${g.name}" ใช่ไหม?\n\nสินค้า ${members.length} ตัวที่อยู่ในกลุ่มจะถูกย้ายออกเป็น "ไม่มีกลุ่ม" — SKU + ราคา + สต็อก ยังคงเดิม`,
            )
        )
            return;
        try {
            await productGroupsApi.remove(g.id);
            setSelectedId(null);
            await loadAll();
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function handleAssign(productIds: string[]) {
        if (!selectedGroup || productIds.length === 0) return;
        try {
            await productGroupsApi.assignProducts(selectedGroup.id, productIds);
            await loadAll();
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    async function handleRemoveMember(productId: string) {
        try {
            await productGroupsApi.assignProducts(null, [productId]);
            await loadAll();
            onChanged?.();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-5xl p-0 gap-0 max-h-[92vh] flex flex-col">
                <DialogHeader className="px-6 py-4 border-b border-neutral-200 bg-neutral-50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-indigo-500 grid place-items-center flex-shrink-0">
                            <Boxes size={16} className="text-white" />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-bold text-neutral-900">
                                จัดการกลุ่มสินค้า
                            </DialogTitle>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                                Folder ที่รวม SKU ชื่อเดียวกัน ต่างเบอร์ / สี ไว้ในกลุ่มเดียวกัน
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                    {/* ── Left: list of groups ─────────────────────────── */}
                    <div className="md:col-span-4 border-r border-neutral-200 flex flex-col overflow-hidden">
                        <div className="p-3 border-b border-neutral-200 space-y-2">
                            <Button
                                type="button"
                                onClick={() => setShowCreate(true)}
                                className="w-full bg-indigo-500 hover:bg-indigo-600 gap-2"
                            >
                                <Plus size={14} /> สร้างกลุ่มใหม่
                            </Button>
                            <div className="relative">
                                <Search
                                    size={13}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                                />
                                <Input
                                    value={groupSearch}
                                    onChange={(e) => setGroupSearch(e.target.value)}
                                    placeholder="ค้นหากลุ่ม..."
                                    className="pl-9 h-9"
                                />
                                {groupSearch && (
                                    <button
                                        type="button"
                                        onClick={() => setGroupSearch('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                                        title="ล้างคำค้น"
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                            {groupSearch.trim() && (
                                <div className="text-[11px] text-neutral-500 tabular-nums px-0.5">
                                    พบ {filteredGroups.length} กลุ่ม
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {loading && groups.length === 0 && (
                                <div className="p-6 text-sm text-neutral-500 text-center">
                                    <Loader2 size={16} className="inline animate-spin mr-2" />
                                    กำลังโหลด...
                                </div>
                            )}
                            {!loading && groups.length === 0 && (
                                <div className="p-8 text-center text-sm text-neutral-500">
                                    ยังไม่มีกลุ่ม — กดสร้างกลุ่มใหม่
                                </div>
                            )}
                            {!loading && groups.length > 0 && filteredGroups.length === 0 && (
                                <div className="p-8 text-center text-sm text-neutral-500">
                                    ไม่พบกลุ่มที่ตรงกับ "{groupSearch}"
                                </div>
                            )}
                            {filteredGroups.map((g) => (
                                <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => setSelectedId(g.id)}
                                    className={cn(
                                        'w-full text-left p-3 border-b border-neutral-100 hover:bg-neutral-50 transition flex items-center gap-2.5',
                                        selectedId === g.id && 'bg-indigo-50 border-l-2 border-l-indigo-500',
                                    )}
                                >
                                    {g.cover_image ? (
                                        <img
                                            src={g.cover_image}
                                            alt=""
                                            className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-neutral-200"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-md grid place-items-center bg-neutral-100 text-neutral-400 flex-shrink-0 border border-neutral-200">
                                            <ImageIcon size={14} />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-neutral-900 truncate">
                                            {g.name}
                                        </div>
                                        <div className="text-[11px] text-neutral-500 tabular-nums">
                                            {g.member_count} SKU
                                        </div>
                                    </div>
                                    <ChevronRight size={14} className="text-neutral-300 flex-shrink-0" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ── Right: detail of selected group ─────────────── */}
                    <div className="md:col-span-8 flex flex-col overflow-hidden">
                        {err && (
                            <div className="m-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                                <span>{err}</span>
                            </div>
                        )}

                        {!selectedGroup && !showCreate && (
                            <div className="flex-1 grid place-items-center text-sm text-neutral-500 p-8 text-center">
                                <div>
                                    <Boxes size={28} className="mx-auto mb-3 text-neutral-300" />
                                    เลือกกลุ่มฝั่งซ้ายเพื่อแก้ไข
                                    <br />
                                    หรือกด "สร้างกลุ่มใหม่"
                                </div>
                            </div>
                        )}

                        {showCreate && (
                            <CreateGroupPanel
                                onCancel={() => setShowCreate(false)}
                                onCreate={handleCreate}
                            />
                        )}

                        {selectedGroup && !showCreate && (
                            <GroupDetailPanel
                                key={selectedGroup.id}
                                group={selectedGroup}
                                members={members}
                                unassigned={unassigned}
                                onChanged={async () => {
                                    await loadAll();
                                    onChanged?.();
                                }}
                                onDelete={() => handleDeleteGroup(selectedGroup)}
                                onAddMembers={handleAssign}
                                onRemoveMember={handleRemoveMember}
                            />
                        )}
                    </div>
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

// ─── Create new group ─────────────────────────────────────────────────────

function CreateGroupPanel({
    onCreate,
    onCancel,
}: {
    onCreate: (name: string) => Promise<void> | void;
    onCancel: () => void;
}) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    return (
        <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-md mx-auto space-y-4">
                <div className="text-base font-bold text-neutral-900">สร้างกลุ่มใหม่</div>
                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                        ชื่อกลุ่ม *
                    </Label>
                    <Input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder='เช่น "กระดาษทรายกลมสักหลาด MIRKA GOLD 5"'
                    />
                    <p className="text-[11px] text-neutral-500">
                        รูปกลุ่ม + คำอธิบาย เพิ่มภายหลังได้ในหน้ารายละเอียดกลุ่ม
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        onClick={async () => {
                            if (!name.trim()) return;
                            setSaving(true);
                            try {
                                await onCreate(name);
                            } finally {
                                setSaving(false);
                            }
                        }}
                        disabled={!name.trim() || saving}
                        className="bg-indigo-500 hover:bg-indigo-600 gap-2"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        สร้าง
                    </Button>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                        ยกเลิก
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Right pane: group detail + members ──────────────────────────────────

function GroupDetailPanel({
    group,
    members,
    unassigned,
    onChanged,
    onDelete,
    onAddMembers,
    onRemoveMember,
}: {
    group: ProductGroupWithStats;
    members: ProductWithInventory[];
    unassigned: ProductWithInventory[];
    onChanged: () => Promise<void> | void;
    onDelete: () => void;
    onAddMembers: (productIds: string[]) => Promise<void> | void;
    onRemoveMember: (productId: string) => Promise<void> | void;
}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(group.name);
    const [description, setDescription] = useState(group.description ?? '');
    const [coverUrl, setCoverUrl] = useState(group.cover_image ?? '');
    const [savingMeta, setSavingMeta] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [adding, setAdding] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());

    // Sync local state if a different group becomes selected (parent passes a new `key`)
    useEffect(() => {
        setName(group.name);
        setDescription(group.description ?? '');
        setCoverUrl(group.cover_image ?? '');
        setEditing(false);
        setAddOpen(false);
        setPicked(new Set());
        setSearch('');
    }, [group.id]);

    async function handleSaveMeta() {
        setSavingMeta(true);
        try {
            await productGroupsApi.update(group.id, {
                name: name.trim(),
                description: description.trim() || null,
                cover_image: coverUrl.trim() || null,
            });
            await onChanged();
            setEditing(false);
        } finally {
            setSavingMeta(false);
        }
    }

    async function handleUploadCover(file: File) {
        setUploading(true);
        try {
            const url = await productGroupsApi.uploadCover(group.id, file);
            setCoverUrl(url);
            await productGroupsApi.update(group.id, { cover_image: url });
            await onChanged();
        } finally {
            setUploading(false);
        }
    }

    const filteredCandidates = useMemo(() => {
        // Tokenized AND match — robust to irregular spacing in stored names.
        const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return unassigned;
        return unassigned.filter((p) => {
            const hay = `${p.name_th} ${p.sku} ${p.brand ?? ''}`.toLowerCase();
            return tokens.every((t) => hay.includes(t));
        });
    }, [unassigned, search]);

    return (
        <div className="flex-1 overflow-y-auto">
            {/* Group header */}
            <div className="p-4 border-b border-neutral-200 bg-white">
                <div className="flex items-start gap-4">
                    {/* Cover */}
                    <div className="relative flex-shrink-0">
                        {coverUrl ? (
                            <img
                                src={coverUrl}
                                alt=""
                                className="w-24 h-24 rounded-lg object-cover border border-neutral-200"
                            />
                        ) : (
                            <div className="w-24 h-24 rounded-lg grid place-items-center bg-neutral-100 text-neutral-400 border border-neutral-200">
                                <ImageIcon size={24} />
                            </div>
                        )}
                        <label
                            className={cn(
                                'absolute -bottom-2 -right-2 w-7 h-7 rounded-full grid place-items-center cursor-pointer transition shadow-md',
                                uploading
                                    ? 'bg-neutral-200 text-neutral-500'
                                    : 'bg-indigo-500 hover:bg-indigo-600 text-white',
                            )}
                            title="เปลี่ยนรูป"
                        >
                            {uploading ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Upload size={13} />
                            )}
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploading}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void handleUploadCover(f);
                                    e.target.value = '';
                                }}
                            />
                        </label>
                    </div>

                    {/* Name + actions */}
                    <div className="flex-1 min-w-0">
                        {editing ? (
                            <div className="space-y-2">
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="font-medium"
                                />
                                <textarea
                                    rows={2}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="คำอธิบายกลุ่ม (optional)"
                                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                                />
                                <div className="flex gap-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => void handleSaveMeta()}
                                        disabled={savingMeta || !name.trim()}
                                        className="h-7 bg-indigo-500 hover:bg-indigo-600 gap-1"
                                    >
                                        {savingMeta ? (
                                            <Loader2 size={11} className="animate-spin" />
                                        ) : (
                                            <Save size={11} />
                                        )}
                                        บันทึก
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setName(group.name);
                                            setDescription(group.description ?? '');
                                            setEditing(false);
                                        }}
                                        className="h-7"
                                    >
                                        ยกเลิก
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-start gap-2">
                                    <h3 className="flex-1 text-lg font-bold text-neutral-900">
                                        {group.name}
                                    </h3>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setEditing(true)}
                                        className="h-8 gap-1 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                    >
                                        <Pencil size={11} /> แก้ไข
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={onDelete}
                                        className="h-8 gap-1 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                    >
                                        <Trash2 size={11} /> ลบ
                                    </Button>
                                </div>
                                {group.description && (
                                    <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                                        {group.description}
                                    </p>
                                )}
                                <div className="text-[11px] text-neutral-500 mt-1 tabular-nums">
                                    {members.length} SKU ในกลุ่มนี้
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Members list */}
            <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                        สมาชิกในกลุ่ม
                    </div>
                    {!addOpen && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => setAddOpen(true)}
                            className="h-7 bg-emerald-600 hover:bg-emerald-700 gap-1"
                        >
                            <Plus size={11} /> เพิ่มสินค้าเข้ากลุ่ม
                        </Button>
                    )}
                </div>

                {members.length === 0 && !addOpen && (
                    <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                        ยังไม่มี SKU ในกลุ่มนี้ — กด "เพิ่มสินค้าเข้ากลุ่ม"
                    </div>
                )}

                {members.map((p) => (
                    <div
                        key={p.id}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 flex items-center gap-3"
                    >
                        <code className="text-[11px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                            {p.sku}
                        </code>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm text-neutral-900 truncate">{p.name_th}</div>
                            <div className="text-[11px] text-neutral-500 tabular-nums">
                                {formatTHB(p.price)} · stock {p.total_quantity} {p.unit}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void onRemoveMember(p.id)}
                            className="text-neutral-400 hover:text-red-600 p-1"
                            title="ลบออกจากกลุ่ม (SKU ยังอยู่ในระบบ)"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}

                {/* Add members panel */}
                {addOpen && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-emerald-900">
                                เลือกสินค้าที่ยังไม่อยู่ในกลุ่มอื่น
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setAddOpen(false);
                                    setPicked(new Set());
                                    setSearch('');
                                }}
                                className="text-xs text-neutral-500 hover:underline"
                            >
                                ยกเลิก
                            </button>
                        </div>
                        <div className="relative">
                            <Search
                                size={13}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                            />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="ค้นหา SKU / ชื่อสินค้า / แบรนด์..."
                                className="pl-9 h-9"
                            />
                        </div>
                        <div
                            className="max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white divide-y divide-neutral-100"
                        >
                            {filteredCandidates.length === 0 && (
                                <div className="p-4 text-center text-xs text-neutral-500">
                                    {search
                                        ? 'ไม่พบสินค้าที่ตรงคำค้น'
                                        : 'สินค้าทั้งหมดอยู่ในกลุ่มอื่นแล้ว'}
                                </div>
                            )}
                            {filteredCandidates.map((p) => (
                                <label
                                    key={p.id}
                                    className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={picked.has(p.id)}
                                        onChange={(e) => {
                                            const next = new Set(picked);
                                            if (e.target.checked) next.add(p.id);
                                            else next.delete(p.id);
                                            setPicked(next);
                                        }}
                                        className="w-3.5 h-3.5 rounded border-neutral-300 accent-indigo-600"
                                    />
                                    <code className="text-[11px] text-indigo-700 font-mono flex-shrink-0">
                                        {p.sku}
                                    </code>
                                    <span className="flex-1 text-xs text-neutral-800 truncate">
                                        {p.name_th}
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-neutral-600">
                                เลือก {picked.size} รายการ
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                onClick={async () => {
                                    if (picked.size === 0) return;
                                    setAdding(true);
                                    try {
                                        await onAddMembers(Array.from(picked));
                                        setPicked(new Set());
                                        setSearch('');
                                        setAddOpen(false);
                                    } finally {
                                        setAdding(false);
                                    }
                                }}
                                disabled={picked.size === 0 || adding}
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 gap-1"
                            >
                                {adding ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Plus size={12} />
                                )}
                                เพิ่ม {picked.size} รายการ
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
