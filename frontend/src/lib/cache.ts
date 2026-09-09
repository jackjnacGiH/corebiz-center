/**
 * Tiny stale-while-revalidate cache for heavy list fetches.
 *
 * Goal: make the admin feel instant. The first load of a list fetches + caches
 * it; revisiting the page returns the cached copy immediately (no spinner), and
 * — if the copy is older than `staleMs` — refreshes in the background and pushes
 * the fresh data to the view via `onFresh`. So data is never wrong for long, but
 * navigation no longer re-downloads thousands of rows every time.
 *
 * No external library — just a module-level Map (lives for the SPA session).
 */

type Entry<T = unknown> = { data: T; at: number };
type Pending = { promise: Promise<unknown>; listeners: Set<(data: unknown) => void> };

const store = new Map<string, Entry>();
const pending = new Map<string, Pending>();

const DEFAULT_STALE_MS = 30_000;

/** Share reads already in progress, but explicit reloads always start a new
 * generation: a request started before a write must not satisfy its reload. */
function fetchList<T>(key: string, fetcher: () => Promise<T>, force = false, onFresh?: (d: T) => void): Promise<T> {
  const active = pending.get(key);
  const listener = onFresh as ((data: unknown) => void) | undefined;
  if (active && !force) {
    if (listener) active.listeners.add(listener);
    return active.promise as Promise<T>;
  }

  const request: Pending = {
    promise: Promise.resolve(),
    // A forced refresh supersedes the earlier generation; its subscribers
    // should receive the newer result as well.
    listeners: new Set(active?.listeners),
  };
  if (listener) request.listeners.add(listener);
  pending.set(key, request);
  request.promise = Promise.resolve().then(fetcher)
    .then((data) => {
      // Invalidation or a newer forced request makes this result obsolete.
      if (pending.get(key) === request) {
        store.set(key, { data, at: Date.now() });
        for (const notify of request.listeners) {
          try { notify(data); } catch { /* one view must not block the others */ }
        }
      }
      return data;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  return request.promise as Promise<T>;
}

/**
 * Stale-while-revalidate list loader.
 * @param force  skip the cache and fetch fresh (use for an explicit Reload).
 * @param onFresh called with new data when a background refresh finishes.
 */
export async function swrList<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { onFresh?: (d: T) => void; force?: boolean; staleMs?: number } = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const hit = store.get(key) as Entry<T> | undefined;
  if (!opts.force && hit) {
    if (Date.now() - hit.at > staleMs) {
      void fetchList(key, fetcher, false, opts.onFresh)
        .catch(() => { /* keep the stale copy on failure */ });
    }
    return hit.data;
  }
  return fetchList(key, fetcher, opts.force);
}

/** Warm the cache ahead of time (e.g. right after login) so the first visit to
 *  a heavy page is instant. No-op if already cached. */
export function prefetchList<T>(key: string, fetcher: () => Promise<T>): void {
  if (store.has(key)) return;
  void fetchList(key, fetcher)
    .catch(() => { /* best-effort */ });
}

/** Drop a cached list (e.g. after a write) so the next read fetches fresh. */
export function invalidateList(...keys: string[]): void {
  for (const k of keys) {
    store.delete(k);
    pending.delete(k);
  }
}

/** Detach cached and pending reads before the authenticated identity changes.
 * A late response from the previous account cannot refill the new cache. */
export function clearListCache(): void {
  store.clear();
  pending.clear();
}

/** True if a list is already cached — use to skip the cold-load spinner. */
export function hasCache(key: string): boolean {
  return store.has(key);
}

/** Cache keys — keep them in one place to avoid typos across pages. */
export const CK = {
  products: 'products',
  customers: 'customers',
  categories: 'categories',
  warehouses: 'warehouses',
} as const;
