import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Send, RefreshCw, MessageCircle, Loader2 } from 'lucide-react';
import { chatApi, type ChatConversation, type ChatMessage } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { useLanguage } from '../i18n';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CHANNEL_META: Record<
    ChatConversation['channel'],
    { label: string; bg: string; color: string }
> = {
    line:      { label: 'LINE',      bg: 'bg-[#06C755]', color: 'text-white' },
    messenger: { label: 'Messenger', bg: 'bg-[#0084FF]', color: 'text-white' },
    instagram: {
        label: 'Instagram',
        bg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-amber-400',
        color: 'text-white',
    },
    whatsapp: { label: 'WhatsApp',  bg: 'bg-[#25D366]', color: 'text-white' },
    livechat: { label: 'Live Chat', bg: 'bg-indigo-500', color: 'text-white' },
    email:    { label: 'Email',     bg: 'bg-neutral-500', color: 'text-white' },
};

const SENTIMENT_DOT: Record<NonNullable<ChatConversation['sentiment']>, string> = {
    positive: 'bg-emerald-500',
    neutral:  'bg-neutral-400',
    negative: 'bg-red-500',
};

export default function Chat() {
    const { t } = useLanguage();
    const { profile } = useAuth();
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    async function loadConversations() {
        setLoading(true);
        setErr(null);
        try {
            const list = await chatApi.listConversations();
            setConversations(list);
            if (!activeId && list[0]) setActiveId(list[0].id);
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    async function loadMessages(id: string) {
        try {
            const msgs = await chatApi.listMessages(id);
            setMessages(msgs);
            await chatApi.markRead(id);
        } catch (e) {
            setErr((e as Error).message);
        }
    }

    useEffect(() => {
        void loadConversations();
    }, []);
    useEffect(() => {
        if (activeId) void loadMessages(activeId);
    }, [activeId]);

    useRealtimeTable('chat_conversations', () => void loadConversations());
    useRealtimeTable('chat_messages', () => {
        if (activeId) void loadMessages(activeId);
        void loadConversations();
    });

    useEffect(() => {
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [messages]);

    const activeConv = useMemo(
        () => conversations.find((c) => c.id === activeId),
        [conversations, activeId],
    );

    async function handleSend(e: FormEvent) {
        e.preventDefault();
        if (!input.trim() || !activeId || sending) return;
        setSending(true);
        try {
            await chatApi.sendMessage(
                activeId,
                input.trim(),
                profile?.full_name ?? profile?.email ?? 'Agent',
            );
            setInput('');
            await loadMessages(activeId);
            await loadConversations();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setSending(false);
        }
    }

    return (
        <div
            className="animate-fade-in flex flex-col"
            style={{ height: 'calc(100vh - 56px - 48px)' }}
        >
            {/* ── Page header ─────────────────────────────────────────── */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4 mb-4 border-b border-neutral-200">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="grid place-items-center w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0">
                        <MessageCircle size={20} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 truncate">
                            {t.chat.title}
                        </h1>
                        <p className="text-sm text-neutral-500 mt-1">{t.chat.subtitle}</p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadConversations()}
                    disabled={loading}
                    className="gap-2"
                >
                    <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                    Reload
                </Button>
            </header>

            {err && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    ✗ {err}
                </div>
            )}

            <div className="flex gap-4 flex-1 min-h-0">
                {/* ── Conversation list ───────────────────────────────── */}
                <Card className="w-80 flex-shrink-0 gap-0 py-0 flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 font-semibold text-neutral-900 text-sm">
                        {t.chat.activeChats}
                        <span className="text-neutral-500 font-normal ml-1">
                            ({conversations.length})
                        </span>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        {loading && (
                            <div className="p-4 text-sm text-neutral-500">{t.common.loading}</div>
                        )}
                        {!loading && conversations.length === 0 && (
                            <div className="p-4 text-sm text-neutral-500">{t.common.noData}</div>
                        )}
                        {conversations.map((c) => {
                            const meta = CHANNEL_META[c.channel];
                            const isActive = c.id === activeId;
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => setActiveId(c.id)}
                                    className={cn(
                                        'w-full text-left flex gap-3 p-3 border-b border-neutral-200 transition',
                                        isActive
                                            ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                                            : 'hover:bg-neutral-50',
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'w-10 h-10 rounded-full grid place-items-center text-sm font-bold flex-shrink-0',
                                            meta.bg,
                                            meta.color,
                                        )}
                                    >
                                        {c.display_name.charAt(0)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-semibold text-neutral-900 truncate">
                                                {c.display_name}
                                            </div>
                                            {c.unread_count > 0 && (
                                                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 rounded-full tabular-nums">
                                                    {c.unread_count}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[10px] font-bold uppercase text-neutral-500 tracking-wider">
                                                {meta.label}
                                            </span>
                                            {c.sentiment && (
                                                <span
                                                    className={cn(
                                                        'w-1.5 h-1.5 rounded-full',
                                                        SENTIMENT_DOT[c.sentiment],
                                                    )}
                                                />
                                            )}
                                        </div>
                                        <div className="text-xs text-neutral-500 truncate mt-0.5">
                                            {c.last_message_preview ?? 'ยังไม่มีข้อความ'}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </Card>

                {/* ── Chat window ──────────────────────────────────────── */}
                <Card className="flex-1 gap-0 py-0 flex flex-col overflow-hidden">
                    {activeConv ? (
                        <>
                            <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-3">
                                <div
                                    className={cn(
                                        'w-10 h-10 rounded-full grid place-items-center text-white font-bold flex-shrink-0',
                                        CHANNEL_META[activeConv.channel].bg,
                                    )}
                                >
                                    {activeConv.display_name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-semibold text-neutral-900 truncate">
                                        {activeConv.display_name}
                                    </div>
                                    <div className="text-xs text-neutral-500 flex items-center gap-2 flex-wrap">
                                        <span className="font-medium uppercase tracking-wider text-[10px]">
                                            {CHANNEL_META[activeConv.channel].label}
                                        </span>
                                        {activeConv.sentiment && (
                                            <>
                                                <span className="text-neutral-300">•</span>
                                                <span className="flex items-center gap-1">
                                                    <span
                                                        className={cn(
                                                            'w-1.5 h-1.5 rounded-full',
                                                            SENTIMENT_DOT[activeConv.sentiment],
                                                        )}
                                                    />
                                                    {activeConv.sentiment}
                                                </span>
                                            </>
                                        )}
                                        {activeConv.tags.length > 0 && (
                                            <>
                                                <span className="text-neutral-300">•</span>
                                                <span>{activeConv.tags.join(', ')}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div
                                ref={scrollRef}
                                className="flex-1 overflow-y-auto p-6 space-y-3"
                            >
                                {messages.map((m) => {
                                    const isAgent =
                                        m.sender_type === 'agent' || m.sender_type === 'bot';
                                    return (
                                        <div
                                            key={m.id}
                                            className={cn(
                                                'flex',
                                                isAgent ? 'justify-end' : 'justify-start',
                                            )}
                                        >
                                            <div className="max-w-[70%]">
                                                <div
                                                    className={cn(
                                                        'text-[10px] mb-1 text-neutral-500 tabular-nums',
                                                        isAgent ? 'text-right' : 'text-left',
                                                    )}
                                                >
                                                    {m.sender_name ?? m.sender_type} ·{' '}
                                                    {new Date(m.created_at).toLocaleTimeString(
                                                        'th-TH',
                                                        { hour: '2-digit', minute: '2-digit' },
                                                    )}
                                                </div>
                                                <div
                                                    className={cn(
                                                        'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                                                        isAgent
                                                            ? 'bg-indigo-500 text-white rounded-br-sm'
                                                            : 'bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-bl-sm',
                                                    )}
                                                >
                                                    {m.content}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {messages.length === 0 && (
                                    <div className="text-center text-neutral-500 mt-12 text-sm">
                                        ยังไม่มีข้อความ
                                    </div>
                                )}
                            </div>

                            <form
                                onSubmit={handleSend}
                                className="p-4 border-t border-neutral-200 flex gap-2"
                            >
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder={t.chat.inputPlaceholder}
                                    disabled={sending}
                                    className="flex-1 h-10 rounded-md border border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                                />
                                <Button
                                    type="submit"
                                    disabled={sending || !input.trim()}
                                    className="bg-indigo-500 hover:bg-indigo-600 h-10 px-5"
                                >
                                    {sending ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                        <Send size={16} />
                                    )}
                                </Button>
                            </form>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
                            เลือกแชทจากรายการด้านซ้าย
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
