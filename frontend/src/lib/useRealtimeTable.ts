import { useEffect } from 'react';
import { supabase } from './supabase';

/**
 * Subscribe to INSERT/UPDATE/DELETE events on a table.
 * Calls `onChange()` whenever a row changes. Debounce in the parent if needed.
 *
 * Usage:
 *   useRealtimeTable('orders', () => void load());
 */
export type RealtimeTable =
  | 'orders'
  | 'inventory'
  | 'inventory_sync_logs'
  | 'customers'
  | 'customer_branches'
  | 'products'
  | 'product_groups'
  | 'quotes'
  | 'knowledge_categories'
  | 'chat_conversations'
  | 'chat_messages';

export function useRealtimeTable(
  table: RealtimeTable,
  onChange: () => void,
) {
  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => onChange()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, onChange]);
}
