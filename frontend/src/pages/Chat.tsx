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
    type ChangeEvent,
    type ClipboardEvent,
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
    Paperclip,
    Crop,
    X,
    Loader2,
    RefreshCw,
    AlertCircle,
    ChevronLeft,
    Download,
    FileText,
    Reply,
} from 'lucide-react';
import {
    chatInboxApi,
    type ChatChannel,
    type ChatConversation,
    type ChatMessage,
    type ChatStatus,
} from '../lib/api';
import { uploadChatImage, validateImage, uploadChatFile } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ContactPanel from '../components/chat/ContactPanel';
import EmojiButton from '../components/chat/EmojiButton';
import QuickReplyButton from '../components/chat/QuickReplyButton';
import ImageCropModal, { captureScreen } from '../components/chat/ImageCropModal';
import ProductCardButton from '../components/chat/ProductCardButton';
import StickerButton from '../components/chat/StickerButton';

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

// Localised status label. Reads from the active translation set so
// "Inbox / Unread / In progress / Resolved" follow the global TH/EN
// toggle. `archived` is kept in the DB enum but collapses into resolved.
function statusLabel(
    s: ChatStatus,
    chatT: { statusFilter: { inbox: string; unread: string; inProgress: string; resolved: string } },
): string {
    switch (s) {
        case 'open': return chatT.statusFilter.unread;
        case 'assigned': return chatT.statusFilter.inProgress;
        case 'resolved':
        case 'archived':
            return chatT.statusFilter.resolved;
    }
}

// Status flow shown in the UI. `archived` is kept in the DB enum for
// historical rows but no longer exposed — collapses into 'เสร็จสิ้น'.
const ACTIVE_STATUSES: ChatStatus[] = ['open', 'assigned', 'resolved'];

// Force-download an image. Storage URLs are cross-origin, so the <a download>
// attribute is ignored by browsers — fetch the bytes as a blob and save that.
// Falls back to opening the image in a new tab if the fetch is blocked.
async function downloadImage(url: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const ext = blob.type.includes('png') ? 'png'
            : blob.type.includes('webp') ? 'webp'
            : blob.type.includes('gif') ? 'gif' : 'jpg';
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = `jnac-chat-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(obj);
    } catch {
        window.open(url, '_blank', 'noopener');
    }
}

// Chat image: click to open full-size in a new tab, hover (or tap the badge)
// to download the original file.
function ChatImage({ src, alt }: { src: string; alt: string }) {
    return (
        <span className="relative inline-block my-2 group align-top">
            <img
                src={src}
                alt={alt}
                loading="lazy"
                onClick={() => window.open(src, '_blank', 'noopener')}
                className="max-w-[260px] max-h-[260px] rounded-lg border border-neutral-200 object-cover shadow-sm cursor-zoom-in"
            />
            <button
                type="button"
                title="ดาวน์โหลดรูป"
                onClick={(e) => { e.stopPropagation(); void downloadImage(src); }}
                className="absolute top-1.5 right-1.5 grid place-items-center w-7 h-7 rounded-md bg-black/55 text-white opacity-80 sm:opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
            >
                <Download size={14} />
            </button>
        </span>
    );
}

const IMG_MD_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
// Turn bare http(s) URLs in a text run into clickable links (open in new tab).
const URL_RE = /(https?:\/\/[^\s<]+)/g;
function linkifyText(text: string, keyBase: string): ReactNode[] {
    if (!text) return [];
    const nodes: ReactNode[] = [];
    let last = 0;
    let i = 0;
    let m: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        let url = m[1];
        let trail = '';
        const tm = url.match(/[)\].,!?]+$/); // keep trailing punctuation out of the link
        if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
        nodes.push(
            <a key={`lnk-${keyBase}-${i++}`} href={url} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 underline break-all hover:text-blue-700">{url}</a>,
        );
        if (trail) nodes.push(trail);
        last = m.index + m[1].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

function renderMessageContent(content: string): ReactNode[] {
    if (!content) return [];
    const out: ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    IMG_MD_RE.lastIndex = 0;
    while ((m = IMG_MD_RE.exec(content)) !== null) {
        if (m.index > lastIndex) out.push(...linkifyText(content.slice(lastIndex, m.index), `t${m.index}`));
        out.push(<ChatImage key={`img-${m.index}`} src={m[2]} alt={m[1] || 'image'} />);
        lastIndex = IMG_MD_RE.lastIndex;
    }
    if (lastIndex < content.length) out.push(...linkifyText(content.slice(lastIndex), 'tail'));
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
    const { t } = useLanguage();
    const { profile } = useAuth();
    // Name shown to the customer + in the inbox when this admin replies.
    const agentName = (profile?.full_name ?? '').trim() || undefined;
    // Filters — default to "Inbox" (no filter, show all)
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
    // Quote-reply: the message the admin is replying to (null = normal send)
    const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

    // Composer attachments: images queued via the attach button or clipboard
    // paste (screen-crop → Ctrl+V). Each keeps the File plus a local
    // object-URL for the thumbnail preview; uploaded on send.
    // `file` = a local upload/paste/crop to push to storage on send.
    // `url`  = an already-hosted image (e.g. a product photo) embedded as-is.
    const [pendingImages, setPendingImages] = useState<{ previewUrl: string; file?: File; url?: string }[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const docInputRef = useRef<HTMLInputElement>(null);

    // Auto-grow the composer with its content, up to ~8 lines, then scroll.
    // Shrinks back to the 2-row base when the text is cleared.
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const cs = getComputedStyle(ta);
        const lh = parseFloat(cs.lineHeight) || 20;
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const maxH = lh * 8 + pad;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
        ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
    }, [reply]);

    // Drop any pending reply target when switching conversations — it points at
    // a message in the previous thread.
    useEffect(() => { setReplyingTo(null); }, [selectedId]);

    // Screen capture → crop → attach. `cropSrc` holds the captured frame
    // (data-URL) while the crop modal is open.
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [capturing, setCapturing] = useState(false);

    const threadScrollRef = useRef<HTMLDivElement>(null);

    // Debounce the search box
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    // Load the conversation list whenever filters change.
    // NOTE: we deliberately do NOT auto-select the first row. Boss Jack
    // hit a bug where the top conversation was getting auto-queued for the
    // 'open' → 'assigned' deferred transition while he was actually reading
    // a different chat further down the list — when he then switched tabs,
    // the chat he never opened got promoted. Admin must click explicitly.
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
                    // The DB trigger re-opens the conversation as "ยังไม่อ่าน"
                    // on any customer message. But the admin is looking at THIS
                    // thread right now, so clear its unread badge immediately.
                    if (row.sender_type === 'customer') {
                        void chatInboxApi.markRead(selectedId);
                    }
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

    // Deferred auto-transition: when admin opens an "ยังไม่อ่าน" (open)
    // thread, we DON'T flip it to "กำลังดำเนินการ" immediately, because
    // Boss Jack wants the conversation to stay visible in the ยังไม่อ่าน
    // tab while he's still replying. Instead we stash the conversation id
    // in a ref, and only flush the queued transitions when the admin
    // switches to a different status filter (or to อินบ็อกซ์ / เสร็จสิ้น).
    const pendingAssignRef = useRef<Set<string>>(new Set());

    // Stash: any time the selected conv is 'open', queue it.
    useEffect(() => {
        if (!selectedId || selectedConv?.status !== 'open') return;
        pendingAssignRef.current.add(selectedId);
    }, [selectedId, selectedConv?.status]);

    // Flush: when the status FILTER itself changes (admin clicked a tab),
    // promote every queued conversation to 'assigned' in one go, then
    // refresh the list. Excluded from deps intentionally — we want this
    // to fire *only* when the user picks a different tab, not when
    // loadConvs is recreated.
    useEffect(() => {
        if (pendingAssignRef.current.size === 0) return;
        const ids = Array.from(pendingAssignRef.current);
        pendingAssignRef.current = new Set();
        void (async () => {
            try {
                await Promise.all(ids.map((id) => chatInboxApi.setStatus(id, 'assigned')));
                void loadConvs();
            } catch {
                // no-op — admin can still move the status manually
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    // Drop any queued attachments when switching conversations. Only blob
    // previews (local files) need revoking; hosted product URLs don't.
    useEffect(() => {
        setPendingImages((prev) => {
            prev.forEach((p) => { if (p.file) URL.revokeObjectURL(p.previewUrl); });
            return [];
        });
    }, [selectedId]);

    // ── Composer helpers ──────────────────────────────────────────────
    /** Insert text (emoji or quick-reply template) at the textarea caret. */
    function insertAtCursor(text: string) {
        const ta = textareaRef.current;
        if (!ta) {
            setReply((r) => r + text);
            return;
        }
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? ta.value.length;
        setReply((r) => r.slice(0, start) + text + r.slice(end));
        requestAnimationFrame(() => {
            ta.focus();
            const pos = start + text.length;
            ta.setSelectionRange(pos, pos);
        });
    }

    /** Queue image files (from the attach button or clipboard paste). */
    function addImageFiles(files: File[]) {
        const valid: { file: File; previewUrl: string }[] = [];
        for (const file of files) {
            try {
                validateImage(file);
                valid.push({ file, previewUrl: URL.createObjectURL(file) });
            } catch (err) {
                alert((err as Error).message);
            }
        }
        if (valid.length) setPendingImages((prev) => [...prev, ...valid]);
    }

    /** Capture a screen frame, then open the crop modal to pick a region. */
    async function handleCaptureScreen() {
        if (capturing) return;
        setCapturing(true);
        try {
            const dataUrl = await captureScreen();
            setCropSrc(dataUrl);
        } catch (err) {
            // Dismissing the browser share picker rejects with
            // NotAllowedError / AbortError — treat that as a silent cancel.
            const name = (err as Error)?.name;
            if (name !== 'NotAllowedError' && name !== 'AbortError') {
                alert((err as Error).message || 'จับภาพหน้าจอไม่สำเร็จ');
            }
        } finally {
            setCapturing(false);
        }
    }

    /** Cropped region from the modal → drop it into the composer (pending),
     *  so the agent reviews / adds a caption and presses Send when ready. */
    function handleCropToComposer(blob: Blob) {
        const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
        const file = new File([blob], `screenshot-${Date.now()}.${ext}`, {
            type: blob.type || 'image/png',
        });
        addImageFiles([file]);
        setCropSrc(null);
    }

    /** Attach an already-hosted image (e.g. a product photo) without re-upload. */
    function attachHostedImage(url: string) {
        setPendingImages((prev) => [...prev, { url, previewUrl: url }]);
    }

    /** Product-card picker → drop the formatted card text + product image into
     *  the composer so the agent can review / tweak, then press Send. */
    function handlePickProductCard(cardText: string, imageUrl: string | null) {
        insertAtCursor(cardText);
        if (imageUrl) attachHostedImage(imageUrl);
    }

    function onFilesSelected(e: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (files.length) addImageFiles(files);
        e.target.value = ''; // allow re-selecting the same file
    }

    /** Document attachment (PDF/doc/etc.) — upload + send immediately as a file
     *  message (a file card here; a link to the customer on LINE). */
    async function onDocsSelected(e: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!files.length || !selectedId || sending) return;
        setSending(true);
        try {
            for (const file of files) {
                const up = await uploadChatFile(file, selectedId);
                await chatInboxApi.sendFileMessage({
                    conversationId: selectedId,
                    fileUrl: up.url,
                    fileName: up.name,
                    fileSize: up.size,
                    mimeType: up.type,
                    senderName: agentName,
                });
            }
            void loadConvs();
        } catch (err) {
            alert(`ส่งไฟล์ไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setSending(false);
        }
    }

    /** Clipboard paste — captures screenshots / cropped images (Ctrl+V). */
    function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
        const imgs = Array.from(e.clipboardData.items)
            .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
            .map((it) => it.getAsFile())
            .filter((f): f is File => f !== null);
        if (imgs.length > 0) {
            e.preventDefault(); // don't also paste the binary as garbage text
            addImageFiles(imgs);
        }
    }

    function removePending(idx: number) {
        setPendingImages((prev) => {
            const next = [...prev];
            const [removed] = next.splice(idx, 1);
            if (removed?.file) URL.revokeObjectURL(removed.previewUrl);
            return next;
        });
    }

    function clearPending() {
        setPendingImages((prev) => {
            prev.forEach((p) => { if (p.file) URL.revokeObjectURL(p.previewUrl); });
            return [];
        });
    }

    async function handleSend(e: FormEvent) {
        e.preventDefault();
        if (!selectedId || sending) return;
        const text = reply.trim();
        const imgs = pendingImages;
        if (!text && imgs.length === 0) return;
        setSending(true);
        try {
            let content = text;
            if (imgs.length > 0) {
                // Local files upload to storage; already-hosted product photos
                // are used as-is. Each becomes markdown ![image](url) — line-push
                // splits these into native LINE image messages and the web widget
                // renders them inline, so no backend change is needed.
                const urls: string[] = [];
                for (const p of imgs) {
                    urls.push(p.url ?? (await uploadChatImage(p.file!, selectedId)));
                }
                const md = urls.map((u) => `![image](${u})`).join('\n');
                content = text ? `${text}\n${md}` : md;
            }
            await chatInboxApi.sendMessage({
                conversationId: selectedId,
                content,
                contentType: imgs.length > 0 ? 'image' : 'text',
                senderName: agentName,
                replyTo: replyingTo
                    ? {
                          id: replyingTo.id,
                          sender_type: replyingTo.sender_type,
                          sender_name: replyingTo.sender_name,
                          preview: msgPreview(replyingTo),
                          quoteToken: (replyingTo.metadata as { quote_token?: string | null } | null)?.quote_token ?? null,
                      }
                    : null,
            });
            setReply('');
            setReplyingTo(null);
            clearPending();
            // Optimistically refresh list so this conversation jumps to top
            void loadConvs();
        } catch (e) {
            alert(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setSending(false);
        }
    }

    /** Send a sticker as a one-tap image message (same pipeline as photos). */
    async function sendSticker(url: string) {
        if (!selectedId || sending) return;
        setSending(true);
        try {
            await chatInboxApi.sendMessage({
                conversationId: selectedId,
                content: `![image](${url})`,
                contentType: 'image',
                senderName: agentName,
            });
            void loadConvs();
        } catch (e) {
            alert(`ส่งไม่สำเร็จ: ${(e as Error).message}`);
        } finally {
            setSending(false);
        }
    }

    async function handleSetStatus(s: ChatStatus) {
        if (!selectedId) return;
        // Manual override wins — drop this id from the deferred queue so
        // we don't redundantly setStatus('assigned') after the admin just
        // picked a different status from the thread toggle.
        pendingAssignRef.current.delete(selectedId);
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
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t.chat.title}</h1>
                        <p className="text-sm text-neutral-500">{t.chat.subtitle}</p>
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
                {/* List — full-width on phone; hidden on phone once a chat is open */}
                <Card className={cn('w-full md:w-80 flex-shrink-0 flex-col gap-0 py-0 overflow-hidden', selectedId ? 'hidden md:flex' : 'flex')}>
                    {/* Filters */}
                    <div className="p-3 border-b border-neutral-200 space-y-2">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t.chat.searchPlaceholder}
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
                                label={t.chat.statusFilter.inbox}
                                active={status === null}
                                onClick={() => setStatus(null)}
                            />
                            {ACTIVE_STATUSES.map((s) => (
                                <FilterChip
                                    key={s}
                                    label={statusLabel(s, t.chat)}
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
                                {t.chat.loading}
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
                                {t.chat.emptyList}
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
                                    {c.bot_enabled === false && (
                                        <span
                                            className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700"
                                            title="บอทถูกปิดสำหรับแชทนี้ — แอดมินตอบเอง"
                                        >
                                            🤖 Off
                                        </span>
                                    )}
                                    <span className="text-[10px] text-neutral-400 tabular-nums ml-auto">
                                        {timeAgo(c.last_message_at ?? c.created_at)}
                                    </span>
                                </div>
                                <div className="flex items-start gap-2">
                                    {c.avatar_url ? (
                                        <img
                                            src={c.avatar_url}
                                            alt={c.display_name}
                                            className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-neutral-200 bg-neutral-100"
                                            referrerPolicy="no-referrer"
                                            loading="lazy"
                                            onError={(e) => {
                                                const img = e.currentTarget;
                                                img.style.display = 'none';
                                                const fallback = img.nextElementSibling as HTMLElement | null;
                                                if (fallback) fallback.style.display = 'grid';
                                            }}
                                        />
                                    ) : null}
                                    <div
                                        className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 grid place-items-center text-white text-sm font-bold flex-shrink-0"
                                        style={{ display: c.avatar_url ? 'none' : 'grid' }}
                                    >
                                        {c.display_name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-neutral-900 truncate">
                                            {c.display_name}
                                        </div>
                                        {c.company && (
                                            <div className="text-[11px] text-indigo-600 truncate flex items-center gap-1" title={c.company}>
                                                <span aria-hidden>🏢</span>
                                                <span className="truncate">{c.company}</span>
                                            </div>
                                        )}
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
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Thread — hidden on phone until a chat is selected */}
                <Card className={cn('flex-1 flex-col gap-0 py-0 overflow-hidden', selectedId ? 'flex' : 'hidden md:flex')}>
                    {!selectedConv && (
                        <div className="flex-1 grid place-items-center text-neutral-400 text-sm">
                            <div className="text-center">
                                <MessageSquare size={32} className="mx-auto mb-2 text-neutral-300" />
                                {t.chat.emptySelect}
                            </div>
                        </div>
                    )}
                    {selectedConv && (
                        <>
                            {/* Thread header */}
                            <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(null)}
                                    className="md:hidden -ml-1.5 p-1 text-neutral-500 hover:text-neutral-900 flex-shrink-0"
                                    aria-label="ย้อนกลับไปรายการแชท"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                {selectedConv.avatar_url ? (
                                    <img
                                        src={selectedConv.avatar_url}
                                        alt={selectedConv.display_name}
                                        className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-neutral-200 bg-neutral-100"
                                        referrerPolicy="no-referrer"
                                        loading="lazy"
                                        onError={(e) => {
                                            const img = e.currentTarget;
                                            img.style.display = 'none';
                                            const fallback = img.nextElementSibling as HTMLElement | null;
                                            if (fallback) fallback.style.display = 'grid';
                                        }}
                                    />
                                ) : null}
                                <div
                                    className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center text-white flex-shrink-0"
                                    style={{ display: selectedConv.avatar_url ? 'none' : 'grid' }}
                                >
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
                                        <span>{statusLabel(selectedConv.status, t.chat)}</span>
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
                                                {statusLabel(s, t.chat)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Messages */}
                            <div ref={threadScrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-neutral-50">
                                {loadingMsgs && (
                                    <div className="text-center text-xs text-neutral-500">
                                        <Loader2 size={14} className="animate-spin inline mr-1" />
                                        {t.chat.loadingMessages}
                                    </div>
                                )}
                                {msgErr && (
                                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                                        <AlertCircle size={12} className="inline mr-1" />
                                        {msgErr}
                                    </div>
                                )}
                                {messages.map((m) => (
                                    <MessageRow
                                        key={m.id}
                                        msg={m}
                                        onReply={(rm) => { setReplyingTo(rm); textareaRef.current?.focus(); }}
                                    />
                                ))}
                            </div>

                            {/* Reply box */}
                            <form
                                onSubmit={handleSend}
                                className="border-t border-neutral-200 p-3 bg-white"
                            >
                                {/* Quote-reply preview — the message being replied to */}
                                {replyingTo && (
                                    <div className="flex items-start gap-2 mb-2 rounded-lg border border-indigo-200 bg-indigo-50/60 pl-2 pr-1 py-1.5">
                                        <Reply size={14} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] font-semibold text-indigo-600">
                                                ตอบกลับ {quotedSenderLabel(replyingTo.sender_type, replyingTo.sender_name)}
                                            </div>
                                            <div className="text-[11px] text-neutral-500 truncate">{msgPreview(replyingTo)}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setReplyingTo(null)}
                                            title="ยกเลิกการตอบกลับ"
                                            className="w-6 h-6 grid place-items-center rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 flex-shrink-0"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                )}

                                {/* Pending image attachments (device upload / paste) */}
                                {pendingImages.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {pendingImages.map((p, i) => (
                                            <div
                                                key={p.previewUrl}
                                                className="relative w-16 h-16 rounded-lg border border-neutral-200 overflow-hidden bg-neutral-50"
                                            >
                                                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                                                <button
                                                    type="button"
                                                    onClick={() => removePending(i)}
                                                    title="เอารูปออก"
                                                    className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-end gap-2">
                                    {/* Composer toolbar: emoji · attach image · quick replies */}
                                    <div className="flex items-center gap-0.5 pb-0.5">
                                        <EmojiButton onPick={insertAtCursor} disabled={sending} />
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={sending}
                                            title="แนบรูปภาพ (หรือวางรูปที่ครอป/ก๊อปปี้ไว้ด้วย Ctrl+V)"
                                            className="grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <Paperclip size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => docInputRef.current?.click()}
                                            disabled={sending}
                                            title="แนบไฟล์เอกสาร (PDF, Word, Excel ฯลฯ) — ส่งให้ลูกค้าเปิด/ดาวน์โหลดได้"
                                            className="grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <FileText size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleCaptureScreen()}
                                            disabled={sending || capturing}
                                            title="จับภาพหน้าจอแล้วครอป → ใส่ในช่องพิมพ์ · หรือกด Win+Shift+S ครอปเองทั้งจอ แล้ววาง Ctrl+V"
                                            className="grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {capturing ? <Loader2 size={18} className="animate-spin" /> : <Crop size={18} />}
                                        </button>
                                        <QuickReplyButton draft={reply} onPick={insertAtCursor} disabled={sending} />
                                        <ProductCardButton onPick={handlePickProductCard} disabled={sending} />
                                        <StickerButton onSend={sendSticker} disabled={sending} />
                                    </div>

                                    <textarea
                                        ref={textareaRef}
                                        value={reply}
                                        onChange={(e) => setReply(e.target.value)}
                                        onPaste={handlePaste}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void handleSend(e as unknown as FormEvent);
                                            }
                                        }}
                                        rows={2}
                                        placeholder={t.chat.inputPlaceholder}
                                        disabled={sending}
                                        className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none disabled:opacity-50"
                                    />
                                    <Button
                                        type="submit"
                                        disabled={sending || (!reply.trim() && pendingImages.length === 0)}
                                        className="bg-indigo-600 hover:bg-indigo-700 self-end h-10 gap-2"
                                    >
                                        {sending ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Send size={14} />
                                        )}
                                        {t.chat.send}
                                    </Button>
                                </div>

                                {/* Hidden file input driven by the attach button */}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    multiple
                                    className="hidden"
                                    onChange={onFilesSelected}
                                />
                                {/* Hidden document input (PDF/Word/Excel/…) */}
                                <input
                                    ref={docInputRef}
                                    type="file"
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf"
                                    multiple
                                    className="hidden"
                                    onChange={onDocsSelected}
                                />
                            </form>
                        </>
                    )}
                </Card>

                {/* Contact panel (right side) — desktop only (lg+); phone/tablet
                    keep the two-pane / single-pane flow uncluttered */}
                {selectedConv && (
                    <div className="hidden lg:flex flex-shrink-0">
                        <ContactPanel
                            conversation={selectedConv}
                            onConversationChanged={() => void loadConvs()}
                        />
                    </div>
                )}
            </div>

            {/* Screen-capture → crop → attach */}
            {cropSrc && (
                <ImageCropModal
                    src={cropSrc}
                    onCrop={handleCropToComposer}
                    onCancel={() => setCropSrc(null)}
                />
            )}
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

/** Download card for a customer-sent file (PDF / docs) — built from the
 *  message metadata that line-webhook stores (file_url / file_name / size). */
function FileAttachment({ meta, fallback }: { meta: Record<string, unknown>; fallback: string }) {
    const url = typeof meta?.file_url === 'string' ? meta.file_url : null;
    const name = (typeof meta?.file_name === 'string' && meta.file_name) || 'ไฟล์แนบ';
    const size = typeof meta?.file_size === 'number' ? meta.file_size : null;
    const mime = typeof meta?.mime_type === 'string' ? meta.mime_type : '';
    if (!url) return <span className="text-sm text-neutral-600">{fallback || '[ไฟล์แนบ]'}</span>;
    const sizeLabel = size != null
        ? (size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1048576).toFixed(1)} MB`)
        : '';
    const kind = mime.includes('pdf') ? 'PDF' : (name.split('.').pop() || '').slice(0, 5).toUpperCase();
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download={name}
            title={`เปิด/ดาวน์โหลด ${name}`}
            className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:bg-neutral-50 transition no-underline max-w-[260px]"
        >
            <span className="grid place-items-center w-9 h-9 rounded bg-red-50 text-red-600 flex-shrink-0">
                <FileText size={18} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-neutral-800 truncate">{name}</span>
                <span className="block text-[11px] text-neutral-400">
                    {[kind, sizeLabel].filter(Boolean).join(' · ')} · กดเพื่อเปิด/ดาวน์โหลด
                </span>
            </span>
            <Download size={15} className="text-neutral-400 flex-shrink-0" />
        </a>
    );
}

/** A short, clean one-line snippet of a message for quote-reply previews. */
function msgPreview(msg: Pick<ChatMessage, 'content' | 'content_type' | 'metadata'>): string {
    if (msg.content_type === 'file') {
        const name = (msg.metadata as { file_name?: string } | null)?.file_name;
        return `📎 ${name || 'ไฟล์แนบ'}`;
    }
    const cleaned = (msg.content || '')
        .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, '🖼️ รูปภาพ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return msg.content_type === 'image' ? '🖼️ รูปภาพ' : '…';
    return cleaned.length > 90 ? cleaned.slice(0, 90) + '…' : cleaned;
}

/** Who-sent label for a quoted message. */
function quotedSenderLabel(senderType: string, senderName?: string | null): string {
    if (senderType === 'customer') return 'ลูกค้า';
    if (senderType === 'bot') return 'AI (เอย)';
    return senderName || 'ทีมงาน';
}

function MessageRow({ msg, onReply }: { msg: ChatMessage; onReply?: (m: ChatMessage) => void }) {
    const { t } = useLanguage();
    const isCustomer = msg.sender_type === 'customer';
    const isBot = msg.sender_type === 'bot';
    const isSystem = msg.sender_type === 'system';
    const replyTo = (msg.metadata as { reply_to?: { sender_type: string; sender_name?: string | null; preview: string } } | null)?.reply_to;

    if (isSystem) {
        return (
            <div className="text-center text-[10px] text-neutral-400 my-1">
                {msg.content}
            </div>
        );
    }

    return (
        <div className={`group flex gap-2 ${isCustomer ? '' : 'flex-row-reverse'}`}>
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
            <div className="max-w-[85%] sm:max-w-[70%]">
                <div className="text-[10px] text-neutral-400 mb-0.5 px-1">
                    {isCustomer ? t.chat.customer : isBot ? 'AI' : msg.sender_name ?? 'Staff'}
                    {' · '}
                    {new Date(msg.created_at).toLocaleString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
                </div>
                {/* Bubble + hover "reply" action */}
                <div className={`flex items-center gap-1.5 ${isCustomer ? '' : 'flex-row-reverse'}`}>
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
                        {/* Quoted message this reply is responding to */}
                        {replyTo && (
                            <div className="mb-1.5 border-l-2 border-indigo-300 bg-black/5 rounded-r px-2 py-1">
                                <div className="text-[10px] font-semibold text-indigo-600">
                                    {quotedSenderLabel(replyTo.sender_type, replyTo.sender_name)}
                                </div>
                                <div className="text-[11px] text-neutral-500 line-clamp-2 whitespace-pre-wrap">{replyTo.preview}</div>
                            </div>
                        )}
                        {msg.content_type === 'file' ? (
                            <FileAttachment meta={msg.metadata} fallback={msg.content} />
                        ) : (
                            <>
                                {msg.content_type === 'image' && msg.content && (
                                    <ImageIcon size={14} className="inline mr-1 text-neutral-400" />
                                )}
                                {renderMessageContent(msg.content)}
                            </>
                        )}
                    </div>
                    {onReply && (
                        <button
                            type="button"
                            onClick={() => onReply(msg)}
                            title="ตอบกลับข้อความนี้"
                            className="opacity-0 group-hover:opacity-100 transition w-7 h-7 grid place-items-center rounded-full text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 flex-shrink-0"
                        >
                            <Reply size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
