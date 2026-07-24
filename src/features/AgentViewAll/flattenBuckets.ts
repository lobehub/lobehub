import { type SidebarAgentItem } from '@lobechat/types';

/** Flatten sidebar buckets into one list, first occurrence of an id wins. */
export const dedupeById = (items: SidebarAgentItem[]): SidebarAgentItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

/**
 * One view-all list from a sidebar section's three buckets. Pinned items
 * lead — omitting them (the original bug) makes pinned agents unfindable on
 * the view-all page even though the sidebar still shows them.
 */
export const flattenAgentBuckets = (
  pinned: SidebarAgentItem[],
  groups: { items: SidebarAgentItem[] }[],
  ungrouped: SidebarAgentItem[],
): SidebarAgentItem[] => dedupeById([...pinned, ...groups.flatMap((g) => g.items), ...ungrouped]);
