/** Upper bound for a stored pinned-row order; mirrors the personal pin cap. */
export const MAX_PINNED_ORDER_ITEMS = 200;

/** Reads a stored order defensively: anything but a string array is no order. */
export const parsePinnedOrder = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/**
 * Lay out pinned rows by a user-chosen order. Rows missing from the order —
 * pinned after it was last saved — keep their incoming (newest first) order
 * and go on top, so a fresh pin still shows up first; the ordered rows follow
 * in the saved sequence. Ids in the order that match no row are ignored.
 */
export const applyPinnedOrder = <T extends { id: string }>(
  items: T[],
  order: readonly string[],
): T[] => {
  if (items.length < 2 || order.length === 0) return items;

  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  const unordered = items.filter((item) => !rank.has(item.id));
  const ordered = items
    .filter((item) => rank.has(item.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);

  return [...unordered, ...ordered];
};
