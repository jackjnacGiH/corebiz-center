import { useLayoutEffect, useMemo } from 'react';
import { createAsyncScope } from './async-scope';

/** Commit-time invalidation runs before old requests can publish into a new screen. */
export function useAsyncScope(identity: string | null) {
  const scope = useMemo(() => createAsyncScope(identity), [identity]);
  useLayoutEffect(() => () => scope.invalidate(), [scope]);
  return scope;
}
