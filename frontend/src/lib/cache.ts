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

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_STALE_MS = 30_000;

function backgroundRevalidate<T>(key: string, fetcher: () => Promise<T>, onFresh?: (d: T) => void) {
  if (inflight.has(key)) return; // a refresh is already running — don't stack
  const p = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      onFresh?.(data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  void p.catch(() => { /* keep the stale copy on failure */ });
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
    if (Date.now() - hit.at > staleMs) backgroundRevalidate(key, fetcher, opts.onFresh);
    return hit.data;
  }
  // Realtime events from several tables can call the same page loader at once.
  // Join the active request even for force refreshes instead of downloading the
  // same heavy list repeatedly.
  const active = inflight.get(key) as Promise<T> | undefined;
  if (active) return active;

  const request = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/** Warm the cache ahead of time (e.g. right after login) so the first visit to
 *  a heavy page is instant. No-op if already cached. */
export function prefetchList<T>(key: string, fetcher: () => Promise<T>): void {
  if (store.has(key) || inflight.has(key)) return;
  const request = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  void request.catch(() => { /* best-effort */ });
}

/** Drop a cached list (e.g. after a write) so the next read fetches fresh. */
export function invalidateList(...keys: string[]): void {
  for (const k of keys) store.delete(k);
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
