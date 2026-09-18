import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';

const avatarRefreshes = new Map<string, Promise<string | null>>();
const refreshedAvatarUrls = new Map<string, string>();
const retryAfter = new Map<string, number>();

function refreshLineAvatar(conversationId: string, failedUrl: string | null): Promise<string | null> {
  const pending = avatarRefreshes.get(conversationId);
  if (pending) return pending;
  const refreshedUrl = refreshedAvatarUrls.get(conversationId);
  if (refreshedUrl && refreshedUrl !== failedUrl) return Promise.resolve(refreshedUrl);

  const key = `line-avatar-refresh:${conversationId}`;
  let nextRetry = retryAfter.get(conversationId) ?? 0;
  try { nextRetry = Math.max(nextRetry, Number(sessionStorage.getItem(key)) || 0); } catch { /* storage may be disabled */ }
  if (Date.now() < nextRetry) return Promise.resolve(null);
  const setRetry = (durationMs: number) => {
    const until = Date.now() + durationMs;
    retryAfter.set(conversationId, until);
    try { sessionStorage.setItem(key, String(until)); } catch { /* storage may be disabled */ }
  };
  setRetry(30 * 60_000);

  const request = supabase.functions.invoke('line-avatar-refresh', {
    body: { conversation_id: conversationId, failed_url: failedUrl },
  }).then(({ data, error }) => {
    if (error || !data?.ok) {
      setRetry(5 * 60_000);
      return null;
    }
    const url = typeof data.avatar_url === 'string' ? data.avatar_url : null;
    if (url) refreshedAvatarUrls.set(conversationId, url);
    return url;
  }).catch(() => {
    setRetry(5 * 60_000);
    return null;
  }).finally(() => { avatarRefreshes.delete(conversationId); });
  avatarRefreshes.set(conversationId, request);
  return request;
}

interface ChatAvatarProps {
  conversationId: string;
  channel: string;
  src?: string | null;
  alt: string;
  imageClassName: string;
  fallbackClassName: string;
  fallback: ReactNode;
  loading?: 'eager' | 'lazy';
}

/**
 * Renders a channel avatar with a local fallback.
 *
 * Callers key this component by conversation + avatar URL so a failed image in
 * one conversation cannot leave the next conversation stuck on its fallback.
 */
export default function ChatAvatar({
  conversationId,
  channel,
  src,
  alt,
  imageClassName,
  fallbackClassName,
  fallback,
  loading = 'lazy',
}: ChatAvatarProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshedSrc, setRefreshedSrc] = useState<string | null>(null);
  const imageSrc = refreshedSrc ?? src;

  // A few old conversations have no saved picture at all. Refresh only when
  // staff opens that room; do not add requests to normal inbox loading.
  useEffect(() => {
    if (channel !== 'line' || src || loading !== 'eager') return;
    let mounted = true;
    void refreshLineAvatar(conversationId, null).then((url) => {
      if (mounted && url) setRefreshedSrc(url);
    });
    return () => { mounted = false; };
  }, [channel, conversationId, loading, src]);

  if (!imageSrc || loadFailed) {
    return <div className={fallbackClassName}>{fallback}</div>;
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={imageClassName}
      referrerPolicy="no-referrer"
      loading={loading}
      decoding="async"
      onError={() => {
        setLoadFailed(true);
        if (channel !== 'line') return;
        void refreshLineAvatar(conversationId, imageSrc).then((url) => {
          if (url && url !== imageSrc) {
            setRefreshedSrc(url);
            setLoadFailed(false);
          }
        });
      }}
    />
  );
}
