/**
 * Chat — Omni-channel chat inbox for admin staff.
 *
 * One unified inbox for every channel the company supports:
 *   - livechat (web AI chat at /widget on jnac.co.th)
 *   - line     (LINE OA via line-webhook + line-push Edge Functions)
 *   - messenger, instagram, whatsapp, email (Phase 3+ — same tables,
 *     just need their webhooks)
 *
 * Two-pane layout: conversation list on the left, selected conversation
 * thread on the right with a reply box. Filters by channel + status +
 * search. Realtime updates via Supabase channels so new customer
 * messages light up instantly. When admin replies to a non-livechat
 * conversation, chatInboxApi.sendMessage forwards the message to the
 * relevant channel's send API (line-push for LINE).
 */
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type ReactNode,
} from 'react';
import {
    MessageSquare,
    Search,
    Send,
    User,
    Bot,
    Globe,
    Mail,
    MessageCircle,
    Phone as PhoneIcon,
    Image as ImageIcon,
    Loader2,
    RefreshCw,
    AlertCircle,
} from 'lucide-react';
import {
    chatInboxApi,
    type ChatChannel,
    type ChatConversation,
    type ChatMessage,
    type ChatStatus,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ContactPanel from '../components/chat/ContactPanel';

const CHANNEL_LABEL: Record<ChatChannel, string> = {
    livechat: 'Web Chat',
    line: 'LINE',
    messenger: 'Facebook',
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    email: 'Email',
};

const CHANNEL_ICON: Record<ChatChannel, ReactNode> = {
    livechat: <Globe size={12} />,
    line: <MessageCircle size={12} />,
    messenger: <MessageCircle size={12} />,
    instagram: <MessageCircle size={12} />,
    whatsapp: <PhoneIcon size={12} />,
    email: <Mail size={12} />,
};

const CHANNEL_COLOR: Record<ChatChannel, string> = {
    livechat: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    line: 'bg-green-50 text-green-700 border-green-200',
    messenger: 'bg-blue-50 text-blue-700 border-blue-200',
    instagram: 'bg-pink-50 text-pink-700 border-pink-200',
    whatsapp: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    email: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABEL: Record<ChatStatus, string> = {
    open: 'ยังไม่อ่าน',
    assigned: 'กำลังดำเนินการ',
    resolved: 'เสร็จสิ้น',
    archived: 'เสร็จสิ้น',
};

// Status flow shown in the UI. `archived` is kept in the DB enum for
// historical rows but no longer exposed — collapses into 'เสร็จสิ้น'.
const ACTIVE_STATUSES: ChatStatus[] = ['open', 'assigned', 'resolved'];

const IMG_MD_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
function renderMessageContent(content: string): ReactNode[] {
    if (!content) return [];
    const out: ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    IMG_MD_RE.lastIndex = 0;
    while ((m = IMG_MD_RE.exec(content)) !== null) {
        if (m.index > lastIndex) out.push(content.slice(lastIndex, m.index));
        out.push(
            <img
                key={`img-${m.index}`}
                src={m[2]}
                alt={m[1] || 'image'}
                loading="lazy"
                className="my-2 max-w-[260px] max-h-[260px] rounded-lg border border-neutral-200 object-cover shadow-sm"
            />,
        );
        lastIndex = IMG_MD_RE.lastIndex;
    }
    if (lastIndex < content.length) out.push(content.slice(lastIndex));
    return out;
}

function timeAgo(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}วิ`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}น.`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}ชม.`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}วัน`;
    return new Date(iso).toLocaleDateString('th-TH');
}

export default function Chat() {
    // Filters — default to "อินบ็อกซ์" (no filter, show all)
    const [channel, setChannel] = useState<ChatChannel | null>(null);
    const [status, setStatus] = useState<ChatStatus | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Data
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [listErr, setListErr] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [msgErr, setMsgErr] = useState<string | null>(null);

    // Reply
    const [reply, setReply] = useState('');
    const [sending, setSending] = useState(false);

    const threadScrollRef = useRef<HTMLDivElement>(null);

    // Debounce the search box
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    // Load the conversation list whenever filters change
    const loadConvs = useCallback(async () => {
        setLoadingList(true);
        setListErr(null);
        try {
            const rows = await chatInboxApi.listConversations({
                channel,
                status,
                search: debouncedSearch,
            });
            setConversations(rows);
            // auto-select first if nothing selected
            setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
        } catch (e) {
            setListErr((e as Error).message);
        } finally {
            setLoadingList(false);
        }
    }, [channel, status, debouncedSearch]);

    useEffect(() => {
        void loadConvs();
    }, [loadConvs]);

    // Realtime: any change to chat_conversations triggers a list refresh
    useEffect(() => {
        const ch = supabase
            .channel('chat:conversations')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'chat_conversations' },
                () => void loadConvs(),
            )
            .subscribe();
        return () => { void supabase.removeChannel(ch); };
    }, [loadConvs]);

    // Load messages for selected conversation + mark as read
    useEffect(() => {
        if (!selectedId) {
            setMessages([]);
            return;
        }
        let cancelled = false;
        setLoadingMsgs(true);
        setMsgErr(null);
        chatInboxApi
            .listMessages(selectedId)
            .then((rows) => {
                if (!cancelled) {
                    setMessages(rows);
                    // Clear unread badge when admin opens the thread
                    void chatInboxApi.markRead(selectedId);
                }
            })
            .catch((e) => { if (!cancelled) setMsgErr((e as Error).message); })
            .finally(() => { if (!cancelled) setLoadingMsgs(false); });
        return () => { cancelled = true; };
    }, [selectedId]);

    // Realtime: messages for selected conversation
    useEffect(() => {
        if (!selectedId) return;
        const ch = supabase
            .channel(`chat:msgs:${selectedId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `conversation_id=eq.${selectedId}`,
                },
                (payload) => {
                    const row = payload.new as ChatMessage;
                    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
                },
            )
            .subscribe();
        return () => { void supabase.removeChannel(ch); };
    }, [selectedId]);

    // Auto-scroll thread to bottom on new messages
    useEffect(() => {
        threadScrollRef.current?.scrollTo({
            top: threadScrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [messages]);

    const selectedConv = useMemo(
        () => conversations.find((c) => c.id === selectedId) ?? null,
        [conversations, selectedId],
    );

    async function handleSend(e: FormEvent) {
        e.preventDefault();
        if (!selectedId || !reply.trim() || sending) return;
        setSending(true);
        try {
            await chatInboxApi.sendMessage({
                conversationId: selectedId,
                content: reply.trim(),
            });
            setReply('');
            // Optimistically refresh list so this conversation jumps to top
            void loadConvs();
        } catch (e) {
            alert(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setSending(false);
        }
    }

    async function handleSetStatus(s: ChatStatus) {
        if (!selectedId) return;
        try {
            await chatInboxApi.setStatus(selectedId, s);
            void loadConvs();
        } catch (e) {
            alert((e as Error).message);
        }
    }

    return (
        <div
            className="animate-fade-in flex flex-col"
            style={{ height: 'calc(100vh - 56px - 48px)' }}
        >
            {/* Page header */}
            <header className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-200">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="grid place-items-center w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex-shrink-0">
                        <MessageSquare size={20} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Omni-Chat</h1>
                        <p className="text-sm text-neutral-500">
                            แชทจากลูกค้าทุกช่องทาง (Web, LINE, Facebook, Email)
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadConvs()}
                    className="gap-2"
                    disabled={loadingList}
                >
                    <RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} /> Refresh
                </Button>
            </header>

            {/* Two-pane */}
            <div className="flex gap-4 flex-1 min-h-0">
                {/* List */}
                <Card className="w-80 flex-shrink-0 flex flex-col gap-0 py-0 overflow-hidden">
                    {/* Filters */}
                    <div className="p-3 border-b border-neutral-200 space-y-2">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="ค้นหาชื่อ หรือข้อความ..."
                                className="w-full pl-7 pr-2 h-8 rounded-md border border-neutral-200 bg-neutral-50 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <div className="flex gap-1 flex-wrap text-[10px]">
                            <FilterChip
                                label="All channels"
                                active={channel === null}
                                onClick={() => setChannel(null)}
                            />
                            {(['livechat', 'line', 'messenger', 'email'] as ChatChannel[]).map((c) => (
                                <FilterChip
                                    key={c}
                                    label={CHANNEL_LABEL[c]}
                                    icon={CHANNEL_ICON[c]}
                                    active={channel === c}
                                    onClick={() => setChannel(channel === c ? null : c)}
                                />
                            ))}
                        </div>
                        <div className="flex gap-1 flex-wrap text-[10px]">
                            <FilterChip
                                label="อินบ็อกซ์"
                                active={status === null}
                                onClick={() => setStatus(null)}
                            />
                            {ACTIVE_STATUSES.map((s) => (
                                <FilterChip
                                    key={s}
                                    label={STATUS_LABEL[s]}
                                    active={status === s}
                                    onClick={() => setStatus(s)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* List body */}
                    <div className="flex-1 overflow-y-auto">
                        {loadingList && conversations.length === 0 && (
                            <div className="p-6 text-center text-xs text-neutral-500">
                                <Loader2 size={14} className="animate-spin inline mr-1" />
                                กำลังโหลด...
                            </div>
                        )}
                        {listErr && (
                            <div className="m-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                                <AlertCircle size={12} className="inline mr-1" />
                                {listErr}
                            </div>
                        )}
                        {!loadingList && conversations.length === 0 && !listErr && (
                            <div className="p-6 text-center text-xs text-neutral-400">
                                ยังไม่มีแชทในเงื่อนไขนี้
                            </div>
                        )}
                        {conversations.map((c) => (
                            <button
                                key={c.id}
                                onClick={() => setSelectedId(c.id)}
                                className={cn(
                                    'w-full text-left p-3 border-b border-neutral-100 hover:bg-neutral-50 transition',
                                    selectedId === c.id && 'bg-indigo-50 border-l-2 border-l-indigo-500',
                                )}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border',
                                            CHANNEL_COLOR[c.channel],
                                        )}
                                    >
                                        {CHANNEL_ICON[c.channel]} {CHANNEL_LABEL[c.channel]}
                                    </span>
                                    <span className="text-[10px] text-neutral-400 tabular-nums ml-auto">
                                        {timeAgo(c.last_message_at ?? c.created_at)}
                                    </span>
                                </div>
                                <div className="text-sm font-medium text-neutral-900 truncate">
                                    {c.display_name}
                                </div>
                                {c.last_message_preview && (
                                    <div className="text-xs text-neutral-500 truncate mt-0.5">
                                        {c.last_message_preview}
                                    </div>
                                )}
                                {c.unread_count > 0 && (
                                    <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                                        {c.unread_count} new
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Thread */}
                <Card className="flex-1 flex flex-col gap-0 py-0 overflow-hidden">
                    {!selectedConv && (
                        <div className="flex-1 grid place-items-center text-neutral-400 text-sm">
                            <div className="text-center">
                                <MessageSquare size={32} className="mx-auto mb-2 text-neutral-300" />
                                เลือกการสนทนาจากรายการด้านซ้าย
                            </div>
                        </div>
                    )}
                    {selectedConv && (
                        <>
                            {/* Thread header */}
                            <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center text-white flex-shrink-0">
                                    <User size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-neutral-900 truncate">
                                        {selectedConv.display_name}
                                    </div>
                                    <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                                        <span
                                            className={cn(
                                                'inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                                                CHANNEL_COLOR[selectedConv.channel],
                                            )}
                                        >
                                            {CHANNEL_ICON[selectedConv.channel]} {CHANNEL_LABEL[selectedConv.channel]}
                                        </span>
                                        <span>·</span>
                                        <span>{STATUS_LABEL[selectedConv.status]}</span>
                                    </div>
                                </div>
                                {/* Status toggle — any → any direction */}
                                <div className="inline-flex rounded-md border border-neutral-200 p-0.5 bg-neutral-50">
                                    {ACTIVE_STATUSES.map((s) => {
                                        const isCurrent =
                                            selectedConv.status === s ||
                                            (s === 'resolved' && selectedConv.status === 'archived');
                                        return (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => {
                                                    if (!isCurrent) void handleSetStatus(s);
                                                }}
                                                className={cn(
                                                    'text-xs px-3 h-7 rounded transition font-medium',
                                                    isCurrent
                                                        ? 'bg-indigo-600 text-white shadow-sm'
                                                        : 'text-neutral-600 hover:bg-white hover:text-neutral-900',
                                                )}
                                            >
                                                {STATUS_LABEL[s]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Messages */}
                            <div ref={threadScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
                                {loadingMsgs && (
                                    <div className="text-center text-xs text-neutral-500">
                                        <Loader2 size={14} className="animate-spin inline mr-1" />
                                        โหลดข้อความ...
                                    </div>
                                )}
                                {msgErr && (
                                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                                        <AlertCircle size={12} className="inline mr-1" />
                                        {msgErr}
                                    </div>
                                )}
                                {messages.map((m) => (
                                    <MessageRow key={m.id} msg={m} />
                                ))}
                            </div>

                            {/* Reply box */}
                            <form
                                onSubmit={handleSend}
                                className="border-t border-neutral-200 p-3 flex gap-2 bg-white"
                            >
                                <textarea
                                    value={reply}
                                    onChange={(e) => setReply(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void handleSend(e as unknown as FormEvent);
                                        }
                                    }}
                                    rows={2}
                                    placeholder="พิมพ์คำตอบ... (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัด)"
                                    disabled={sending}
                                    className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none disabled:opacity-50"
                                />
                                <Button
                                    type="submit"
                                    disabled={sending || !reply.trim()}
                                    className="bg-indigo-600 hover:bg-indigo-700 self-end h-10 gap-2"
                                >
                                    {sending ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Send size={14} />
                                    )}
                                    ส่ง
                                </Button>
                            </form>
                        </>
                    )}
                </Card>

                {/* Contact panel (right side) — only when a conversation is selected */}
                {selectedConv && (
                    <ContactPanel
                        conversation={selectedConv}
                        onConversationChanged={() => void loadConvs()}
                    />
                )}
            </div>
        </div>
    );
}

function FilterChip({
    label,
    icon,
    active,
    onClick,
}: {
    label: string;
    icon?: ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition',
                active
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-100',
            )}
        >
            {icon} {label}
        </button>
    );
}

function MessageRow({ msg }: { msg: ChatMessage }) {
    const isCustomer = msg.sender_type === 'customer';
    const isBot = msg.sender_type === 'bot';
    const isSystem = msg.sender_type === 'system';

    if (isSystem) {
        return (
            <div className="text-center text-[10px] text-neutral-400 my-1">
                {msg.content}
            </div>
        );
    }

    return (
        <div className={`flex gap-2 ${isCustomer ? '' : 'flex-row-reverse'}`}>
            <div
                className={cn(
                    'w-7 h-7 rounded-full grid place-items-center flex-shrink-0 mt-0.5',
                    isCustomer && 'bg-neutral-200 text-neutral-700',
                    isBot && 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white',
                    !isCustomer && !isBot && 'bg-emerald-500 text-white',
                )}
            >
                {isCustomer ? <User size={13} /> : isBot ? <Bot size={13} /> : <MessageSquare size={13} />}
            </div>
            <div className="max-w-[70%]">
                <div className="text-[10px] text-neutral-400 mb-0.5 px-1">
                    {isCustomer ? 'ลูกค้า' : isBot ? 'AI' : msg.sender_name ?? 'Staff'}
                    {' · '}
                    {new Date(msg.created_at).toLocaleString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
                </div>
                <div
                    className={cn(
                        'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed',
                        isCustomer
                            ? 'bg-white border border-neutral-200 text-neutral-900 rounded-tl-sm'
                            : isBot
                                ? 'bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 text-neutral-900 rounded-tr-sm'
                                : 'bg-emerald-50 border border-emerald-200 text-neutral-900 rounded-tr-sm',
                    )}
                >
                    {msg.content_type === 'image' && msg.content && (
                        <ImageIcon size={14} className="inline mr-1 text-neutral-400" />
                    )}
                    {renderMessageContent(msg.content)}
                </div>
            </div>
        </div>
    );
}
