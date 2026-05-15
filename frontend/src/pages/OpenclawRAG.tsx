import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BrainCircuit, RefreshCw, Trash2, Search, FileText, Sparkles,
  ExternalLink, MessageCircle, Save, Tag, FolderOpen, Loader2, AlertCircle, CheckCircle,
} from 'lucide-react';
import {
  knowledgeAdminApi,
  knowledgeApi,
  type KnowledgeSource,
  type KnowledgeChunkRow,
  type KnowledgeMatch,
} from '../lib/api';

const CATEGORIES = [
  { value: 'products', label: 'สินค้า' },
  { value: 'policies', label: 'นโยบาย' },
  { value: 'faq', label: 'คำถามที่พบบ่อย' },
  { value: 'procedures', label: 'ขั้นตอนปฏิบัติงาน' },
  { value: 'categories', label: 'หมวดหมู่' },
  { value: 'manual', label: 'อื่นๆ' },
];

type Tab = 'add' | 'browse' | 'test';

export default function OpenclawRAG() {
  const [tab, setTab] = useState<Tab>('add');
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function loadSources() {
    setLoading(true); setErr(null);
    try {
      setSources(await knowledgeAdminApi.listSources());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSources(); }, []);

  const stats = useMemo(() => {
    const chunks = sources.reduce((acc, s) => acc + s.chunks_count, 0);
    const tokens = sources.reduce((acc, s) => acc + s.total_tokens, 0);
    return { sources: sources.length, chunks, tokens };
  }, [sources]);

  const filteredSources = useMemo(() => {
    if (!search) return sources;
    const s = search.toLowerCase();
    return sources.filter(src =>
      src.source_path.toLowerCase().includes(s)
      || (src.title?.toLowerCase().includes(s) ?? false)
      || src.tags.some(t => t.toLowerCase().includes(s))
    );
  }, [sources, search]);

  return (
    <div className="animate-fade-in p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <BrainCircuit className="w-8 h-8 text-indigo-400" />
            Openclaw RAG — Knowledge Base
          </h1>
          <p className="text-slate-400 mt-1">
            ใส่/จัดการเอกสาร ความรู้ — ข้อมูลจะถูก embed + เก็บใน vector store เพื่อใช้ใน <a href="/jnac" className="text-indigo-400 hover:text-indigo-300 underline">JNAC Admin Chat</a>
          </p>
        </div>
        <a
          href="/jnac"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 font-semibold text-sm"
        >
          <MessageCircle size={16} />
          เปิด JNAC Admin Chat
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={<FolderOpen />} label="แหล่งความรู้" value={stats.sources.toString()} color="indigo" />
        <StatTile icon={<FileText />} label="Chunks ทั้งหมด" value={stats.chunks.toString()} color="emerald" />
        <StatTile icon={<Sparkles />} label="Tokens ประมาณ" value={stats.tokens.toLocaleString()} color="amber" />
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle size={14} className="inline mr-2" />{err}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/5">
        {([
          { key: 'add' as Tab,   label: '➕ เพิ่มความรู้',  desc: 'Add Knowledge' },
          { key: 'browse' as Tab, label: '📂 จัดการเอกสาร', desc: 'Browse Sources' },
          { key: 'test' as Tab,  label: '🧪 ทดสอบ RAG',    desc: 'Test Search' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold transition border-b-2 ${
              tab === t.key
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'add'    && <AddKnowledgeTab onAdded={() => void loadSources()} />}
      {tab === 'browse' && <BrowseTab sources={filteredSources} search={search} setSearch={setSearch} loading={loading} onReload={loadSources} />}
      {tab === 'test'   && <TestRAGTab />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Add Knowledge Tab
// ────────────────────────────────────────────────────────────────────────
function AddKnowledgeTab({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('faq');
  const [tagsInput, setTagsInput] = useState('');
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState<'th'|'en'|'mixed'>('th');
  const [visibility, setVisibility] = useState<'public'|'internal'>('public');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true); setErr(null); setSuccess(null);
    try {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
      const result = await knowledgeAdminApi.addManual({
        title, content, category, tags, language, visibility,
      });
      setSuccess(`บันทึก ${result.chunks_count} chunks ที่ ${result.source_path}`);
      setTitle(''); setContent(''); setTagsInput('');
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card space-y-4 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            หัวข้อ * (Title)
          </label>
          <input
            type="text"
            required
            placeholder="เช่น นโยบายการรับประกัน, FAQ การชำระเงิน"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white outline-none focus:border-indigo-500"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <FolderOpen size={12} /> หมวด
          </label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white"
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <Tag size={12} /> แท็ก (คั่นด้วย comma)
          </label>
          <input
            type="text"
            placeholder="เช่น warranty, return, payment"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white outline-none focus:border-indigo-500"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            ภาษา / มองเห็น
          </label>
          <div className="flex gap-2">
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as 'th'|'en'|'mixed')}
              className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
            >
              <option value="th">TH</option>
              <option value="en">EN</option>
              <option value="mixed">Mixed</option>
            </select>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value as 'public'|'internal')}
              className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
            >
              <option value="public">Public</option>
              <option value="internal">Internal</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          เนื้อหา * (Markdown ก็ได้ — ระบบจะแตก chunks ตาม heading `##` อัตโนมัติ)
        </label>
        <textarea
          required
          rows={14}
          placeholder={`# หัวข้อหลัก\n\n## หัวข้อย่อยที่ 1\n\nเนื้อหา...\n\n## หัวข้อย่อยที่ 2\n\nเนื้อหาเพิ่ม...`}
          value={content}
          onChange={e => setContent(e.target.value)}
          className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500 font-mono text-sm resize-y"
        />
        <div className="text-xs text-slate-500">
          ประมาณ {Math.ceil(content.length / 3)} tokens — จะถูกแตกเป็น ~{Math.max(1, Math.ceil(content.length / 1500))} chunks
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle size={14} className="inline mr-2" />{err}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle size={14} className="inline mr-2" />{success}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !title.trim() || !content.trim()}
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-lg shadow-lg shadow-indigo-500/20"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'กำลัง embed + บันทึก...' : 'บันทึก + Embed'}
        </button>
        <span className="text-xs text-slate-500">
          ระบบจะใช้ OpenAI text-embedding-3-small (1536 dim) สร้าง embedding อัตโนมัติ
        </span>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Browse Tab
// ────────────────────────────────────────────────────────────────────────
function BrowseTab({
  sources, search, setSearch, loading, onReload,
}: {
  sources: KnowledgeSource[];
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  onReload: () => void;
}) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunkRow[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  useEffect(() => {
    if (!selectedSource) return;
    setChunksLoading(true);
    knowledgeAdminApi.listChunksForSource(selectedSource)
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Source list */}
      <div className="glass-card p-0 overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="ค้นหาแหล่ง / tag..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
            />
          </div>
          <button onClick={onReload} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 600 }}>
          {loading && <div className="p-6 text-sm text-slate-500 text-center">กำลังโหลด...</div>}
          {!loading && sources.length === 0 && (
            <div className="p-6 text-sm text-slate-500 text-center">ยังไม่มีความรู้ในระบบ — เริ่มเพิ่มที่แท็บ "เพิ่มความรู้"</div>
          )}
          {sources.map(src => (
            <button
              key={src.source_path}
              onClick={() => setSelectedSource(src.source_path)}
              className={`w-full text-left p-3 border-b border-white/5 hover:bg-white/5 transition ${
                selectedSource === src.source_path ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-xs text-indigo-400 truncate">{src.source_path}</span>
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                  {src.source_type}
                </span>
              </div>
              {src.title && <div className="text-sm font-medium text-white truncate">{src.title}</div>}
              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                <span>📄 {src.chunks_count} chunks</span>
                <span>~{src.total_tokens} tokens</span>
                <span className={`px-1.5 py-0.5 rounded ${src.visibility === 'public' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  {src.visibility}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chunk detail */}
      <div className="glass-card p-0 overflow-hidden">
        {!selectedSource && (
          <div className="p-12 text-center text-slate-500 text-sm">
            <FileText size={32} className="mx-auto mb-3 text-slate-600" />
            เลือก source ฝั่งซ้ายเพื่อดู chunks ภายใน
          </div>
        )}
        {selectedSource && (
          <>
            <div className="p-4 border-b border-white/5 flex items-center justify-between gap-2">
              <code className="text-xs text-indigo-400 truncate">{selectedSource}</code>
              <button
                onClick={() => handleDelete(selectedSource)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20"
              >
                <Trash2 size={12} /> ลบทั้งหมด
              </button>
            </div>
            <div className="overflow-y-auto custom-scrollbar p-4 space-y-3" style={{ maxHeight: 600 }}>
              {chunksLoading && <div className="text-sm text-slate-500 text-center">โหลด chunks...</div>}
              {!chunksLoading && chunks.map(c => (
                <div key={c.id} className="rounded-lg border border-white/5 bg-slate-900/50 p-3">
                  <div className="flex items-center justify-between mb-2 text-[10px]">
                    <span className="font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">#{c.chunk_index}</span>
                    <span className="text-slate-500">{c.token_count ?? '?'} tokens</span>
                  </div>
                  <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{c.content}</div>
                  {c.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {c.tags.map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Test RAG Tab
// ────────────────────────────────────────────────────────────────────────
function TestRAGTab() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<KnowledgeMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ embed_ms: number; search_ms: number } | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setErr(null);
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
    <div className="glass-card space-y-4 max-w-3xl">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        🧪 หน้านี้ใช้ทดสอบคุณภาพ RAG retrieval เท่านั้น — ผู้ใช้จริงควรไปถามที่ <a href="/jnac" className="underline font-bold">JNAC Admin Chat</a>
      </div>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder="ลองพิมพ์คำถาม เช่น 'คืนสินค้าได้กี่วัน'"
          value={query}
          onChange={e => setQuery(e.target.value)}
          disabled={loading}
          className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold px-5 rounded-lg"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          ค้นหา
        </button>
      </form>

      {err && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertCircle size={14} className="inline mr-2" />{err}
        </div>
      )}

      {meta && (
        <div className="text-xs text-slate-500 flex gap-4">
          <span>⚡ embed: {meta.embed_ms}ms</span>
          <span>🔍 search: {meta.search_ms}ms</span>
          <span>📊 {matches.length} matches</span>
        </div>
      )}

      <div className="space-y-3">
        {matches.map((m, i) => (
          <div key={m.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">#{i + 1}</span>
                <span className="text-sm font-semibold text-white">{m.title ?? 'Untitled'}</span>
              </div>
              <span className="text-xs font-mono text-emerald-400">
                {(m.similarity * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
              {m.content.slice(0, 400)}{m.content.length > 400 ? '...' : ''}
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-2">{m.source_path}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo:  'bg-indigo-500/20 border-indigo-500/30 text-indigo-400',
    emerald: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    amber:   'bg-amber-500/20 border-amber-500/30 text-amber-400',
  };
  return (
    <div className="glass-card flex items-center gap-4 py-4 px-5">
      <div className={`p-3 rounded-xl border ${colorMap[color]}`}>{icon}</div>
      <div>
        <p className="text-sm text-slate-400 mb-0.5">{label}</p>
        <h3 className="text-xl font-bold text-white">{value}</h3>
      </div>
    </div>
  );
}
