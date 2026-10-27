// Download route code concurrently with authentication. This never mounts a
// page or reads its data; ProtectedRoute remains responsible for access.
export function sharedRouteImport<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        // A failed speculative download must not poison a later navigation.
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

export function preloadRequestedRoute(
  pathname: string,
  loaders: { chat: () => Promise<unknown>; shipping: () => Promise<unknown> },
): void {
  const route = pathname.replace(/\/+$/, '');
  const load = route === '/chat' ? loaders.chat
    : route === '/shipping' ? loaders.shipping : undefined;
  // Navigation can continue elsewhere while this finishes. No state or data
  // is published, and failures are left to the normal lazy route on demand.
  if (load) void load().catch(() => {});
}
