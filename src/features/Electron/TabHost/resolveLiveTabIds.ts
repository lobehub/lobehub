import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

export const MAX_LIVE_TAB_ROUTERS = 3;

export const resolveLiveTabIds = (
  tabs: Pick<TabItem, 'id' | 'lastVisited'>[],
  activeTabId: string | null,
  cap: number,
): string[] => {
  const hasActive = activeTabId !== null && tabs.some((tab) => tab.id === activeTabId);

  if (cap <= 0) return hasActive ? [activeTabId!] : [];

  const ranked = tabs
    .map((tab, index) => ({ id: tab.id, index, lastVisited: tab.lastVisited }))
    .sort((a, b) => b.lastVisited - a.lastVisited || a.index - b.index);

  const live = new Set<string>();
  if (hasActive) live.add(activeTabId!);

  for (const entry of ranked) {
    if (live.size >= cap) break;
    live.add(entry.id);
  }

  return tabs.filter((tab) => live.has(tab.id)).map((tab) => tab.id);
};
