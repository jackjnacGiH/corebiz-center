import { useEffect, useRef, useState, useMemo } from 'react';
import {
    MessageSquareText,
    Search,
    Star,
    Pencil,
    Trash2,
    Plus,
    Check,
    X,
    Loader2,
    AlertCircle,
    Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { chatQuickReplyApi, type ChatQuickReplyTemplate } from '../../lib/api';

/**
 * Self-contained quick-reply ("ข้อความตอบกลับที่ตั้งไว้") button + panel for
 * the Omni-Chat composer, mirroring LINE OA's saved-reply picker.
 *
 * Templates are shared team-wide (is_staff RLS) and managed inline here:
 *   - click a row     → insert its text into the composer (onPick) + close
 *   - ★ star          → favourite (favourites sort to the top)
 *   - ✎ edit / 🗑 delete (two-click confirm)
 *   - ＋ new           → inline editor (optionally pre-filled with the
 *                        current draft so the agent can save what they typed)
 */
export default function QuickReplyButton({
    draft,
    onPick,
    disabled,
}: {
    draft: string;
    onPick: (content: string) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [templates, setTemplates] = useState<ChatQuickReplyTemplate[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    // Inline editor: null = browsing the list; otherwise we're editing
    // `editing` (an existing template) or creating a new one (editing=null
    // with mode='new').
    const [mode, setMode] = useState<'list' | 'editor'>('list');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ title: '', content: '' });
    const [saving, setSaving] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const wrapRef = useRef<HTMLDivElement>(null);

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            setTemplates(await chatQuickReplyApi.list());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    // Load when first opened; reset transient UI state on close.
    useEffect(() => {
        if (open) {
            void load();
        } else {
            setMode('list');
            setEditingId(null);
            setConfirmDeleteId(null);
            setSearch('');
        }
    }, [open]);

    // Close on outside-click / Escape.
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
        const s = search.trim().toLowerCase();
        if (!s) return templates;
        return templates.filter(
            (t) => t.title.toLowerCase().includes(s) || t.content.toLowerCase().includes(s),
        );
    }, [templates, search]);

    function startNew(prefill = '') {
        setEditingId(null);
        setForm({ title: '', content: prefill });
        setMode('editor');
    }
    function startEdit(t: ChatQuickReplyTemplate) {
        setEditingId(t.id);
        setForm({ title: t.title, content: t.content });
        setMode('editor');
    }

    async function save() {
        const title = form.title.trim();
        const content = form.content.trim();
        if (!title || !content || saving) return;
        setSaving(true);
        setErr(null);
        try {
            if (editingId) {
                await chatQuickReplyApi.update(editingId, { title, content });
            } else {
                await chatQuickReplyApi.create({ title, content });
            }
            await load();
            setMode('list');
            setEditingId(null);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function toggleFav(t: ChatQuickReplyTemplate) {
        // Optimistic
        setTemplates((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, is_favorite: !x.is_favorite } : x)),
        );
        try {
            await chatQuickReplyApi.update(t.id, { is_favorite: !t.is_favorite });
            await load();
        } catch (e) {
            setErr((e as Error).message);
            await load();
        }
    }

    async function del(id: string) {
        try {
            await chatQuickReplyApi.remove(id);
            setConfirmDeleteId(null);
            await load();
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                title="ข้อความตอบกลับที่ตั้งไว้"
                className={cn(
                    'grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed',
                    open && 'text-indigo-600 bg-indigo-50',
                )}
            >
                <MessageSquareText size={18} />
            </button>

            {open && (
                <div className="absolute bottom-full mb-2 left-0 z-30 w-[348px] rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
                        <span className="text-xs font-bold text-neutral-700 inline-flex items-center gap-1.5">
                            <MessageSquareText size={13} className="text-indigo-500" />
                            ข้อความตอบกลับที่ตั้งไว้
                        </span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-neutral-400 hover:text-neutral-700"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {err && (
                        <div className="m-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5 flex items-start gap-1">
                            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                            <span>{err}</span>
                        </div>
                    )}

                    {mode === 'editor' ? (
                        /* ── Inline editor (new / edit) ───────────────────── */
                        <div className="p-3 flex flex-col gap-2">
                            <div className="text-[11px] font-semibold text-neutral-500">
                                {editingId ? 'แก้ไขข้อความตอบกลับ' : 'เพิ่มข้อความตอบกลับใหม่'}
                            </div>
                            <input
                                type="text"
                                value={form.title}
                                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                                placeholder="ชื่อ (เช่น ทักทาย, แจ้งเลขพัสดุ)"
                                maxLength={60}
                                autoFocus
                                className="w-full h-8 rounded-md border border-neutral-200 px-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                            <textarea
                                value={form.content}
                                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                                placeholder="ข้อความ..."
                                rows={4}
                                className="w-full rounded-md border border-neutral-200 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none"
                            />
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setMode('list'); setEditingId(null); }}
                                    className="h-8 px-3 rounded-md text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                                >
                                    ยกเลิก
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void save()}
                                    disabled={saving || !form.title.trim() || !form.content.trim()}
                                    className="h-8 px-3 rounded-md text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-1.5 disabled:opacity-40"
                                >
                                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                    บันทึก
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* ── Template list ────────────────────────────────── */
                        <>
                            <div className="p-2 border-b border-neutral-100">
                                <div className="relative">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="ค้นหาข้อความตอบกลับ..."
                                        className="w-full pl-7 pr-2 h-8 rounded-md border border-neutral-200 bg-neutral-50 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                            </div>

                            <div className="max-h-[260px] overflow-y-auto">
                                {loading && (
                                    <div className="p-5 text-center text-xs text-neutral-500">
                                        <Loader2 size={14} className="animate-spin inline mr-1" /> กำลังโหลด...
                                    </div>
                                )}
                                {!loading && filtered.length === 0 && (
                                    <div className="p-5 text-center text-xs text-neutral-400">
                                        {search ? 'ไม่พบข้อความที่ค้นหา' : 'ยังไม่มีข้อความตอบกลับ'}
                                    </div>
                                )}
                                {filtered.map((t) => (
                                    <div
                                        key={t.id}
                                        className="group flex items-start gap-1 px-2 py-2 border-b border-neutral-50 hover:bg-indigo-50/40"
                                    >
                                        {/* Click body → insert into composer */}
                                        <button
                                            type="button"
                                            onClick={() => { onPick(t.content); setOpen(false); }}
                                            className="flex-1 min-w-0 text-left"
                                            title="คลิกเพื่อใส่ข้อความนี้ในช่องพิมพ์"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                {t.is_favorite && (
                                                    <Star size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />
                                                )}
                                                <span className="text-xs font-semibold text-neutral-800 truncate">
                                                    {t.title}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                                                {t.content}
                                            </p>
                                        </button>

                                        {/* Row actions */}
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                            {confirmDeleteId === t.id ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => void del(t.id)}
                                                        title="ยืนยันลบ"
                                                        className="p-1 rounded text-white bg-red-500 hover:bg-red-600"
                                                    >
                                                        <Check size={12} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDeleteId(null)}
                                                        title="ยกเลิก"
                                                        className="p-1 rounded text-neutral-500 hover:bg-neutral-100"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => void toggleFav(t)}
                                                        title={t.is_favorite ? 'เอาออกจากรายการโปรด' : 'ปักหมุดเป็นรายการโปรด'}
                                                        className={cn(
                                                            'p-1 rounded hover:bg-amber-50 transition',
                                                            t.is_favorite ? 'text-amber-400' : 'text-neutral-300 hover:text-amber-400',
                                                        )}
                                                    >
                                                        <Star size={13} className={t.is_favorite ? 'fill-amber-400' : ''} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(t)}
                                                        title="แก้ไข"
                                                        className="p-1 rounded text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Pencil size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDeleteId(t.id)}
                                                        title="ลบ"
                                                        className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Footer actions */}
                            <div className="p-2 border-t border-neutral-100 bg-neutral-50 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => startNew('')}
                                    className="flex-1 h-8 rounded-md text-xs font-semibold text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 inline-flex items-center justify-center gap-1.5"
                                >
                                    <Plus size={13} /> เพิ่มใหม่
                                </button>
                                {draft.trim() && (
                                    <button
                                        type="button"
                                        onClick={() => startNew(draft.trim())}
                                        title="บันทึกข้อความที่พิมพ์อยู่เป็นเทมเพลตใหม่"
                                        className="flex-1 h-8 rounded-md text-xs font-semibold text-emerald-700 bg-white border border-emerald-200 hover:bg-emerald-50 inline-flex items-center justify-center gap-1.5"
                                    >
                                        <Save size={13} /> บันทึกข้อความนี้
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
