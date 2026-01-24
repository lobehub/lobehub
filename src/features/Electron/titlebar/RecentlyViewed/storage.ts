import type { PageEntry } from '@/store/electron/actions/recentPages';

export const PINNED_PAGES_STORAGE_KEY = 'lobechat:desktop:pinned-pages:v1';

/**
 * Get pinned pages from localStorage
 */
export const getPinnedPages = (): PageEntry[] => {
  if (typeof window === 'undefined') return [];

  try {
    const data = window.localStorage.getItem(PINNED_PAGES_STORAGE_KEY);
    if (!data) return [];

    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];

    return parsed;
  } catch {
    return [];
  }
};

/**
 * Save pinned pages to localStorage
 */
export const savePinnedPages = (pages: PageEntry[]): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(PINNED_PAGES_STORAGE_KEY, JSON.stringify(pages));
    return true;
  } catch {
    return false;
  }
};

/**
 * Clear pinned pages from localStorage
 */
export const clearPinnedPages = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.removeItem(PINNED_PAGES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
