import { createRefreshQueue } from './refreshQueue.ts';

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

/** Keep receiving changes, but defer reads on non-chat pages until visible. */
export function createVisibilityRefresh(refresh: () => Promise<void>, visibility: VisibilitySource) {
  let wasHidden = visibility.hidden;
  const queue = createRefreshQueue(async () => {
    if (visibility.hidden) {
      wasHidden = true;
      return;
    }
    await refresh();
  });
  const onVisibility = () => {
    if (visibility.hidden) {
      wasHidden = true;
    } else if (wasHidden) {
      wasHidden = false;
      void queue.request().catch(() => {});
    }
  };
  visibility.addEventListener('visibilitychange', onVisibility);
  return {
    request: () => queue.request(),
    dispose() {
      visibility.removeEventListener('visibilitychange', onVisibility);
      queue.dispose();
    },
  };
}
