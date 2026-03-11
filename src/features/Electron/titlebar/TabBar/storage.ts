import { type PageReference } from '@/features/Electron/titlebar/RecentlyViewed/types';

export const TAB_PAGES_STORAGE_KEY = 'lobechat:desktop:tab-pages:v1';

interface TabPagesStorageData {
  activeTabId: string | null;
  tabs: PageReference[];
}

export const getTabPages = (): TabPagesStorageData => {
  if (typeof window === 'undefined') return { activeTabId: null, tabs: [] };

  try {
    const data = window.localStorage.getItem(TAB_PAGES_STORAGE_KEY);
    if (!data) return { activeTabId: null, tabs: [] };

    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return { activeTabId: null, tabs: [] };

    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(
          (item: any): item is PageReference =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.type === 'string' &&
            typeof item.lastVisited === 'number' &&
            item.params !== undefined,
        )
      : [];

    return {
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      tabs,
    };
  } catch {
    return { activeTabId: null, tabs: [] };
  }
};

export const saveTabPages = (tabs: PageReference[], activeTabId: string | null): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(TAB_PAGES_STORAGE_KEY, JSON.stringify({ activeTabId, tabs }));
    return true;
  } catch {
    return false;
  }
};
