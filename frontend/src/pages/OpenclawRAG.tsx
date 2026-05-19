import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
    BrainCircuit,
    RefreshCw,
    Trash2,
    Search,
    FileText,
    Sparkles,
    ExternalLink,
    MessageCircle,
    Save,
    Tag,
    FolderOpen,
    Loader2,
    AlertCircle,
    CheckCircle,
    Plus,
    FileEdit,
    FlaskConical,
} from 'lucide-react';
import {
    knowledgeAdminApi,
    knowledgeApi,
    knowledgeCategoriesApi,
    type KnowledgeSource,
    type KnowledgeChunkRow,
    type KnowledgeMatch,
    type KnowledgeCategory,
} from '../lib/api';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import PageHeader from '../components/PageHeader';
import StatTile from '../components/StatTile';
import CategoryManagerModal from '../components/CategoryManagerModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Fallback categories shown only when the categories table is empty / the
 * DB query fails. The real source of truth is `knowledge_categories` —
 * staff can manage it via the CategoryManagerModal.
 */
const FALLBACK_CATEGORIES: KnowledgeCategory[] = [
    { id: 'fallback-faq', value: 'faq', label: 'คำถามที่พบบ่อย', sort_order: 0, created_at: '', updated_at: '' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Editing payload handed from BrowseTab → AddKnowledgeTab when the user
 * clicks "แก้ไข" on an existing source. The form pre-fills with these
 * values; on save we call `replaceManual` (delete-then-insert) instead of
 * the regular `addManual` so the source_path stays stable.
 */
export interface EditingSource {
    source_path: string;
    title: string;
    category: string;
    tags: string[];
    language: 'th' | 'en' | 'mixed';
    visibility: 'public' | 'internal';
    content: string; // reconstructed by joining chunks in order
}

export default function OpenclawRAG() {
    const [tab, setTab] = useState<'add' | 'browse' | 'test'>('add');
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [categories, setCategories] = useState<KnowledgeCategory[]>(FALLBACK_CATEGORIES);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    /** Non-null when the form should run in "edit mode" instead of "add mode". */
    const [editing, setEditing] = useState<EditingSource | null>(null);
    const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);

    async function loadSources() {
        setLoading(true);
        setErr(null);
        try {
            setSources(await knowledgeAdminApi.listSources());
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    async function loadCategories() {
        try {
            const list = await knowledgeCategoriesApi.list();
            if (list.length > 0) setCategories(list);
            // If empty, keep the FALLBACK so the form is at least usable.
        } catch (e) {
            console.warn('loadCategories failed, using fallback:', e);
        }
    }

    useEffect(() => {
        void loadSources();
        void loadCategories();
    }, []);
    // When another tab/user edits categories, refresh ours so the dropdown stays in sync.
    useRealtimeTable('knowledge_categories', () => void loadCategories());

    const stats = useMemo(() => {
        const chunks = sources.reduce((acc, s) => acc + s.chunks_count, 0);
        const tokens = sources.reduce((acc, s) => acc + s.total_tokens, 0);
        return { sources: sources.length, chunks, tokens };
    }, [sources]);

    const filteredSources = useMemo(() => {
        if (!search) return sources;
        const s = search.toLowerCase();
        return sources.filter(
            (src) =>
                src.source_path.toLowerCase().includes(s) ||
                (src.title?.toLowerCase().includes(s) ?? false) ||
                src.tags.some((t) => t.toLowerCase().includes(s)),
        );
    }, [sources, search]);

    return (
        <div className="animate-fade-in space-y-6">
            <PageHeader
                title="RAG — Knowledge Base"
                subtitle={
                    'ใส่/จัดการเอกสาร ความรู้ — ข้อมูลจะถูก embed + เก็บใน vector store เพื่อใช้ใน AI Admin Chat'
                }
                icon={<BrainCircuit size={20} />}
                actions={
                    <a
                        href="/ask"
                        className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-semibold transition"
                    >
                        <MessageCircle size={14} />
                        เปิด AI Admin Chat
                        <ExternalLink size={11} />
                    </a>
                }
            />

            {/* ── KPI ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                    icon={<FolderOpen size={18} />}
                    label="แหล่งความรู้"
                    value={stats.sources.toString()}
                    tone="indigo"
                />
                <StatTile
                    icon={<FileText size={18} />}
                    label="Chunks ทั้งหมด"
                    value={stats.chunks.toString()}
                    tone="emerald"
                />
                <StatTile
                    icon={<Sparkles size={18} />}
                    label="Tokens ประมาณ"
                    value={stats.tokens.toLocaleString()}
                    tone="amber"
                />
            </div>

            {err && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{err}</span>
                </div>
            )}

            {/* ── Tabs ────────────────────────────────────────────────── */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
                <TabsList className="bg-neutral-100">
                    <TabsTrigger value="add" className="gap-2">
                        <Plus size={14} /> เพิ่มความรู้
                    </TabsTrigger>
                    <TabsTrigger value="browse" className="gap-2">
                        <FileEdit size={14} /> จัดการเอกสาร
                    </TabsTrigger>
                    <TabsTrigger value="test" className="gap-2">
                        <FlaskConical size={14} /> ทดสอบ RAG
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="add">
                    <AddKnowledgeTab
                        editing={editing}
                        categories={categories}
                        onManageCategories={() => setIsCategoryManagerOpen(true)}
                        onDone={() => {
                            setEditing(null);
                            void loadSources();
                        }}
                        onCancelEdit={() => setEditing(null)}
                    />
                </TabsContent>
                <TabsContent value="browse">
                    <BrowseTab
                        sources={filteredSources}
                        search={search}
                        setSearch={setSearch}
                        loading={loading}
                        onReload={loadSources}
                        onEditRequest={(e) => {
                            setEditing(e);
                            setTab('add');
                        }}
                    />
                </TabsContent>
                <TabsContent value="test">
                    <TestRAGTab />
                </TabsContent>
            </Tabs>

            <CategoryManagerModal
                isOpen={isCategoryManagerOpen}
                onClose={() => setIsCategoryManagerOpen(false)}
                onChanged={() => void loadCategories()}
            />
        </div>
    );
}

// ─── Add Knowledge Tab ────────────────────────────────────────────────────────

function AddKnowledgeTab({
    editing,
    categories,
    onManageCategories,
    onDone,
    onCancelEdit,
}: {
    editing: EditingSource | null;
    categories: KnowledgeCategory[];
    onManageCategories: () => void;
    onDone: () => void;
    onCancelEdit: () => void;
}) {
    const [title, setTitle] = useState('');
    // Default to the first available category — keeps the dropdown valid even
    // if 'faq' was deleted by the operator.
    const [category, setCategory] = useState(categories[0]?.value ?? 'manual');
    const [tagsInput, setTagsInput] = useState('');
    const [content, setContent] = useState('');
    const [language, setLanguage] = useState<'th' | 'en' | 'mixed'>('th');
    const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const isEditMode = editing !== null;

    // When BrowseTab signals an edit, copy the source into the form. Reset
    // when the parent clears `editing` (after a successful save or cancel).
    useEffect(() => {
        if (editing) {
            setTitle(editing.title);
            setCategory(editing.category);
            setTagsInput(editing.tags.join(', '));
            setContent(editing.content);
            setLanguage(editing.language);
            setVisibility(editing.visibility);
            setErr(null);
            setSuccess(null);
        }
    }, [editing]);

    // If the currently-selected category gets deleted (live via realtime),
    // fall back to the first available one so the dropdown never points at
    // an invalid value.
    useEffect(() => {
        if (categories.length === 0) return;
        if (!categories.some((c) => c.value === category)) {
            setCategory(categories[0].value);
        }
    }, [categories, category]);

    function resetForm() {
        setTitle('');
        setCategory('faq');
        setTagsInput('');
        setContent('');
        setLanguage('th');
        setVisibility('public');
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!title.trim() || !content.trim()) return;
        setSaving(true);
        setErr(null);
        setSuccess(null);
        try {
            const tags = tagsInput
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            const payload = { title, content, category, tags, language, visibility };
            const result = isEditMode
                ? await knowledgeAdminApi.replaceManual({
                      ...payload,
                      source_path: editing!.source_path,
                  })
                : await knowledgeAdminApi.addManual(payload);
            setSuccess(
                isEditMode
                    ? `อัปเดต ${result.chunks_count} chunks ที่ ${result.source_path}`
                    : `บันทึก ${result.chunks_count} chunks ที่ ${result.source_path}`,
            );
            if (!isEditMode) resetForm();
            onDone();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    const selectClass =
        'w-full h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

    return (
        <Card className="max-w-3xl gap-5 py-6">
            <CardContent className="px-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                    {isEditMode && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            <FileEdit size={16} className="mt-0.5 flex-shrink-0 text-amber-700" />
                            <div className="flex-1">
                                <div className="font-semibold">โหมดแก้ไข</div>
                                <div className="text-xs text-amber-700 mt-0.5">
                                    กำลังแก้ไข{' '}
                                    <code className="bg-white border border-amber-200 px-1 py-0.5 rounded font-mono">
                                        {editing!.source_path}
                                    </code>
                                    {' '}— บันทึกแล้วระบบจะลบ chunks เดิมและสร้างใหม่ทั้งหมด
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onCancelEdit}
                                className="text-xs font-semibold text-amber-700 hover:underline flex-shrink-0"
                            >
                                ยกเลิกการแก้ไข
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="title" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                หัวข้อ * (Title)
                            </Label>
                            <Input
                                id="title"
                                required
                                placeholder="เช่น นโยบายการรับประกัน, FAQ การชำระเงิน"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="category" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider flex items-center gap-1">
                                    <FolderOpen size={11} /> หมวด
                                </Label>
                                <button
                                    type="button"
                                    onClick={onManageCategories}
                                    className="text-[10px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                                    title="เพิ่ม / แก้ไข / ลบ หมวด"
                                >
                                    <FileEdit size={9} /> จัดการ
                                </button>
                            </div>
                            <select
                                id="category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className={selectClass}
                            >
                                {categories.map((c) => (
                                    <option key={c.id} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                                {/* Preserve the editing source's category even if it was
                                    deleted from the categories table — show it as a
                                    disabled hint so the user knows what's selected. */}
                                {editing && !categories.some((c) => c.value === category) && (
                                    <option key="orphan" value={category} disabled>
                                        {category} (หมวดถูกลบไปแล้ว)
                                    </option>
                                )}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="tags" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider flex items-center gap-1">
                                <Tag size={11} /> แท็ก (คั่นด้วย comma)
                            </Label>
                            <Input
                                id="tags"
                                placeholder="เช่น warranty, return, payment"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                                ภาษา / มองเห็น
                            </Label>
                            <div className="flex gap-2">
                                <select
                                    value={language}
                                    onChange={(e) =>
                                        setLanguage(e.target.value as 'th' | 'en' | 'mixed')
                                    }
                                    className={selectClass}
                                >
                                    <option value="th">TH</option>
                                    <option value="en">EN</option>
                                    <option value="mixed">Mixed</option>
                                </select>
                                <select
                                    value={visibility}
                                    onChange={(e) =>
                                        setVisibility(e.target.value as 'public' | 'internal')
                                    }
                                    className={selectClass}
                                >
                                    <option value="public">Public</option>
                                    <option value="internal">Internal</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="content" className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                            เนื้อหา * (Markdown ก็ได้ — ระบบจะแตก chunks ตาม heading `##` อัตโนมัติ)
                        </Label>
                        <textarea
                            id="content"
                            required
                            rows={14}
                            placeholder={
                                '# หัวข้อหลัก\n\n## หัวข้อย่อยที่ 1\n\nเนื้อหา...\n\n## หัวข้อย่อยที่ 2\n\nเนื้อหาเพิ่ม...'
                            }
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-mono resize-y"
                        />
                        <div className="text-xs text-neutral-500 tabular-nums">
                            ประมาณ {Math.ceil(content.length / 3)} tokens — จะถูกแตกเป็น ~
                            {Math.max(1, Math.ceil(content.length / 1500))} chunks
                        </div>
                    </div>

                    {err && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{err}</span>
                        </div>
                    )}
                    {success && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{success}</span>
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <Button
                            type="submit"
                            disabled={saving || !title.trim() || !content.trim()}
                            className={cn(
                                'gap-2',
                                isEditMode
                                    ? 'bg-amber-600 hover:bg-amber-700'
                                    : 'bg-indigo-500 hover:bg-indigo-600',
                            )}
                        >
                            {saving ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Save size={14} />
                            )}
                            {saving
                                ? isEditMode
                                    ? 'กำลังอัปเดต + re-embed...'
                                    : 'กำลัง embed + บันทึก...'
                                : isEditMode
                                  ? 'บันทึกการแก้ไข'
                                  : 'บันทึก + Embed'}
                        </Button>
                        {isEditMode && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onCancelEdit}
                                disabled={saving}
                            >
                                ยกเลิก
                            </Button>
                        )}
                        <span className="text-xs text-neutral-500">
                            ระบบใช้ OpenAI text-embedding-3-small (1536 dim) สร้าง embedding อัตโนมัติ
                        </span>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

// ─── Browse Tab ───────────────────────────────────────────────────────────────

function BrowseTab({
    sources,
    search,
    setSearch,
    loading,
    onReload,
    onEditRequest,
}: {
    sources: KnowledgeSource[];
    search: string;
    setSearch: (s: string) => void;
    loading: boolean;
    onReload: () => void;
    onEditRequest: (e: EditingSource) => void;
}) {
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [chunks, setChunks] = useState<KnowledgeChunkRow[]>([]);
    const [chunksLoading, setChunksLoading] = useState(false);

    useEffect(() => {
        if (!selectedSource) return;
        setChunksLoading(true);
        knowledgeAdminApi
            .listChunksForSource(selectedSource)
            .then(setChunks)
            .finally(() => setChunksLoading(false));
    }, [selectedSource]);

    async function handleDelete(source_path: string) {
        if (!window.confirm(`ลบ "${source_path}" ทั้งหมดใช่ไหม?`)) return;
        try {
            await knowledgeAdminApi.deleteSource(source_path);
            setSelectedSource(null);
            setChunks([]);
            onReload();
        } catch (e) {
            alert((e as Error).message);
        }
    }

    /**
     * Reconstruct the markdown content from the source's chunks so the user
     * can edit it. We join the chunks in `chunk_index` order; each chunk
     * already includes its `## heading` (added by the chunker), so the
     * concatenation is a faithful round-trip of the original markdown body.
     */
    async function handleEdit(source_path: string) {
        try {
            const all = await knowledgeAdminApi.listChunksForSource(source_path);
            if (all.length === 0) {
                alert('ไม่พบ chunks ของแหล่งนี้ — อาจถูกลบไปแล้ว');
                return;
            }
            const sorted = [...all].sort((a, b) => a.chunk_index - b.chunk_index);
            const reconstructed = sorted.map((c) => c.content).join('\n\n');
            const first = sorted[0];
            onEditRequest({
                source_path,
                title: first.title ?? '',
                category: first.source_type,
                tags: first.tags ?? [],
                language: (first.language as 'th' | 'en' | 'mixed') ?? 'th',
                visibility: (first.visibility as 'public' | 'internal') ?? 'public',
                content: reconstructed,
            });
        } catch (e) {
            alert((e as Error).message);
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source list */}
            <Card className="gap-0 py-0 overflow-hidden">
                <div className="p-3 border-b border-neutral-200 flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <input
                            type="text"
                            placeholder="ค้นหาแหล่ง / tag..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-200 bg-neutral-50 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                        />
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={onReload}
                        disabled={loading}
                        className="h-9 w-9"
                    >
                        <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                    </Button>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 600 }}>
                    {loading && (
                        <div className="p-6 text-sm text-neutral-500 text-center">
                            กำลังโหลด...
                        </div>
                    )}
                    {!loading && sources.length === 0 && (
                        <div className="p-8 text-sm text-neutral-500 text-center">
                            ยังไม่มีความรู้ในระบบ — เริ่มเพิ่มที่แท็บ "เพิ่มความรู้"
                        </div>
                    )}
                    {sources.map((src) => (
                        <button
                            key={src.source_path}
                            onClick={() => setSelectedSource(src.source_path)}
                            className={cn(
                                'w-full text-left p-3 border-b border-neutral-200 hover:bg-neutral-50 transition',
                                selectedSource === src.source_path &&
                                    'bg-indigo-50 border-l-2 border-l-indigo-500',
                            )}
                        >
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-mono text-xs text-indigo-600 truncate">
                                    {src.source_path}
                                </span>
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 tracking-wider">
                                    {src.source_type}
                                </span>
                            </div>
                            {src.title && (
                                <div className="text-sm font-medium text-neutral-900 truncate">
                                    {src.title}
                                </div>
                            )}
                            <div className="flex items-center gap-2.5 mt-1 text-[10px] text-neutral-500 tabular-nums">
                                <span>📄 {src.chunks_count} chunks</span>
                                <span>~{src.total_tokens} tokens</span>
                                <span
                                    className={cn(
                                        'px-1.5 py-0.5 rounded',
                                        src.visibility === 'public'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-amber-50 text-amber-700',
                                    )}
                                >
                                    {src.visibility}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </Card>

            {/* Chunk detail */}
            <Card className="gap-0 py-0 overflow-hidden">
                {!selectedSource && (
                    <div className="p-12 text-center text-neutral-500 text-sm">
                        <FileText size={32} className="mx-auto mb-3 text-neutral-300" />
                        เลือก source ฝั่งซ้ายเพื่อดู chunks ภายใน
                    </div>
                )}
                {selectedSource && (
                    <>
                        <div className="p-3 border-b border-neutral-200 flex items-center justify-between gap-2">
                            <code className="text-xs text-indigo-600 truncate">
                                {selectedSource}
                            </code>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleEdit(selectedSource)}
                                    className="h-8 gap-1 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                                    title="แก้ไขเอกสารนี้ — ระบบจะ delete + re-embed"
                                >
                                    <FileEdit size={12} /> แก้ไข
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDelete(selectedSource)}
                                    className="h-8 gap-1 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                                >
                                    <Trash2 size={12} /> ลบทั้งหมด
                                </Button>
                            </div>
                        </div>
                        <div
                            className="overflow-y-auto p-4 space-y-3"
                            style={{ maxHeight: 600 }}
                        >
                            {chunksLoading && (
                                <div className="text-sm text-neutral-500 text-center py-4">
                                    โหลด chunks...
                                </div>
                            )}
                            {!chunksLoading &&
                                chunks.map((c) => (
                                    <div
                                        key={c.id}
                                        className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                                    >
                                        <div className="flex items-center justify-between mb-2 text-[10px]">
                                            <span className="font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                                                #{c.chunk_index}
                                            </span>
                                            <span className="text-neutral-500 tabular-nums">
                                                {c.token_count ?? '?'} tokens
                                            </span>
                                        </div>
                                        <div className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">
                                            {c.content}
                                        </div>
                                        {c.tags.length > 0 && (
                                            <div className="flex gap-1 mt-2 flex-wrap">
                                                {c.tags.map((t) => (
                                                    <span
                                                        key={t}
                                                        className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-neutral-200 text-neutral-600"
                                                    >
                                                        {t}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
}

// ─── Test RAG Tab ─────────────────────────────────────────────────────────────

function TestRAGTab() {
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<KnowledgeMatch[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [meta, setMeta] = useState<{ embed_ms: number; search_ms: number } | null>(null);

    async function handleSearch(e: FormEvent) {
        e.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        setErr(null);
        try {
            const result = await knowledgeApi.ask(query, { matchCount: 5, threshold: 0.4 });
            setMatches(result.matches);
            setMeta({ embed_ms: result.embed_ms, search_ms: result.search_ms });
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Card className="max-w-3xl gap-5 py-6">
            <CardContent className="px-6 space-y-4">
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    <FlaskConical size={16} className="mt-0.5 flex-shrink-0" />
                    <span>
                        หน้านี้ใช้ทดสอบคุณภาพ RAG retrieval เท่านั้น — ผู้ใช้จริงควรไปถามที่{' '}
                        <a href="/ask" className="underline font-bold">
                            AI Admin Chat
                        </a>
                    </span>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2">
                    <Input
                        type="text"
                        placeholder="ลองพิมพ์คำถาม เช่น 'คืนสินค้าได้กี่วัน'"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={loading}
                        className="flex-1"
                    />
                    <Button
                        type="submit"
                        disabled={loading || !query.trim()}
                        className="gap-2 bg-indigo-500 hover:bg-indigo-600"
                    >
                        {loading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Search size={14} />
                        )}
                        ค้นหา
                    </Button>
                </form>

                {err && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <span>{err}</span>
                    </div>
                )}

                {meta && (
                    <div className="text-xs text-neutral-500 flex gap-4 tabular-nums">
                        <span>⚡ embed: {meta.embed_ms}ms</span>
                        <span>🔍 search: {meta.search_ms}ms</span>
                        <span>📊 {matches.length} matches</span>
                    </div>
                )}

                <div className="space-y-3">
                    {matches.map((m, i) => (
                        <div
                            key={m.id}
                            className="rounded-lg border border-neutral-200 bg-white p-4"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                                        #{i + 1}
                                    </span>
                                    <span className="text-sm font-semibold text-neutral-900">
                                        {m.title ?? 'Untitled'}
                                    </span>
                                </div>
                                <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                                    {(m.similarity * 100).toFixed(0)}%
                                </span>
                            </div>
                            <div className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">
                                {m.content.slice(0, 400)}
                                {m.content.length > 400 ? '...' : ''}
                            </div>
                            <div className="text-[10px] text-neutral-500 font-mono mt-2">
                                {m.source_path}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
