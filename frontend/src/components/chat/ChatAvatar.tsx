import { useState, type ReactNode } from 'react';

interface ChatAvatarProps {
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
  src,
  alt,
  imageClassName,
  fallbackClassName,
  fallback,
  loading = 'lazy',
}: ChatAvatarProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!src || loadFailed) {
    return <div className={fallbackClassName}>{fallback}</div>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={imageClassName}
      referrerPolicy="no-referrer"
      loading={loading}
      decoding="async"
      onError={() => setLoadFailed(true)}
    />
  );
}
