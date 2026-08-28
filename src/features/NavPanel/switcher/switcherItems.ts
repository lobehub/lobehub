export interface SwitcherItem {
  avatar?: string;
  background?: string;
  id: string;
  private?: boolean;
  subtitle?: string;
  title: string;
}

export const SWITCHER_RECENT_CAP = 8;
export const SWITCHER_RECENT_LIMIT = 5;

export const touchRecentId = (ids: string[], id: string, cap = SWITCHER_RECENT_CAP): string[] => {
  if (!id) return ids;
  return [id, ...ids.filter((item) => item !== id)].slice(0, cap);
};

export const pickRecentItems = <T extends { id: string }>(
  ids: string[],
  items: readonly T[],
  options?: { excludeId?: string; limit?: number },
): T[] => {
  const excludeId = options?.excludeId;
  const limit = options?.limit ?? SWITCHER_RECENT_LIMIT;
  const map = new Map(items.map((item) => [item.id, item]));
  const out: T[] = [];

  for (const id of ids) {
    if (id === excludeId) continue;
    const item = map.get(id);
    if (!item) continue;
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
};

export const filterSwitcherItems = <T extends { subtitle?: string; title: string }>(
  items: readonly T[],
  query: string,
): T[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(normalized) ||
      item.subtitle?.toLowerCase().includes(normalized),
  );
};
