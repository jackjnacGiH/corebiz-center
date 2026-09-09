/** Coalesce overlapping refresh events without delaying the first read.
 * Events received during a read mark the view dirty, so another read always
 * follows it. Events received during that follow-up are handled the same way.
 * No timer, stale window, or global request/cache state is involved. */
export function createRefreshQueue(refresh: () => Promise<void>) {
  let active: Promise<void> | null = null;
  let queued = false;
  let disposed = false;

  async function drain() {
    let failed = false;
    let failure: unknown;
    do {
      queued = false;
      try {
        await refresh();
        failed = false;
      } catch (error) {
        // A failed query must not discard events that arrived while it ran.
        failed = true;
        failure = error;
      }
    } while (queued && !disposed);
    active = null;
    if (failed) throw failure;
  }

  return {
    request(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (active) {
        queued = true;
        return active;
      }
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const cycle = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      active = cycle;
      // Realtime ignores returned promises. Observe failures for fire-and-
      // forget callers while retaining rejection for callers that await them.
      void cycle.catch(() => {});
      // Start synchronously: even reentrant events see the active cycle.
      void drain().then(resolve, reject);
      return cycle;
    },
    dispose() {
      disposed = true;
      queued = false;
    },
  };
}
