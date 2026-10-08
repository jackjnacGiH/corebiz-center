import { supabase } from './supabase';
import type { Json } from './database.types';

export function privateChatFileLocation(url: string): Record<string, string> {
  try {
    const path = new URL(url).pathname.match(/^\/storage\/v1\/object\/sign\/chat-private-attachments\/(.+)$/)?.[1];
    return path ? { file_bucket: 'chat-private-attachments', file_path: decodeURIComponent(path) } : {};
  } catch { return {}; }
}

/** Persist receipt state without blocking the composer or retrying an unknown send. */
export function queueChatOutboundDelivery(input: {
  messageId: string;
  channel: 'line' | 'messenger';
  metadata: Record<string, Json | undefined>;
  body: Record<string, unknown>;
}): void {
  void (async () => {
    let state: 'pending' | 'delivered' | 'failed' = 'pending';
    let reason: string | null = null;
    try {
      const { data, error } = await supabase.functions.invoke(input.channel === 'line' ? 'line-push' : 'messenger-push', { body: input.body });
      let receipt = data as { ok?: boolean; error?: string; state?: string; status?: number } | null;
      const response = (error as { context?: Response } | null)?.context;
      if (!receipt && response?.clone) receipt = await response.clone().json().catch(() => null);
      if (!error && receipt?.ok === true && !receipt.error) state = 'delivered';
      else {
        reason = receipt?.error ?? 'delivery_unconfirmed';
        const status = receipt?.status ?? response?.status;
        const ambiguous = ['delivery_unknown', 'processing_unknown', 'sending'].includes(receipt?.state ?? '')
          || ['delivery_pending_review', 'delivery_requires_review'].includes(reason)
          || !status && !receipt?.error
          || !!status && status >= 500;
        state = ambiguous ? 'pending' : 'failed';
      }
    } catch { reason = 'delivery_unconfirmed'; }
    const failureFlag = input.channel === 'line' ? 'line_push_failed' : 'messenger_push_failed';
    try {
      const { error } = await supabase.from('chat_messages').update({ metadata: {
        ...input.metadata, outbound_delivery: state, [failureFlag]: state === 'failed',
        outbound_delivery_error: reason,
      } }).eq('id', input.messageId);
      if (error) console.warn('[chatInboxApi] delivery receipt could not be saved', { messageId: input.messageId });
    } catch { console.warn('[chatInboxApi] delivery receipt remains pending', { messageId: input.messageId }); }
  })();
}
