import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Subscribe to INSERT/UPDATE/DELETE events on a table.
 * Coalesces bursts of row changes into one callback. The latest callback is
 * kept in a ref so inline callbacks do not recreate the channel each render.
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
  | 'customer_contacts'
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
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => onChangeRef.current(), 750);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [table]);
}
