import { supabase } from './supabase';

export interface BotConversationMemoryProduct {
  sku: string | null;
  name: string | null;
  size: string | null;
  grit: string | null;
  unit: string | null;
  quantity: number | null;
}

export interface BotConversationMemoryView {
  summary: string;
  topics: string[];
  active_intent: string;
  products: BotConversationMemoryProduct[];
  application: string;
  machine: string;
  material: string;
  confirmed_facts: string[];
  pending_questions: string[];
  preferences: string[];
  last_action: string;
  staff_note: string;
  staff_locked: boolean;
  updated_at: string | null;
  expires_at: string | null;
}

async function callBotMemory(action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('bot-learning-admin', {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { message = (await (error as any).context?.json?.())?.error ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) throw new Error(String(result?.error ?? 'เกิดข้อผิดพลาด'));
  return result;
}

export const botMemoryApi = {
  async getConversationMemory(conversationId: string): Promise<BotConversationMemoryView | null> {
    const result = await callBotMemory('get_conversation_memory', { conversation_id: conversationId });
    return (result.memory ?? null) as BotConversationMemoryView | null;
  },

  async updateConversationMemory(
    conversationId: string,
    patch: Pick<BotConversationMemoryView, 'staff_note' | 'staff_locked'>,
  ): Promise<BotConversationMemoryView> {
    const result = await callBotMemory('update_conversation_memory', {
      conversation_id: conversationId,
      staff_note: patch.staff_note.trim(),
      staff_locked: patch.staff_locked,
    });
    return result.memory as BotConversationMemoryView;
  },
};
