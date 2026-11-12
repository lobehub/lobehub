import { localDatabase } from '@/libs/localDatabase';

/**
 * One-time cleanup of the removed SWR persistence layer.
 *
 * SWR used to persist its cache to the local database (`swr-cache`
 * collection, IndexedDB on the web and SQLite in Electron) and to localStorage
 * (`lobechat-swr-cache` and the scoped `lobechat-swr-cache:<scope>` entries).
 * Nothing reads them anymore; server data the UI paints lives in replicas.
 */
export const LEGACY_SWR_CACHE_COLLECTION = 'swr-cache';
export const LEGACY_SWR_LOCAL_STORAGE_PREFIX = 'lobechat-swr-cache';
/** Set once the purge succeeded, so later boots skip it. */
export const LEGACY_SWR_CACHE_PURGED_KEY = 'lobechat-legacy-swr-cache-purged';

const removeLegacyLocalStorage = () => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LEGACY_SWR_LOCAL_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
};

/**
 * Remove the legacy SWR cache once per browser profile / desktop install.
 *
 * Runs after first paint and never throws. On failure the marker stays unset,
 * so the next boot tries again.
 */
export const purgeLegacySWRCache = async (): Promise<void> => {
  if (typeof window === 'undefined') return;

  try {
    if (localStorage.getItem(LEGACY_SWR_CACHE_PURGED_KEY)) return;

    removeLegacyLocalStorage();
    await localDatabase.deleteByPrefix(LEGACY_SWR_CACHE_COLLECTION, '');
    localStorage.setItem(LEGACY_SWR_CACHE_PURGED_KEY, '1');
  } catch (error) {
    console.warn('[SPA Initialize] legacy SWR cache cleanup failed', error);
  }
};
