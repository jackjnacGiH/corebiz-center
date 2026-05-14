import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BrainCircuit, Send, Sparkles, Loader2, ExternalLink } from 'lucide-react';
import { knowledgeApi, type KnowledgeMatch } from '../lib/api';

interface ChatTurn {
  id: string;
  role: 'user' | 'system';
  text: string;
  matches?: KnowledgeMatch[];
  embed_ms?: number;
  search_ms?: number;
}

const SAMPLE_QUESTIONS = [
  'คืนสินค้าได้กี่วัน',
  'มีใบกำกับภาษีไหม',
  'ส่งของไปต่างจังหวัดกี่วัน',
  'สมัครเป็นตัวแทนจำหน่ายได้ไหม',
  'รับบัตรเครดิตไหม',
];

function relativeScore(score: number): string {
  if (score >= 0.7) return 'ตรงมาก';
  if (score >= 0.5) return 'ค่อนข้างตรง';
  if (score >= 0.4) return 'พอเกี่ยวข้อง';
  return 'น้อย';
}

export default function OpenclawRAG() {
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'system',
      text: 'สวัสดีครับ ลองถามผมเรื่องสินค้า นโยบาย หรือคำถามที่พบบ่อย — ผมจะค้นหาจากความรู้ใน Obsidian Vault ผ่าน Phaya embedding + pgvector ให้ครับ',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  async function ask(q: string) {
    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', text: q };
    setTurns(prev => [...prev, userTurn]);
    setInput('');
    setLoading(true);
    setErr(null);
    try {
      const { matches, embed_ms, search_ms } = await knowledgeApi.ask(q, {
        matchCount: 3,
        threshold: 0.4,
      });
      const systemTurn: ChatTurn = {
        id: `s-${Date.now()}`,
        role: 'system',
        text: matches.length > 0
          ? `พบ ${matches.length} ผลลัพธ์ที่เกี่ยวข้อง (จัดอันดับตามความใกล้เคียง)`
          : 'ขออภัย ไม่พบข้อมูลที่เกี่ยวข้อง — ลองถามด้วยคำอื่นหรือเพิ่มเนื้อหาใน vault ครับ',
        matches,
        embed_ms,
        search_ms,
      };
      setTurns(prev => [...prev, systemTurn]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    void ask(input.trim());
  }

  return (
    <div className="animate-fade-in p-6 space-y-6 flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <BrainCircuit className="w-8 h-8 text-indigo-400" />
            Openclaw RAG
          </h1>
          <p className="text-slate-400 mt-1">
            ค้นหาความรู้จาก Obsidian Vault ผ่าน Phaya embedding (4096-dim) + pgvector
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          <Sparkles size={12} /> Thai-optimized
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1" style={{ minHeight: 0 }}>
        <aside className="glass-card p-4 lg:col-span-1 flex flex-col">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
            ลองถามตัวอย่าง
          </div>
          <div className="space-y-2">
            {SAMPLE_QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => ask(q)}
                disabled={loading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg border border-white/5 bg-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/30 hover:text-indigo-300 text-slate-300 transition disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="mt-auto pt-4 border-t border-white/5 text-[10px] text-slate-500 leading-relaxed">
            <div className="font-semibold text-slate-400 mb-1">⚙️ Settings</div>
            • Phaya embedding (4096-dim)<br/>
            • Top-3 cosine similarity<br/>
            • Threshold ≥ 0.40<br/>
            • Public visibility only
          </div>
        </aside>

        <div className="glass-card p-0 lg:col-span-3 flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            {turns.map(t => (
              <div key={t.id} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  t.role === 'user'
                    ? 'bg-indigo-500 text-white rounded-br-sm'
                    : 'bg-white/5 border border-white/10 text-slate-200 rounded-bl-sm'
                }`}>
                  <div className="text-sm whitespace-pre-wrap">{t.text}</div>

                  {t.matches && t.matches.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {t.matches.map((m, i) => (
                        <div key={m.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">#{i + 1}</span>
                              <span className="text-xs font-semibold text-white">{m.title ?? 'Untitled'}</span>
                            </div>
                            <span className="text-[10px] font-mono text-emerald-400">
                              {(m.similarity * 100).toFixed(0)}% • {relativeScore(m.similarity)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {m.content.slice(0, 300)}{m.content.length > 300 ? '...' : ''}
                          </div>
                          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                            <span className="font-mono">{m.source_path}</span>
                            {m.tags && m.tags.length > 0 && (
                              <div className="flex gap-1">
                                {m.tags.slice(0, 3).map(t2 => (
                                  <span key={t2} className="bg-white/5 px-1.5 py-0.5 rounded">{t2}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {t.embed_ms !== undefined && (
                    <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3">
                      <span>⚡ Phaya: {t.embed_ms}ms</span>
                      <span>🔍 Search: {t.search_ms}ms</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-slate-300">
                  <Loader2 size={16} className="inline animate-spin mr-2" />
                  กำลังค้นหา...
                </div>
              </div>
            )}
          </div>

          {err && (
            <div className="mx-6 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              ✗ {err}
              <div className="mt-2 text-xs text-rose-300/80">
                <ExternalLink size={11} className="inline mr-1" />
                ตั้ง <code className="bg-rose-500/20 px-1 rounded">PHAYA_API_KEY</code> ใน Supabase Dashboard → Edge Functions → Secrets
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-4 border-t border-white/5 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="ถามอะไรก็ได้เกี่ยวกับสินค้า นโยบาย หรือคำถามทั่วไป..."
              disabled={loading}
              className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold px-5 rounded-lg transition flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              ถาม
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
