// Shared empty default — expand/collapse sets are never mutated in place (every
// update builds a fresh Set), so one frozen instance is safe to hand out and
// keeps `expanded`/`collapsedGroups` referentially stable for an unseeded id.
export const EMPTY_ID_SET: Set<string> = new Set();

/**
 * Write one aggregate's expand/collapse set into a per-id map (useState-style).
 * Expand state is kept PER aggregate because the portal embed swaps the active
 * acceptance without remounting — a single shared set would bleed one
 * aggregate's toggles onto the next and lose them on return. Returns the same
 * map reference when the value is unchanged so React can skip a re-render.
 */
export const setAggregateEntry = (
  map: Map<string, Set<string>>,
  id: string | undefined,
  update: Set<string> | ((prev: Set<string>) => Set<string>),
): Map<string, Set<string>> => {
  const key = id ?? '';
  const prev = map.get(key) ?? EMPTY_ID_SET;
  const next = typeof update === 'function' ? update(prev) : update;
  if (next === prev) return map;
  const nextMap = new Map(map);
  nextMap.set(key, next);
  return nextMap;
};
