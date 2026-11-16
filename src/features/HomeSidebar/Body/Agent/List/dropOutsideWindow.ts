interface DropEventLike {
  activatorEvent: Event | null;
  delta: { x: number; y: number };
}

const pointerStart = (event: Event | null): { x: number; y: number } | undefined => {
  if (!event) return undefined;
  if ('touches' in event) {
    const touch = (event as TouchEvent).touches[0] ?? (event as TouchEvent).changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  if ('clientX' in event) {
    const { clientX, clientY } = event as MouseEvent;
    return { x: clientX, y: clientY };
  }
  return undefined;
};

/**
 * Whether a sortable drag ended with the pointer outside the browser window:
 * where it was picked up plus how far it travelled. A keyboard drag has no
 * pointer, so it never counts.
 */
export const isDropOutsideWindow = (
  { activatorEvent, delta }: DropEventLike,
  viewport: { height: number; width: number } = {
    height: window.innerHeight,
    width: window.innerWidth,
  },
): boolean => {
  const start = pointerStart(activatorEvent);
  if (!start) return false;

  const x = start.x + delta.x;
  const y = start.y + delta.y;
  return x < 0 || y < 0 || x > viewport.width || y > viewport.height;
};

export type SortableDropOutcome =
  { type: 'none' } | { id: string; type: 'openWindow' } | { ids: string[]; type: 'reorder' };

interface SortableDropEvent extends DropEventLike {
  active: { id: string | number };
  over: { id: string | number } | null;
}

/**
 * What a finished drag on a sortable Agent list means. Outside the window is
 * checked first: closest-center collision always resolves to some row, so a
 * drop outside the window still reports one.
 */
export const resolveSortableDrop = (
  event: SortableDropEvent,
  ids: readonly string[],
  viewport?: { height: number; width: number },
): SortableDropOutcome => {
  const activeId = String(event.active.id);
  if (isDropOutsideWindow(event, viewport)) return { id: activeId, type: 'openWindow' };
  if (!event.over || activeId === String(event.over.id)) return { type: 'none' };

  const from = ids.indexOf(activeId);
  const to = ids.indexOf(String(event.over.id));
  if (from < 0 || to < 0) return { type: 'none' };

  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return { ids: next, type: 'reorder' };
};

/**
 * Lay out rows by an order dropped but not yet saved. Rows the order does not
 * name (added meanwhile) keep their place after the named ones; ids that no
 * longer match a row are skipped.
 */
export const applyPendingOrder = <T extends { id: string }>(
  rows: T[],
  pendingIds: readonly string[] | undefined,
): T[] => {
  if (!pendingIds) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const named = pendingIds.flatMap((id) => byId.get(id) ?? []);
  const namedIds = new Set(named.map((row) => row.id));
  return [...named, ...rows.filter((row) => !namedIds.has(row.id))];
};
