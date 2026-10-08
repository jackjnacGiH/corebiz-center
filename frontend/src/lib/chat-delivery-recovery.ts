import { supabase } from './supabase';

export interface ChatDeliveryRecovery { event_key: string; state: string; reply_text: string | null; updated_at: string }

export async function listChatDeliveryRecovery(conversationId: string): Promise<ChatDeliveryRecovery[]> {
  // Staff-only RPC introduced by the durable webhook delivery migration.
  const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: ChatDeliveryRecovery[] | null; error: unknown }>;
  const { data, error } = await rpc('list_chat_delivery_recovery', { p_conversation_id: conversationId });
  if (error) throw error;
  return data ?? [];
}

export async function resolveChatDeliveryRecovery(conversationId: string, delivery: ChatDeliveryRecovery): Promise<void> {
  const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  const { error } = await rpc('resolve_chat_delivery_recovery', {
    p_conversation_id: conversationId,
    p_event_key: delivery.event_key,
    p_expected_updated_at: delivery.updated_at,
    p_resolution: 'handled_by_staff',
  });
  if (error) throw error;
}
