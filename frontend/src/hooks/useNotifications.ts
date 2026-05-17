/**
 * useNotifications — state + realtime for the TopBar notification panel.
 *
 * - On mount: fetches the latest 50 notifications via notificationsApi.list().
 * - Subscribes to INSERT / UPDATE events on `notifications` via Supabase
 *   Realtime so new rows appear (and read_at toggles) without a manual refetch.
 * - Exposes markRead(id) and markAllRead() which call the API and then update
 *   local state optimistically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { notificationsApi } from '../lib/api';
import { supabase, type NotificationPrefs } from '../lib/supabase';
import type { Notification } from '../lib/database.types';

/** Map a notification's `type` column to the matching pref key. */
function isAllowedByPrefs(n: Notification, prefs: NotificationPrefs | null): boolean {
    if (!prefs) return true; // no prefs loaded yet → show everything
    switch (n.type) {
        case 'order':     return prefs.new_order;
        case 'inventory': return prefs.low_stock;
        case 'customer':  return prefs.new_customer;
        case 'system':    return prefs.weekly_report;
        default: return true;
    }
}

export interface UseNotificationsResult {
    notifications: Notification[];
    unreadCount: number;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
}

export function useNotifications(prefs?: NotificationPrefs | null): UseNotificationsResult {
    const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);

    // Filter feed by current prefs (memoised per render).
    const notifications = prefs
        ? allNotifications.filter((n) => isAllowedByPrefs(n, prefs))
        : allNotifications;

    const refresh = useCallback(async () => {
        setError(null);
        try {
            const rows = await notificationsApi.list();
            if (mountedRef.current) setAllNotifications(rows);
        } catch (e) {
            if (mountedRef.current) setError((e as Error).message);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void refresh();
        return () => {
            mountedRef.current = false;
        };
    }, [refresh]);

    // Realtime subscription — pick up new rows + read_at flips.
    useEffect(() => {
        const channel = supabase
            .channel('notifications-feed')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications' },
                (payload) => {
                    const row = payload.new as Notification;
                    setAllNotifications((prev) => {
                        if (prev.some((n) => n.id === row.id)) return prev;
                        return [row, ...prev].slice(0, 50);
                    });
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'notifications' },
                (payload) => {
                    const row = payload.new as Notification;
                    setAllNotifications((prev) =>
                        prev.map((n) => (n.id === row.id ? row : n)),
                    );
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, []);

    const markRead = useCallback(async (id: string) => {
        // Optimistic
        setAllNotifications((prev) =>
            prev.map((n) =>
                n.id === id && !n.read_at
                    ? { ...n, read_at: new Date().toISOString() }
                    : n,
            ),
        );
        try {
            await notificationsApi.markRead(id);
        } catch (e) {
            // Rollback by refetching — cheap with 50-row limit
            await refresh();
            throw e;
        }
    }, [refresh]);

    const markAllRead = useCallback(async () => {
        const now = new Date().toISOString();
        setAllNotifications((prev) =>
            prev.map((n) => (n.read_at ? n : { ...n, read_at: now })),
        );
        try {
            await notificationsApi.markAllRead();
        } catch (e) {
            await refresh();
            throw e;
        }
    }, [refresh]);

    const unreadCount = notifications.filter((n) => !n.read_at).length;

    return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}
