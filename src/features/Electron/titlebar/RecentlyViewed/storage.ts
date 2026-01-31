import { type PageReference } from './types';

export const PINNED_PAGES_STORAGE_KEY = 'lobechat:desktop:pinned-pages:v2';

/**
 * Get pinned pages from localStorage
 */
export const getPinnedPages = (): PageReference[] => {
  if (typeof window === 'undefined') return [];

  try {
    const data = window.localStorage.getItem(PINNED_PAGES_STORAGE_KEY);
    if (!data) return [];

    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];

    // Validate each entry has required fields
    return parsed.filter(
      (item): item is PageReference =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.type === 'string' &&
        typeof item.lastVisited === 'number' &&
        item.params !== undefined,
    );
  } catch {
    return [];
  }
};

/**
 * Save pinned pages to localStorage
 */
export const savePinnedPages = (pages: PageReference[]): boolean => {
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
