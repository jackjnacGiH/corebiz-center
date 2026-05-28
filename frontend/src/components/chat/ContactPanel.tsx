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
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  chatProfileApi,
  chatNotesApi,
  profilesApi,
  type ChatConversation,
  type ChatContactNote,
  type StaffProfile,
  type CustomerSnapshot,
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

  const handleSubmitNote = async (payload: Omit<ChatContactNote, 'id' | 'conversation_id' | 'created_at' | 'updated_at' | 'created_by'>) => {
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
    if (!confirm('ลบโน้ตนี้?')) return;
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

  return (
    <Card className="w-80 flex-shrink-0 flex flex-col gap-0 py-0 overflow-hidden">
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {/* Header — avatar + original display_name (read-only) + editable alias (nickname) + channel ID */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 grid place-items-center text-white text-2xl font-bold mb-2">
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
              ชื่อเล่น: {conversation.alias_name}
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

        {/* Customer stats */}
        {customer && (
          <div className="grid grid-cols-2 gap-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
            <div>
              <div className="text-[10px] text-neutral-500 flex items-center gap-1">
                <ShoppingBag size={10} /> ออเดอร์
              </div>
              <div className="text-base font-bold text-neutral-900">{customer.total_orders}</div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500 flex items-center gap-1">💰 ยอดซื้อ</div>
              <div className="text-base font-bold text-emerald-600">
                ฿{Number(customer.total_spent).toLocaleString()}
              </div>
            </div>
            {lastDays !== null && (
              <div className="col-span-2 pt-2 border-t border-neutral-200">
                <div className="text-[10px] text-neutral-500 flex items-center gap-1">
                  <MessageSquare size={10} /> ลูกค้าทักล่าสุด
                </div>
                <div className="text-sm font-medium text-neutral-900">
                  {lastDays === 0 ? 'วันนี้' : `${lastDays} วันที่แล้ว`}
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Packer */}
        <div>
          <div className="text-[10px] uppercase font-bold text-neutral-500 mb-2 tracking-wide">
            👷 ผู้รับผิดชอบ (Packer)
          </div>
          <PackerSelect
            packers={packers}
            selectedId={conversation.assigned_to}
            onChange={(id) => void handleSetPacker(id)}
          />
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
