/**
 * ContactPanel — right-side panel on the omni-chat page (LINE OA style).
 *
 * Shows the editable alias name, external ID, customer order/spend stats
 * (when linked), automatic + manual tags, Packer assignment (= assigned_to),
 * and an unlimited list of typed notes (tax invoice, shipping address,
 * reminders, bank account, special terms, etc.).
 *
 * Auto-tags are recomputed in JS on every render so the UI stays accurate
 * without a daily cron pass; the SQL function `recalc_chat_auto_tags`
 * persists them in DB whenever the admin edits the conversation.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Check,
  Pencil,
  Plus,
  StickyNote,
  ShoppingBag,
  MessageSquare,
  Loader2,
  Hash,
  Bot,
  Link2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  chatProfileApi,
  chatNotesApi,
  profilesApi,
  customersApi,
  type ChatConversation,
  type ChatContactNote,
  type StaffProfile,
  type CustomerSnapshot,
  type Customer,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { computeAutoTags, daysSince } from '../../utils/chatAutoTags';
import TagChip from './TagChip';
import TagPicker from './TagPicker';
import PackerSelect from './PackerSelect';
import NoteCard from './NoteCard';
import NoteModal from './NoteModal';

interface Props {
  conversation: ChatConversation;
  onConversationChanged?: () => void;
}

export default function ContactPanel({ conversation, onConversationChanged }: Props) {
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(conversation.alias_name ?? '');
  const [customer, setCustomer] = useState<CustomerSnapshot | null>(null);
  const [packers, setPackers] = useState<StaffProfile[]>([]);
  const [notes, setNotes] = useState<ChatContactNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ChatContactNote | undefined>();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Manual customer linking (for chats that never self-registered)
  const [linking, setLinking] = useState(false);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [custSearching, setCustSearching] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  // Debounced customer search while the link picker is open.
  useEffect(() => {
    if (!linking) return;
    const term = custQuery.trim();
    if (!term) { setCustResults([]); return; }
    let cancelled = false;
    setCustSearching(true);
    const h = setTimeout(async () => {
      try { const r = await customersApi.search(term, 25); if (!cancelled) setCustResults(r); }
      catch { if (!cancelled) setCustResults([]); }
      finally { if (!cancelled) setCustSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [custQuery, linking]);

  async function chooseCustomer(id: string | null) {
    setLinkBusy(true);
    try {
      await chatProfileApi.linkCustomer(conversation.id, id);
      if (id) {
        const snap = await chatProfileApi.getCustomerSnapshot(id).catch(() => null);
        setCustomer(snap);
      } else {
        setCustomer(null);
      }
      setLinking(false); setCustQuery(''); setCustResults([]);
      onConversationChanged?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  }

  useEffect(() => {
    setAliasDraft(conversation.alias_name ?? '');
  }, [conversation.id, conversation.alias_name]);

  // Load customer snapshot (only when conversation has a linked customer)
  useEffect(() => {
    if (!conversation.customer_id) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    chatProfileApi
      .getCustomerSnapshot(conversation.customer_id)
      .then((c) => !cancelled && setCustomer(c))
      .catch(() => !cancelled && setCustomer(null));
    return () => {
      cancelled = true;
    };
  }, [conversation.customer_id]);

  // Load packer staff list (once)
  useEffect(() => {
    let cancelled = false;
    profilesApi
      .listStaff()
      .then((rows) => !cancelled && setPackers(rows))
      .catch(() => !cancelled && setPackers([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load notes + realtime subscribe per conversation
  const reloadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const rows = await chatNotesApi.list(conversation.id);
      setNotes(rows);
    } finally {
      setLoadingNotes(false);
    }
  }, [conversation.id]);

  useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  useEffect(() => {
    const ch = supabase
      .channel(`chat:notes:${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_contact_notes',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => void reloadNotes(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [conversation.id, reloadNotes]);

  const autoTags = useMemo(
    () => computeAutoTags(conversation, customer),
    [conversation, customer],
  );

  const lastDays = daysSince(
    conversation.last_customer_message_at ?? conversation.last_message_at,
  );

  const handleAliasSave = async () => {
    setAliasEditing(false);
    if (aliasDraft.trim() === (conversation.alias_name ?? '')) return;
    try {
      await chatProfileApi.updateProfile(conversation.id, {
        alias_name: aliasDraft.trim() || null,
      });
      onConversationChanged?.();
    } catch (e) {
      alert(`บันทึกชื่อไม่สำเร็จ: ${(e as Error).message}`);
    }
  };

  const handleAddTag = async (tag: string) => {
    const next = Array.from(new Set([...(conversation.tags ?? []), tag]));
    try {
      await chatProfileApi.updateProfile(conversation.id, { tags: next });
      onConversationChanged?.();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const next = (conversation.tags ?? []).filter((t) => t !== tag);
    try {
      await chatProfileApi.updateProfile(conversation.id, { tags: next });
      onConversationChanged?.();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleSetPacker = async (userId: string | null) => {
    try {
      await chatProfileApi.setPacker(conversation.id, userId);
      onConversationChanged?.();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // bot_enabled defaults to true if the column is missing (older conversations
  // created before migration 0014) or null.
  const botEnabled = conversation.bot_enabled !== false;
  const handleToggleBot = async () => {
    try {
      await chatProfileApi.setBotEnabled(conversation.id, !botEnabled);
      onConversationChanged?.();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleSubmitNote = async (
    payload: Omit<
      ChatContactNote,
      'id' | 'conversation_id' | 'created_at' | 'updated_at' | 'created_by' | 'sort_order'
    >,
  ) => {
    try {
      if (editingNote) {
        await chatNotesApi.update(editingNote.id, payload);
      } else {
        await chatNotesApi.create({ ...payload, conversation_id: conversation.id });
      }
      void reloadNotes();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDeleteNote = async (n: ChatContactNote) => {
    try {
      await chatNotesApi.delete(n.id);
      void reloadNotes();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleTogglePin = async (n: ChatContactNote) => {
    try {
      await chatNotesApi.update(n.id, { is_pinned: !n.is_pinned });
      void reloadNotes();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Drag-and-drop reorder. Optimistically updates local state, persists
  // new sort_order values to DB in parallel; on failure, reloads from DB.
  const handleDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragOverId) setDragOverId(id);
  };

  const handleDragLeave = () => setDragOverId(null);

  const handleDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!source || source === targetId) return;
    const oldIdx = notes.findIndex((n) => n.id === source);
    const newIdx = notes.findIndex((n) => n.id === targetId);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = [...notes];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);
    setNotes(reordered);
    chatNotesApi.reorder(reordered.map((n) => n.id)).catch(() => void reloadNotes());
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <Card className="w-80 flex-shrink-0 flex flex-col gap-0 py-0 overflow-hidden">
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {/* Header — avatar + original display_name (read-only) + editable alias (nickname) + channel ID */}
        <div className="flex flex-col items-center text-center">
          {conversation.avatar_url ? (
            <img
              src={conversation.avatar_url}
              alt={conversation.display_name}
              className="w-16 h-16 rounded-full object-cover mb-2 border border-neutral-200 bg-neutral-100"
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={(e) => {
                // LINE avatar URLs occasionally rotate / 404 — fall back to the
                // gradient initial without spamming the console.
                const img = e.currentTarget;
                img.style.display = 'none';
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'grid';
              }}
            />
          ) : null}
          <div
            className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center text-white text-2xl font-bold mb-2"
            style={{ display: conversation.avatar_url ? 'none' : 'grid' }}
          >
            {conversation.display_name.charAt(0).toUpperCase()}
          </div>

          {/* Original name from the channel — READ ONLY, no pencil, no click */}
          <div className="text-base font-semibold text-neutral-900 px-2 py-1">
            {conversation.display_name}
          </div>

          {/* Editable nickname (alias_name) — separate row below the original name */}
          {aliasEditing ? (
            <div className="flex gap-1 w-full max-w-[220px] mt-1">
              <input
                autoFocus
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onBlur={() => void handleAliasSave()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAliasSave();
                  if (e.key === 'Escape') {
                    setAliasDraft(conversation.alias_name ?? '');
                    setAliasEditing(false);
                  }
                }}
                placeholder="ใส่ชื่อเล่น..."
                className="flex-1 px-2 h-7 text-xs text-center rounded-md border border-indigo-500 bg-white outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleAliasSave();
                }}
                className="h-7 w-7 grid place-items-center rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
              >
                <Check size={12} />
              </button>
            </div>
          ) : conversation.alias_name ? (
            <button
              type="button"
              onClick={() => {
                setAliasDraft(conversation.alias_name ?? '');
                setAliasEditing(true);
              }}
              className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100"
              title="แก้ไขชื่อเล่น"
            >
              {conversation.alias_name}
              <Pencil size={9} className="opacity-60" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAliasDraft('');
                setAliasEditing(true);
              }}
              className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md text-[10px] text-neutral-500 border border-dashed border-neutral-300 hover:bg-neutral-50"
            >
              <Pencil size={9} /> ใส่ชื่อเล่น
            </button>
          )}

          {conversation.external_id && (
            <div className="text-[10px] text-neutral-400 font-mono mt-1.5 inline-flex items-center gap-0.5">
              <Hash size={9} /> {conversation.external_id}
            </div>
          )}
        </div>

        {/* Customer link + stats */}
        <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="text-[10px] uppercase font-bold text-neutral-500 mb-2 tracking-wide flex items-center gap-1">
            <Link2 size={11} /> ลูกค้าในระบบ
          </div>
          {customer ? (
            <>
              <div className="text-sm font-semibold text-neutral-900 leading-snug">{customer.name}</div>
              <div className="text-[10px] text-neutral-400 mb-2 uppercase">Tier: {customer.tier}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-neutral-500 flex items-center gap-1"><ShoppingBag size={10} /> ออเดอร์</div>
                  <div className="text-base font-bold text-neutral-900">{customer.total_orders}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 flex items-center gap-1">💰 ยอดซื้อ</div>
                  <div className="text-base font-bold text-emerald-600">฿{Number(customer.total_spent).toLocaleString()}</div>
                </div>
                {lastDays !== null && (
                  <div className="col-span-2 pt-2 border-t border-neutral-200">
                    <div className="text-[10px] text-neutral-500 flex items-center gap-1"><MessageSquare size={10} /> ลูกค้าทักล่าสุด</div>
                    <div className="text-sm font-medium text-neutral-900">{lastDays === 0 ? 'วันนี้' : `${lastDays} วันที่แล้ว`}</div>
                  </div>
                )}
              </div>
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={() => setLinking((v) => !v)} disabled={linkBusy} className="text-[11px] text-indigo-600 hover:underline disabled:opacity-50">เปลี่ยนลูกค้า</button>
                <button type="button" onClick={() => void chooseCustomer(null)} disabled={linkBusy} className="text-[11px] text-neutral-400 hover:text-red-600 disabled:opacity-50">ยกเลิกการผูก</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-neutral-500 mb-2 leading-relaxed">
                ยังไม่ได้ผูกกับลูกค้าในระบบ — ผูกเพื่อให้ใบเสนอราคาเติมชื่อ/ที่อยู่ลูกค้าอัตโนมัติ
              </p>
              <button type="button" onClick={() => setLinking((v) => !v)} disabled={linkBusy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {linkBusy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} ผูกลูกค้า
              </button>
            </>
          )}

          {linking && (
            <div className="mt-2.5">
              <input autoFocus value={custQuery} onChange={(e) => setCustQuery(e.target.value)}
                placeholder="ค้นหาชื่อ / รหัส / เบอร์ / เลขผู้เสียภาษี..."
                className="w-full h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
              <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-neutral-200 bg-white divide-y divide-neutral-100">
                {custSearching && <div className="p-2 text-center text-[11px] text-neutral-400"><Loader2 size={12} className="inline animate-spin mr-1" /> กำลังค้นหา...</div>}
                {!custSearching && custQuery.trim() && custResults.length === 0 && (
                  <div className="p-2 text-center text-[11px] text-neutral-400">ไม่พบลูกค้า — เพิ่มในเมนู CRM ก่อนได้</div>
                )}
                {custResults.map((c) => (
                  <button key={c.id} type="button" disabled={linkBusy} onClick={() => void chooseCustomer(c.id)}
                    className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 disabled:opacity-50">
                    <div className="text-xs font-medium text-neutral-800 truncate">{c.name}</div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      {[c.code, c.phone || (c as { mobile?: string | null }).mobile, c.tax_id].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <div className="text-[10px] uppercase font-bold text-neutral-500 mb-2 tracking-wide">
            🏷️ แท็ก
          </div>
          <div className="flex flex-wrap gap-1.5">
            {autoTags.map((t) => (
              <TagChip key={`a-${t}`} label={t} isAuto />
            ))}
            {(conversation.tags ?? []).map((t) => (
              <TagChip key={`m-${t}`} label={t} onRemove={() => void handleRemoveTag(t)} />
            ))}
            <TagPicker
              existing={[...autoTags, ...(conversation.tags ?? [])]}
              onAdd={(t) => void handleAddTag(t)}
            />
          </div>
        </div>

        <Separator />

        {/* Packer + Bot toggle — Packer gets 2/3 (long names fit), bot 1/3 (just the switch) */}
        <div className="grid grid-cols-3 gap-2">
          {/* Packer */}
          <div className="min-w-0 col-span-2">
            <div className="text-[10px] uppercase font-bold text-neutral-500 mb-1.5 tracking-wide truncate">
              👷 ผู้รับผิดชอบ
            </div>
            <PackerSelect
              packers={packers}
              selectedId={conversation.assigned_to}
              onChange={(id) => void handleSetPacker(id)}
            />
          </div>

          {/* Bot auto-reply toggle */}
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold text-neutral-500 mb-1.5 tracking-wide flex items-center gap-1 truncate">
              <Bot size={10} /> บอทตอบ
            </div>
            <button
              type="button"
              onClick={() => void handleToggleBot()}
              title={
                botEnabled
                  ? 'บอทตอบลูกค้าให้ — กดเพื่อปิดเมื่อต้องการคุยเอง'
                  : 'บอทถูกปิด — ลูกค้าทักเข้ามาจะไม่มีการตอบ. กดเพื่อเปิดกลับ'
              }
              className={`w-full h-9 flex items-center justify-between gap-1.5 px-2.5 rounded-md border transition ${
                botEnabled
                  ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                  : 'border-amber-200 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              <span
                className={`text-xs font-semibold truncate ${
                  botEnabled ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                {botEnabled ? '🤖 เปิด' : '🤖 ปิด'}
              </span>
              <div
                className={`relative w-8 h-4 rounded-full transition flex-shrink-0 ${
                  botEnabled ? 'bg-emerald-500' : 'bg-neutral-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                    botEnabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </div>
            </button>
          </div>
        </div>

        <Separator />

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase font-bold text-neutral-500 tracking-wide flex items-center gap-1">
              <StickyNote size={11} /> โน้ต ({notes.length})
            </div>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setEditingNote(undefined);
                setModalOpen(true);
              }}
              className="gap-1 text-[10px] text-indigo-700 border-indigo-200 hover:bg-indigo-50"
            >
              <Plus size={10} /> เพิ่ม
            </Button>
          </div>

          {loadingNotes && (
            <div className="text-xs text-neutral-400 text-center py-3">
              <Loader2 size={12} className="inline animate-spin mr-1" />
              กำลังโหลด...
            </div>
          )}
          {!loadingNotes && notes.length === 0 && (
            <div className="text-xs text-neutral-400 text-center py-4 border border-dashed border-neutral-200 rounded-lg bg-neutral-50/30">
              ยังไม่มีโน้ต — กด "เพิ่ม" เพื่อสร้างโน้ตแรก
            </div>
          )}
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              draggable
              isDragging={dragId === n.id}
              isDragOver={dragOverId === n.id && dragId !== n.id}
              onDragStart={handleDragStart(n.id)}
              onDragOver={handleDragOver(n.id)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(n.id)}
              onDragEnd={handleDragEnd}
              onEdit={() => {
                setEditingNote(n);
                setModalOpen(true);
              }}
              onDelete={() => void handleDeleteNote(n)}
              onTogglePin={() => void handleTogglePin(n)}
            />
          ))}
        </div>
      </div>

      <NoteModal
        open={modalOpen}
        initial={editingNote}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmitNote}
      />
    </Card>
  );
}
