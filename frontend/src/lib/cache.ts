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

type Entry<T = unknown> = { data: T; at: number; inflight?: Promise<unknown> };

const store = new Map<string, Entry>();

const DEFAULT_STALE_MS = 30_000;

function backgroundRevalidate<T>(key: string, fetcher: () => Promise<T>, onFresh?: (d: T) => void) {
  const cur = store.get(key);
  if (cur?.inflight) return; // a refresh is already running — don't stack
  const p = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      onFresh?.(data);
    })
    .catch(() => { /* keep the stale copy on failure */ })
    .finally(() => {
      const e = store.get(key);
      if (e) e.inflight = undefined;
    });
  if (cur) cur.inflight = p;
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
  const data = await fetcher();
  store.set(key, { data, at: Date.now() });
  return data;
}

/** Warm the cache ahead of time (e.g. right after login) so the first visit to
 *  a heavy page is instant. No-op if already cached. */
export function prefetchList<T>(key: string, fetcher: () => Promise<T>): void {
  if (store.has(key)) return;
  void fetcher()
    .then((data) => store.set(key, { data, at: Date.now() }))
    .catch(() => { /* best-effort */ });
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
