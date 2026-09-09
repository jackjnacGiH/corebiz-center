import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from './supabase';
import { createRefreshQueue } from './refreshQueue';

/** One page-level refresh queue, shared by all tables that reload that page.
 * The page loader keeps responsibility for displaying its existing errors. */
export function useRealtimeRefresh(onRefresh: () => Promise<void>) {
  const refreshRef = useRef(onRefresh);
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  useLayoutEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const queue = createRefreshQueue(() => refreshRef.current());
    queueRef.current = queue;
    return () => {
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, []);
  return useCallback(() => queueRef.current?.request() ?? Promise.resolve(), []);
}

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
  // Only publish committed callbacks. Inline page callbacks change on every
  // render, but must not tear down the table's active subscription.
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => onChangeRef.current()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table]);
}
