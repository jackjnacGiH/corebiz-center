import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
    Bot,
    Send,
    Sparkles,
    Loader2,
    AlertCircle,
    RefreshCw,
    FileText,
    ChevronDown,
    ChevronUp,
    Lightbulb,
    ExternalLink,
} from 'lucide-react';
import {
    knowledgeChatApi,
    type ChatHistoryItem,
    type RagChatSource,
} from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [turns]);

    async function ask(question: string) {
        if (!question.trim() || loading) return;

        const userTurn: ChatTurn = {
            id: `u-${Date.now()}`,
            role: 'user',
            content: question,
        };
        setTurns((prev) => [...prev, userTurn]);
        setInput('');
        setLoading(true);
        setErr(null);

        const history: ChatHistoryItem[] = turns
            .filter(
                (t) =>
                    t.role === 'user' ||
                    (t.role === 'assistant' && t.id !== 'welcome' && !t.error),
            )
            .slice(-8)
            .map((t) => ({
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
            setTurns((prev) => [...prev, assistantTurn]);
        } catch (e) {
            const errTurn: ChatTurn = {
                id: `e-${Date.now()}`,
                role: 'assistant',
                content: `ขออภัย เกิดข้อผิดพลาด: ${(e as Error).message}`,
                error: true,
            };
            setTurns((prev) => [...prev, errTurn]);
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
        setTurns((prev) =>
            prev.map((t) => (t.id === turnId ? { ...t, showSources: !t.showSources } : t)),
        );
    }

    function resetChat() {
        setTurns([turns[0]]);
        setErr(null);
    }

    return (
        <div
            className="animate-fade-in flex flex-col max-w-[1440px] mx-auto"
            style={{ height: 'calc(100vh - 56px - 48px)' }}
        >
            {/* ── Page header (compact) ──────────────────────────────── */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4 mb-4 border-b border-neutral-200">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="grid place-items-center w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex-shrink-0">
                        <Bot size={20} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 flex items-center gap-2 flex-wrap">
                            AI Admin Chat
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 uppercase tracking-wider">
                                <Sparkles size={10} /> RAG + GPT-4o-mini
                            </span>
                        </h1>
                        <p className="text-sm text-neutral-500 mt-1">
                            ถามอะไรเกี่ยวกับนโยบาย สินค้า ขั้นตอน — ผมตอบจาก{' '}
                            <a href="/rag" className="text-indigo-600 hover:underline font-medium">
                                knowledge base
                            </a>{' '}
                            ของระบบ
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={resetChat}
                    className="gap-2"
                    title="เริ่มแชทใหม่"
                >
                    <RefreshCw size={13} /> Reset
                </Button>
            </header>

            {/* ── Chat layout ─────────────────────────────────────────── */}
            <div className="flex gap-4 flex-1 min-h-0">
                {/* Sample questions sidebar */}
                <Card className="hidden lg:flex flex-col w-64 flex-shrink-0 gap-3 py-4 px-4">
                    <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1.5">
                        <Lightbulb size={11} /> ลองถามตัวอย่าง
                    </div>
                    <div className="space-y-1.5">
                        {SAMPLE_QUESTIONS.map((q) => (
                            <button
                                key={q}
                                onClick={() => ask(q)}
                                disabled={loading}
                                className="w-full text-left text-xs px-3 py-2 rounded-md border border-neutral-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 text-neutral-700 transition disabled:opacity-50"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                    <div className="mt-auto pt-3 border-t border-neutral-200 text-[10px] text-neutral-500 leading-relaxed space-y-0.5">
                        <div className="font-semibold text-neutral-700 mb-1">⚙️ Pipeline</div>
                        <div>① OpenAI embedding (1536)</div>
                        <div>② pgvector top-5 search</div>
                        <div>③ GPT-4o-mini answer</div>
                        <div>④ Cite sources by [#N]</div>
                    </div>
                </Card>

                {/* Chat area */}
                <Card className="flex-1 gap-0 py-0 flex flex-col overflow-hidden">
                    {/* Messages scroll area */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5">
                        {turns.map((t) => (
                            <div
                                key={t.id}
                                className={cn(
                                    'flex gap-3',
                                    t.role === 'user' && 'flex-row-reverse',
                                )}
                            >
                                {/* Avatar */}
                                <div
                                    className={cn(
                                        'w-9 h-9 rounded-lg flex-shrink-0 grid place-items-center',
                                        t.role === 'user' && 'bg-indigo-500 text-white',
                                        t.role === 'assistant' &&
                                            !t.error &&
                                            'bg-gradient-to-br from-indigo-500 to-purple-500 text-white',
                                        t.role === 'assistant' &&
                                            t.error &&
                                            'bg-red-50 text-red-600 border border-red-200',
                                    )}
                                >
                                    {t.role === 'user' ? (
                                        <span className="text-xs font-bold">
                                            {(profile?.full_name ?? profile?.email ?? '?')
                                                .charAt(0)
                                                .toUpperCase()}
                                        </span>
                                    ) : (
                                        <Bot size={18} />
                                    )}
                                </div>

                                {/* Bubble */}
                                <div
                                    className={cn(
                                        'max-w-[80%] min-w-0',
                                        t.role === 'user' && 'items-end',
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'rounded-2xl px-4 py-3',
                                            t.role === 'user' &&
                                                'bg-indigo-500 text-white rounded-tr-sm',
                                            t.role === 'assistant' &&
                                                !t.error &&
                                                'bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-tl-sm',
                                            t.role === 'assistant' &&
                                                t.error &&
                                                'bg-red-50 border border-red-200 text-red-700 rounded-tl-sm',
                                        )}
                                    >
                                        <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                            {t.content}
                                        </div>
                                    </div>

                                    {/* Sources collapsible */}
                                    {t.sources && t.sources.length > 0 && (
                                        <div className="mt-2">
                                            <button
                                                onClick={() => toggleSources(t.id)}
                                                className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-900 transition font-medium"
                                            >
                                                <FileText size={11} />
                                                แหล่งข้อมูล ({t.sources.length})
                                                {t.showSources ? (
                                                    <ChevronUp size={11} />
                                                ) : (
                                                    <ChevronDown size={11} />
                                                )}
                                            </button>
                                            {t.showSources && (
                                                <div className="mt-2 space-y-2">
                                                    {t.sources.map((s, i) => (
                                                        <div
                                                            key={s.id}
                                                            className="rounded-lg border border-neutral-200 bg-white p-3 text-xs"
                                                        >
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <span className="font-bold text-indigo-700">
                                                                    [#{i + 1}] {s.title ?? 'Untitled'}
                                                                </span>
                                                                <span className="text-emerald-700 font-mono font-semibold tabular-nums">
                                                                    {(s.similarity * 100).toFixed(0)}%
                                                                </span>
                                                            </div>
                                                            <div className="text-neutral-700 leading-relaxed">
                                                                {s.content_preview}
                                                                {s.content_preview.length >= 200
                                                                    ? '...'
                                                                    : ''}
                                                            </div>
                                                            <div className="text-[10px] text-neutral-500 font-mono mt-1.5">
                                                                {s.source_path}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Stats */}
                                    {t.elapsed && (
                                        <div className="mt-1.5 text-[10px] text-neutral-500 flex gap-3 flex-wrap tabular-nums">
                                            <span>⚡ embed: {relativeTime(t.elapsed.embed)}</span>
                                            <span>🔍 search: {relativeTime(t.elapsed.search)}</span>
                                            <span>🤖 llm: {relativeTime(t.elapsed.llm)}</span>
                                            {t.tokens && (
                                                <span>
                                                    🪙 {t.tokens.prompt + t.tokens.completion} tok
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex gap-3">
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center flex-shrink-0">
                                    <Bot size={18} className="text-white" />
                                </div>
                                <div className="bg-neutral-50 border border-neutral-200 rounded-2xl rounded-tl-sm px-4 py-3 text-neutral-700 text-sm">
                                    <Loader2 size={14} className="inline animate-spin mr-2" />
                                    กำลังค้นหาและเรียบเรียงคำตอบ...
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Error banner */}
                    {err && (
                        <div className="mx-6 mb-2 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                            <span className="flex-1">{err}</span>
                            <a
                                href="/rag"
                                className="text-red-700 hover:underline font-semibold inline-flex items-center gap-1"
                            >
                                <ExternalLink size={11} /> ตรวจ knowledge base
                            </a>
                        </div>
                    )}

                    {/* Input form */}
                    <form
                        onSubmit={handleSubmit}
                        className="p-4 border-t border-neutral-200 flex gap-2"
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="ถามอะไรก็ได้... เช่น 'นโยบายการรับประกัน', 'รับชำระแบบไหนบ้าง'"
                            disabled={loading}
                            className="flex-1 h-10 rounded-md border border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                            autoFocus
                        />
                        <Button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="gap-2 bg-indigo-500 hover:bg-indigo-600 h-10 px-5"
                        >
                            {loading ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Send size={16} />
                            )}
                            ส่ง
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    );
}
