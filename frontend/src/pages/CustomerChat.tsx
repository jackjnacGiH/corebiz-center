/**
 * CustomerChat — public customer-facing AI chat widget
 *
 * Designed to be iframed onto jnac.co.th (or any external page). Renders
 * as a floating chat bubble bottom-right; clicking the bubble expands a
 * chat panel above it. No login required.
 *
 * Conversation history is persisted in localStorage so a customer can
 * refresh the page without losing context (up to 30 turns kept).
 *
 * Uses the same rag-chat Edge Function as the admin KnowledgeChat — which
 * means same anti-hallucination guardrails, source grouping, image
 * preservation, language matching, and cost-query refusal apply.
 *
 * Body background is transparent so when iframed, only the bubble and
 * chat panel are visible — the host page's content shows through.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
    Bot,
    Send,
    Loader2,
    X,
    RefreshCw,
    MessageCircle,
} from 'lucide-react';
import {
    knowledgeChatApi,
    type ChatHistoryItem,
} from '../lib/api';
import { supabase } from '../lib/supabase';

interface ChatTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    error?: boolean;
}

const STORAGE_KEY = 'jnac_customer_chat_v1';
const SESSION_KEY = 'jnac_customer_session_id_v1';
const MAX_PERSISTED_TURNS = 30;

/**
 * Get-or-create a per-visitor session ID stored in localStorage. The
 * Edge Function uses this as the external_id of a chat_conversations
 * row (channel='livechat') so admin staff can see and reply to the chat
 * from the inbox. The ID survives page refresh and revisits, but is
 * scoped to one browser profile (clearing site data starts fresh).
 */
function getOrCreateSessionId(): string {
    if (typeof window === 'undefined') return '';
    try {
        const existing = window.localStorage.getItem(SESSION_KEY);
        if (existing && existing.length >= 8) return existing;
        const fresh = (crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        window.localStorage.setItem(SESSION_KEY, fresh);
        return fresh;
    } catch {
        // localStorage disabled — fall back to in-memory id for this session only
        return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function loadHistory(): ChatTurn[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Drop any partial streaming turns from a prior crashed session
        return parsed.filter((t) => t && typeof t.content === 'string' && !t.streaming);
    } catch {
        return [];
    }
}

function saveHistory(turns: ChatTurn[]) {
    if (typeof window === 'undefined') return;
    try {
        const safe = turns
            .filter((t) => !t.streaming && typeof t.content === 'string')
            .slice(-MAX_PERSISTED_TURNS);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
        /* quota exceeded or storage disabled — silent fail */
    }
}

function detectLang(s: string): 'th' | 'en' {
    return /[฀-๿]/.test(s) ? 'th' : 'en';
}

/**
 * Parse `![alt](url)` in assistant text and render matched URLs as <img>.
 * Streaming-safe: partial markdown stays as plain text until the closing
 * paren arrives in a later SSE chunk.
 */
const IMG_MD_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
function renderMessageContent(content: string): ReactNode[] {
    if (!content) return [];
    const out: ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    IMG_MD_RE.lastIndex = 0;
    while ((m = IMG_MD_RE.exec(content)) !== null) {
        if (m.index > lastIndex) {
            out.push(content.slice(lastIndex, m.index));
        }
        out.push(
            <img
                key={`img-${m.index}`}
                src={m[2]}
                alt={m[1] || 'image'}
                loading="lazy"
                className="my-1 max-w-[240px] max-h-[240px] rounded-lg border border-neutral-200 object-cover shadow-sm"
            />,
        );
        lastIndex = IMG_MD_RE.lastIndex;
    }
    if (lastIndex < content.length) {
        out.push(content.slice(lastIndex));
    }
    return out;
}

// Bot persona is "เอย" — matches the Aoey persona configured in
// ai_personas table for the web channel.
const WELCOME_MESSAGE = `✨สวัสดีค่ะ  เอยยินดีให้บริการ  📦อยากเช็กสต็อกสินค้า สอบถามราคา หรือปรึกษาเรื่องบริการต่าง ๆ ถามเอย ได้เลยนะคะ 💖`;

/**
 * Position the widget at a corner of the iframe. Configurable via URL:
 *   /widget?pos=bl  (bottom-left)
 *   /widget?pos=br  (bottom-right, default)
 *   /widget?pos=tl  (top-left)
 *   /widget?pos=tr  (top-right)
 * Useful when the host page already has a chat/contact widget at the
 * default corner (e.g. jnac.co.th has Readyplanet on bottom-right →
 * use pos=bl to avoid overlap).
 */
type Pos = 'br' | 'bl' | 'tr' | 'tl';
interface WidgetConfig {
    pos: Pos;
    /** Pixel offset from the chosen corner (vertical). Default 16. Useful
     *  to slot above/below an existing widget stack (e.g. Readyplanet). */
    offset: number;
    /** Optional label rendered as a pill on the side of the bubble.
     *  Matches the visual style of Readyplanet's contact buttons. */
    label: string | null;
}
function readConfig(): WidgetConfig {
    if (typeof window === 'undefined') return { pos: 'br', offset: 16, label: null };
    const params = new URLSearchParams(window.location.search);
    const p = params.get('pos');
    const pos: Pos = p === 'bl' || p === 'tr' || p === 'tl' ? p : 'br';
    const offsetRaw = Number(params.get('offset'));
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 16;
    const label = params.get('label');
    return { pos, offset, label: label && label.trim() ? label.trim() : null };
}

/**
 * Tell the host page (parent of the iframe) the widget's collapsed/open
 * state so it can resize the iframe — small around the bubble when
 * collapsed (so it doesn't block host page clicks), full size when open.
 */
function postSize(open: boolean) {
    if (typeof window === 'undefined' || window.parent === window) return;
    try {
        window.parent.postMessage(
            { type: 'corebiz-widget', open },
            '*',
        );
    } catch { /* postMessage rejected by parent, ignore */ }
}

export default function CustomerChat() {
    const cfg = readConfig();
    const { pos, offset, label } = cfg;
    const isLeft = pos === 'bl' || pos === 'tl';
    const isTop = pos === 'tr' || pos === 'tl';

    const [open, setOpen] = useState(false);
    const [turns, setTurns] = useState<ChatTurn[]>(() => {
        const persisted = loadHistory();
        return persisted.length > 0
            ? persisted
            : [{ id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE }];
    });
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    /** DB id of the persisted chat_conversations row (received from the
     *  Edge Function after the first message). Used to scope the
     *  realtime subscription to messages from THIS chat only. */
    const [conversationId, setConversationId] = useState<string | null>(null);
    const sessionIdRef = useRef<string>(getOrCreateSessionId());
    const scrollRef = useRef<HTMLDivElement>(null);

    // Make body transparent so the host page (jnac.co.th) shows through
    // when this widget is embedded via iframe. Restored on unmount.
    useEffect(() => {
        const prevBg = document.body.style.background;
        const prevHtmlBg = document.documentElement.style.background;
        document.body.style.background = 'transparent';
        document.documentElement.style.background = 'transparent';
        return () => {
            document.body.style.background = prevBg;
            document.documentElement.style.background = prevHtmlBg;
        };
    }, []);

    // Send size hint to parent whenever open state changes
    useEffect(() => {
        postSize(open);
    }, [open]);

    // Persist on every change
    useEffect(() => {
        saveHistory(turns);
    }, [turns]);

    // Realtime: subscribe to new agent/admin messages on our conversation
    // so admin's replies from the inbox appear live in the customer's chat.
    // We only subscribe AFTER the first askStream returns our conversation_id.
    useEffect(() => {
        if (!conversationId) return;
        const channel = supabase
            .channel(`chat_msg:${conversationId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `conversation_id=eq.${conversationId}`,
                },
                (payload) => {
                    const row = payload.new as {
                        id: string;
                        sender_type: 'customer' | 'agent' | 'bot' | 'system';
                        content: string;
                        created_at: string;
                    };
                    // Only react to AGENT (human admin) messages here —
                    // 'customer' and 'bot' messages were inserted by us
                    // (or our own askStream) so they're already in state.
                    if (row.sender_type !== 'agent') return;
                    setTurns((prev) => {
                        // de-dupe by id
                        if (prev.some((t) => t.id === `db-${row.id}`)) return prev;
                        return [
                            ...prev,
                            {
                                id: `db-${row.id}`,
                                role: 'assistant',
                                content: row.content,
                            },
                        ];
                    });
                },
            )
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [conversationId]);

    // Auto-scroll on new content
    useEffect(() => {
        if (!open) return;
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [turns, open, loading]);

    async function ask(question: string) {
        if (!question.trim() || loading) return;

        const userTurn: ChatTurn = {
            id: `u-${Date.now()}`,
            role: 'user',
            content: question,
        };
        const assistantId = `a-${Date.now()}`;
        const placeholderTurn: ChatTurn = {
            id: assistantId,
            role: 'assistant',
            content: '',
            streaming: true,
        };
        setTurns((prev) => [...prev, userTurn, placeholderTurn]);
        setInput('');
        setLoading(true);

        // Last 20 turns for context (skip welcome + errors + the user turn we just added)
        const history: ChatHistoryItem[] = turns
            .filter(
                (t) =>
                    t.role === 'user' ||
                    (t.role === 'assistant' && t.id !== 'welcome' && !t.error),
            )
            .slice(-20)
            .map((t) => ({
                role: t.role as 'user' | 'assistant',
                content: t.content,
            }));

        const lang = detectLang(question);

        try {
            const result = await knowledgeChatApi.askStream(
                {
                    query: question,
                    history,
                    matchCount: 5,
                    threshold: 0.3,
                    // Persist this conversation to chat_conversations + chat_messages
                    // so the admin inbox can see it and reply live via Realtime.
                    sessionId: sessionIdRef.current,
                    displayName: `Visitor #${sessionIdRef.current.slice(0, 6)}`,
                    // Use the 'web' persona (Settings → AI Persona → Web Widget)
                    channel: 'web',
                },
                (event) => {
                    if (event.type === 'paused') {
                        // Admin paused the bot — remove placeholder so the chat
                        // looks like the message was sent but nobody is typing.
                        // The customer's own message stays visible; admin reply
                        // will appear via the realtime subscription on
                        // chat_messages once they type one.
                        setTurns((prev) => prev.filter((t) => t.id !== assistantId));
                        return;
                    }
                    setTurns((prev) =>
                        prev.map((t) => {
                            if (t.id !== assistantId) return t;
                            switch (event.type) {
                                case 'text':
                                    return { ...t, content: t.content + event.chunk };
                                case 'blocked':
                                    return { ...t, content: event.answer };
                                default:
                                    return t;
                            }
                        }),
                    );
                },
            );
            setTurns((prev) =>
                prev.map((t) => (t.id !== assistantId ? t : { ...t, streaming: false })),
            );
            // Capture conversation id once known — enables realtime
            // subscription to admin replies
            if (result.conversation_id && result.conversation_id !== conversationId) {
                setConversationId(result.conversation_id);
            }
        } catch (e) {
            const errMsg = (e as Error).message;
            const wrapper =
                lang === 'th'
                    ? `ขออภัยค่ะ ระบบมีปัญหาชั่วคราว: ${errMsg}\n\nรบกวนติดต่อทีมงานโดยตรงที่ LINE @jnac`
                    : `Sorry, there was a temporary error: ${errMsg}\n\nPlease contact our team via LINE @jnac`;
            setTurns((prev) =>
                prev.map((t) =>
                    t.id !== assistantId
                        ? t
                        : {
                              ...t,
                              streaming: false,
                              error: true,
                              content: t.content && t.content.length > 0 ? t.content : wrapper,
                          },
                ),
            );
        } finally {
            setLoading(false);
        }
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        void ask(input.trim());
    }

    function resetChat() {
        const fresh: ChatTurn = { id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE };
        setTurns([fresh]);
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch { /* noop */ }
    }

    const rootCornerClass = `${isTop ? 'top-0' : 'bottom-0'} ${isLeft ? 'left-0' : 'right-0'}`;
    const slideInClass = isTop ? 'slide-in-from-top-4' : 'slide-in-from-bottom-4';

    // Inline styles for precise pixel positioning (offset from corner)
    const bubbleStyle: CSSProperties = {
        [isTop ? 'top' : 'bottom']: `${offset}px`,
        [isLeft ? 'left' : 'right']: '16px',
    };
    // Panel sits 72px away from the corner (above bubble for bottom, below for top)
    const panelStyle: CSSProperties = {
        [isTop ? 'top' : 'bottom']: `${offset + 72}px`,
        [isLeft ? 'left' : 'right']: '16px',
        width: 'min(380px, calc(100vw - 32px))',
        height: 'min(560px, calc(100vh - 120px))',
    };

    return (
        <div className={`fixed ${rootCornerClass} z-[2147483646] pointer-events-none`}>
            {/* Chat panel */}
            {open && (
                <div
                    className={`pointer-events-auto bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col absolute animate-in fade-in ${slideInClass} duration-200`}
                    style={panelStyle}
                >
                    {/* Header */}
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/20 grid place-items-center">
                            <Bot size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">J NAC Thailand</div>
                            <div className="text-xs text-white/80 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                AI พร้อมให้บริการ
                            </div>
                        </div>
                        <button
                            onClick={resetChat}
                            title="เริ่มแชทใหม่"
                            className="w-7 h-7 rounded-md hover:bg-white/15 grid place-items-center transition"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <button
                            onClick={() => setOpen(false)}
                            title="ย่อแชท"
                            className="w-7 h-7 rounded-md hover:bg-white/15 grid place-items-center transition"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
                        {turns.map((t) => (
                            <div
                                key={t.id}
                                className={`flex gap-2 ${t.role === 'user' ? 'flex-row-reverse' : ''}`}
                            >
                                {t.role === 'assistant' && (
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center flex-shrink-0 mt-0.5">
                                        <Bot size={14} className="text-white" />
                                    </div>
                                )}
                                <div
                                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                                        t.role === 'user'
                                            ? 'bg-indigo-600 text-white rounded-tr-sm'
                                            : t.error
                                                ? 'bg-red-50 text-red-700 border border-red-200 rounded-tl-sm'
                                                : 'bg-white text-neutral-900 border border-neutral-200 rounded-tl-sm'
                                    }`}
                                >
                                    {renderMessageContent(t.content)}
                                    {t.streaming && t.content.length === 0 && (
                                        // Messenger-style typing indicator — three bouncing dots
                                        // staggered 150ms apart. Looks the same in LINE OA, iMessage
                                        // and WhatsApp; signals "someone is typing" without the
                                        // spinning loader which reads as "loading the page".
                                        <span className="inline-flex items-center gap-1.5 text-neutral-500">
                                            <span className="text-xs">เอย กำลังพิมพ์</span>
                                            <span className="inline-flex gap-1 ml-0.5">
                                                <span
                                                    className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
                                                    style={{ animationDelay: '0ms', animationDuration: '1s' }}
                                                />
                                                <span
                                                    className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
                                                    style={{ animationDelay: '150ms', animationDuration: '1s' }}
                                                />
                                                <span
                                                    className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
                                                    style={{ animationDelay: '300ms', animationDuration: '1s' }}
                                                />
                                            </span>
                                        </span>
                                    )}
                                    {t.streaming && t.content.length > 0 && (
                                        <span className="inline-block w-2 h-3.5 ml-0.5 align-middle bg-indigo-500 animate-pulse rounded-sm" />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSubmit} className="border-t border-neutral-200 p-3 flex gap-2 bg-white">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="พิมพ์คำถาม..."
                            disabled={loading}
                            className="flex-1 h-9 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center justify-center transition"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        </button>
                    </form>
                </div>
            )}

            {/* Floating bubble + optional label pill (Readyplanet-style) */}
            <div
                className={`pointer-events-auto absolute flex items-center gap-2 ${isLeft ? 'flex-row' : 'flex-row-reverse'}`}
                style={bubbleStyle}
            >
                <button
                    onClick={() => setOpen((o) => !o)}
                    className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition grid place-items-center relative"
                    title={open ? 'ย่อแชท' : label ?? 'สอบถามข้อมูล'}
                >
                    {open ? <X size={20} /> : <MessageCircle size={20} />}
                    {!open && turns.some((t) => t.id !== 'welcome' && t.role === 'assistant') && (
                        <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-green-400 ring-2 ring-white" />
                    )}
                </button>
                {label && !open && (
                    <button
                        onClick={() => setOpen(true)}
                        className="bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-medium px-3 py-1.5 rounded-full shadow border border-neutral-200 whitespace-nowrap transition"
                    >
                        {label}
                    </button>
                )}
            </div>
        </div>
    );
}
