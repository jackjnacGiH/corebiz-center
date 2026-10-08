/** A request belongs to one selected record and one generation of that selection. */
export function createAsyncScope(initialIdentity: string | null = null) {
  let identity = initialIdentity;
  let generation = 0;
  return {
    select(next: string | null) {
      if (identity !== next) { identity = next; generation += 1; }
    },
    invalidate() { generation += 1; },
    capture() {
      const selected = identity;
      const version = generation;
      return () => selected !== null && identity === selected && generation === version;
    },
  };
}
