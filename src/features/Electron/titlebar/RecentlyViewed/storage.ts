import { normalizeTabScope } from '../TabBar/scope';
import { type TabItem } from '../TabBar/types';

export const PINNED_PAGES_STORAGE_KEY = 'lobechat:desktop:pinned-pages:v3';

const isTabItem = (item: unknown): item is TabItem =>
  !!item &&
  typeof item === 'object' &&
  typeof (item as TabItem).id === 'string' &&
  typeof (item as TabItem).url === 'string' &&
  typeof (item as TabItem).lastVisited === 'number';

const reviveTabItem = (item: unknown): TabItem | null => {
  if (!isTabItem(item)) return null;

  return {
    ...item,
    scope: normalizeTabScope((item as Partial<TabItem>).scope, item.url),
  };
};

const isRevivedTabItem = (item: TabItem | null): item is TabItem => !!item;

export const getPinnedPages = (): TabItem[] => {
  if (typeof window === 'undefined') return [];

  try {
    const data = window.localStorage.getItem(PINNED_PAGES_STORAGE_KEY);
    if (!data) return [];

    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(reviveTabItem).filter(isRevivedTabItem);
  } catch {
    return [];
  }
};

export const savePinnedPages = (pages: TabItem[]): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(PINNED_PAGES_STORAGE_KEY, JSON.stringify(pages));
    return true;
  } catch {
    return false;
  }
};

export const clearPinnedPages = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.removeItem(PINNED_PAGES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
