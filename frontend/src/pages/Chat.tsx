import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Send, RefreshCw, MessageCircle } from 'lucide-react';
import { chatApi, type ChatConversation, type ChatMessage } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { useRealtimeTable } from '../lib/useRealtimeTable';
import { useLanguage } from '../i18n';

const CHANNEL_META: Record<ChatConversation['channel'], { label: string; bg: string; color: string }> = {
  line:      { label: 'LINE',      bg: 'bg-[#06C755]',   color: 'text-white' },
  messenger: { label: 'Messenger', bg: 'bg-[#0084FF]',   color: 'text-white' },
  instagram: { label: 'Instagram', bg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-amber-400', color: 'text-white' },
  whatsapp:  { label: 'WhatsApp',  bg: 'bg-[#25D366]',   color: 'text-white' },
  livechat:  { label: 'Live Chat', bg: 'bg-indigo-500',  color: 'text-white' },
  email:     { label: 'Email',     bg: 'bg-slate-500',   color: 'text-white' },
};

const SENTIMENT_DOT: Record<NonNullable<ChatConversation['sentiment']>, string> = {
  positive: 'bg-emerald-400',
  neutral:  'bg-slate-400',
  negative: 'bg-rose-400',
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
    setLoading(true); setErr(null);
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

  useEffect(() => { void loadConversations(); }, []);
  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId]);

  // Realtime — refresh when new messages or convs arrive
  useRealtimeTable('chat_conversations', () => void loadConversations());
  useRealtimeTable('chat_messages', () => {
    if (activeId) void loadMessages(activeId);
    void loadConversations();
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const activeConv = useMemo(
    () => conversations.find(c => c.id === activeId),
    [conversations, activeId]
  );

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeId || sending) return;
    setSending(true);
    try {
      await chatApi.sendMessage(activeId, input.trim(), profile?.full_name ?? profile?.email ?? 'Agent');
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
    <div className="animate-fade-in p-6 flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <MessageCircle className="w-8 h-8 text-indigo-400" />
            {t.chat.title}
          </h1>
          <p className="text-slate-400 mt-1">{t.chat.subtitle}</p>
        </div>
        <button
          onClick={() => loadConversations()}
          className="btn btn-secondary flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          ✗ {err}
        </div>
      )}

      <div className="flex gap-6 flex-1" style={{ minHeight: 0 }}>
        {/* Conversation list */}
        <aside className="glass-card w-80 p-0 flex flex-col">
          <div className="p-4 border-b border-white/5 font-semibold text-white">
            {t.chat.activeChats} ({conversations.length})
          </div>
          <div className="overflow-y-auto flex-1 custom-scrollbar">
            {loading && <div className="p-4 text-sm text-slate-500">{t.common.loading}</div>}
            {!loading && conversations.length === 0 && (
              <div className="p-4 text-sm text-slate-500">{t.common.noData}</div>
            )}
            {conversations.map(c => {
              const meta = CHANNEL_META[c.channel];
              const isActive = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left flex gap-3 p-3 border-b border-white/5 transition ${
                    isActive ? 'bg-indigo-500/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full ${meta.bg} ${meta.color} flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                    {c.display_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white truncate">{c.display_name}</div>
                      {c.unread_count > 0 && (
                        <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-bold uppercase text-slate-400">{meta.label}</span>
                      {c.sentiment && (
                        <span className={`w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[c.sentiment]}`} />
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {c.last_message_preview ?? 'ยังไม่มีข้อความ'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Chat window */}
        <div className="glass-card flex-1 p-0 flex flex-col overflow-hidden">
          {activeConv ? (
            <>
              <div className="p-4 border-b border-white/5 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full ${CHANNEL_META[activeConv.channel].bg} flex items-center justify-center text-white font-bold`}>
                  {activeConv.display_name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-white">{activeConv.display_name}</div>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span>{CHANNEL_META[activeConv.channel].label}</span>
                    {activeConv.sentiment && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[activeConv.sentiment]}`} />
                          {activeConv.sentiment}
                        </span>
                      </>
                    )}
                    {activeConv.tags.length > 0 && (
                      <>
                        <span className="text-slate-600">•</span>
                        <span>{activeConv.tags.join(', ')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                {messages.map(m => {
                  const isAgent = m.sender_type === 'agent' || m.sender_type === 'bot';
                  return (
                    <div key={m.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[70%]">
                        <div className={`text-[10px] mb-1 ${isAgent ? 'text-right' : 'text-left'} text-slate-500`}>
                          {m.sender_name ?? m.sender_type} · {new Date(m.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                          isAgent
                            ? 'bg-indigo-500 text-white rounded-br-sm'
                            : 'bg-white/5 border border-white/10 text-slate-100 rounded-bl-sm'
                        }`}>
                          {m.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="text-center text-slate-500 mt-12">ยังไม่มีข้อความ</div>
                )}
              </div>

              <form onSubmit={handleSend} className="p-4 border-t border-white/5 flex gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={t.chat.inputPlaceholder}
                  disabled={sending}
                  className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold px-4 rounded-lg"
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              เลือกแชทจากรายการด้านซ้าย
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
