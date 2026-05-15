import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bot, Send, Sparkles, Loader2, AlertCircle, RefreshCw, FileText,
  ChevronDown, ChevronUp, Lightbulb, ExternalLink,
} from 'lucide-react';
import { knowledgeChatApi, type ChatHistoryItem, type RagChatSource } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: RagChatSource[];
  tokens?: { prompt: number; completion: number };
  elapsed?: { embed: number; search: number; llm: number };
  showSources?: boolean;
  error?: boolean;
}

const SAMPLE_QUESTIONS = [
  'คืนสินค้าได้กี่วัน',
  'มีใบกำกับภาษีไหม',
  'ส่งของไปต่างจังหวัดกี่วัน',
  'รับบัตรเครดิตไหม',
  'สมัครเป็นตัวแทนได้ไหม',
];

function relativeTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function KnowledgeChat() {
  const { profile } = useAuth();
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `สวัสดีครับ${profile?.full_name ? ' ' + profile.full_name : ''}! ผมเป็น AI ผู้ช่วยของ CoreBiz Center 🤖\n\nถามอะไรเกี่ยวกับนโยบาย/สินค้า/วิธีการได้เลย — ผมจะค้นหาจาก knowledge base แล้วตอบเป็นภาษาไทยให้`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
    };
    setTurns(prev => [...prev, userTurn]);
    setInput('');
    setLoading(true);
    setErr(null);

    // Build history from previous turns (skip system welcomes)
    const history: ChatHistoryItem[] = turns
      .filter(t => t.role === 'user' || (t.role === 'assistant' && t.id !== 'welcome' && !t.error))
      .slice(-8) // last 4 exchanges
      .map(t => ({
        role: t.role as 'user' | 'assistant',
        content: t.content,
      }));

    try {
      const result = await knowledgeChatApi.ask({
        query: question,
        history,
        matchCount: 5,
        threshold: 0.4,
      });

      const assistantTurn: ChatTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        tokens: {
          prompt: result.tokens.prompt_tokens,
          completion: result.tokens.completion_tokens,
        },
        elapsed: result.elapsed_ms,
      };
      setTurns(prev => [...prev, assistantTurn]);
    } catch (e) {
      const errTurn: ChatTurn = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `ขออภัย เกิดข้อผิดพลาด: ${(e as Error).message}`,
        error: true,
      };
      setTurns(prev => [...prev, errTurn]);
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input.trim());
  }

  function toggleSources(turnId: string) {
    setTurns(prev => prev.map(t => t.id === turnId ? { ...t, showSources: !t.showSources } : t));
  }

  function resetChat() {
    setTurns([turns[0]]); // keep welcome
    setErr(null);
  }

  return (
    <div className="animate-fade-in p-6 flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
      <div className="flex justify-between items-start gap-4 mb-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <Bot className="w-8 h-8 text-indigo-400" />
            AI Admin Chat
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold">
              <Sparkles size={11} className="inline mr-1" />
              RAG + GPT-4o-mini
            </span>
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            ถามอะไรเกี่ยวกับนโยบาย สินค้า ขั้นตอน — ผมตอบจาก{' '}
            <a href="/rag" className="text-indigo-400 hover:text-indigo-300 underline">knowledge base</a> ของระบบ
          </p>
        </div>
        <button
          onClick={resetChat}
          className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
          title="เริ่มแชทใหม่"
        >
          <RefreshCw size={13} /> Reset
        </button>
      </div>

      <div className="flex gap-4 flex-1" style={{ minHeight: 0 }}>
        {/* Sample questions sidebar */}
        <aside className="hidden lg:flex flex-col w-64 glass-card p-4 flex-shrink-0">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1">
            <Lightbulb size={11} /> ลองถามตัวอย่าง
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
            <div className="font-semibold text-slate-400 mb-1">⚙️ Pipeline</div>
            ① OpenAI embedding (1536)<br/>
            ② pgvector top-5 search<br/>
            ③ GPT-4o-mini answer<br/>
            ④ Cite sources by [#N]
          </div>
        </aside>

        {/* Chat area */}
        <div className="glass-card flex-1 p-0 flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            {turns.map(t => (
              <div key={t.id} className={`flex gap-3 ${t.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center ${
                  t.role === 'user'
                    ? 'bg-indigo-500'
                    : t.error
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-gradient-to-br from-indigo-500 to-purple-500'
                }`}>
                  {t.role === 'user' ? (
                    <span className="text-white text-xs font-bold">
                      {(profile?.full_name ?? profile?.email ?? '?').charAt(0).toUpperCase()}
                    </span>
                  ) : (
                    <Bot size={18} className="text-white" />
                  )}
                </div>

                {/* Bubble */}
                <div className={`max-w-[80%] ${t.role === 'user' ? 'items-end' : ''}`}>
                  <div className={`rounded-2xl px-4 py-3 ${
                    t.role === 'user'
                      ? 'bg-indigo-500 text-white rounded-tr-sm'
                      : t.error
                        ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-tl-sm'
                        : 'bg-white/5 border border-white/10 text-slate-100 rounded-tl-sm'
                  }`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{t.content}</div>
                  </div>

                  {/* Sources collapsible */}
                  {t.sources && t.sources.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleSources(t.id)}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition"
                      >
                        <FileText size={11} />
                        แหล่งข้อมูล ({t.sources.length})
                        {t.showSources ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                      {t.showSources && (
                        <div className="mt-2 space-y-2">
                          {t.sources.map((s, i) => (
                            <div key={s.id} className="rounded-lg border border-white/5 bg-slate-900/50 p-3 text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-indigo-400">[#{i + 1}] {s.title ?? 'Untitled'}</span>
                                <span className="text-emerald-400 font-mono">{(s.similarity * 100).toFixed(0)}%</span>
                              </div>
                              <div className="text-slate-400 leading-relaxed">{s.content_preview}{s.content_preview.length >= 200 ? '...' : ''}</div>
                              <div className="text-[10px] text-slate-500 font-mono mt-1.5">{s.source_path}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stats */}
                  {t.elapsed && (
                    <div className="mt-1.5 text-[10px] text-slate-500 flex gap-3 flex-wrap">
                      <span>⚡ embed: {relativeTime(t.elapsed.embed)}</span>
                      <span>🔍 search: {relativeTime(t.elapsed.search)}</span>
                      <span>🤖 llm: {relativeTime(t.elapsed.llm)}</span>
                      {t.tokens && <span>🪙 {t.tokens.prompt + t.tokens.completion} tok</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                  <Bot size={18} className="text-white" />
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 text-slate-300 text-sm">
                  <Loader2 size={14} className="inline animate-spin mr-2" />
                  กำลังค้นหาและเรียบเรียงคำตอบ...
                </div>
              </div>
            )}
          </div>

          {err && (
            <div className="mx-6 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertCircle size={12} className="inline mr-1" />{err}
              <a href="/rag" className="ml-2 underline text-rose-300"><ExternalLink size={10} className="inline" /> ตรวจ knowledge base</a>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-4 border-t border-white/5 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="ถามอะไรก็ได้... เช่น 'นโยบายการรับประกัน', 'รับชำระแบบไหนบ้าง'"
              disabled={loading}
              className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold px-5 rounded-lg transition flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              ส่ง
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
