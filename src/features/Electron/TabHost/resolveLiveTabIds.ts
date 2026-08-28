import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

export const MAX_LIVE_TAB_ROUTERS = 3;

export const resolveLiveTabIds = (
  tabs: Pick<TabItem, 'id' | 'lastVisited'>[],
  activeTabId: string | null,
  cap: number,
  retainedTabIds: string[] = [],
): string[] => {
  const hasActive = activeTabId !== null && tabs.some((tab) => tab.id === activeTabId);
  const existingIds = new Set(tabs.map((tab) => tab.id));

  if (cap <= 0) {
    const retained = new Set(retainedTabIds.filter((id) => existingIds.has(id)));
    if (hasActive) retained.add(activeTabId);
    return tabs.filter((tab) => retained.has(tab.id)).map((tab) => tab.id);
  }

  const ranked = tabs
    .map((tab, index) => ({ id: tab.id, index, lastVisited: tab.lastVisited }))
    .sort((a, b) => b.lastVisited - a.lastVisited || a.index - b.index);

  const live = new Set<string>();
  if (hasActive) live.add(activeTabId!);
  for (const id of retainedTabIds) {
    if (existingIds.has(id)) live.add(id);
  }

  for (const entry of ranked) {
    if (live.size >= cap) break;
    live.add(entry.id);
  }

  return tabs.filter((tab) => live.has(tab.id)).map((tab) => tab.id);
};
