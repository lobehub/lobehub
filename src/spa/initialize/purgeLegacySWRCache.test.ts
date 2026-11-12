/**
 * @vitest-environment happy-dom
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDatabase, registerLocalDatabaseAdapter } from '@/libs/localDatabase';
import { createIndexedDBLocalDatabaseAdapter } from '@/libs/localDatabase/indexedDBAdapter';

import {
  LEGACY_SWR_CACHE_COLLECTION,
  LEGACY_SWR_CACHE_PURGED_KEY,
  purgeLegacySWRCache,
} from './purgeLegacySWRCache';

const seedLegacyCache = async () => {
  // Rows the removed SWR provider wrote: `${scope}::${serializedKey}`.
  await localDatabase.set(LEGACY_SWR_CACHE_COLLECTION, 'u1:personal::["message:list",{},2]', {
    data: [],
    updatedAt: 1,
  });
  await localDatabase.set(LEGACY_SWR_CACHE_COLLECTION, 'u2:ws_1::["topic:search","q"]', {
    data: [],
    updatedAt: 1,
  });
  localStorage.setItem('lobechat-swr-cache', '[]');
  localStorage.setItem('lobechat-swr-cache:u1:personal', '[]');
  localStorage.setItem('lobechat-swr-cache:u2:ws_1', '[]');
};

const legacyRows = () => localDatabase.entriesByPrefix(LEGACY_SWR_CACHE_COLLECTION, '');
const legacyLocalStorageKeys = () =>
  Object.keys(localStorage).filter((key) => key.startsWith('lobechat-swr-cache'));

let restoreAdapter: () => void;

beforeEach(() => {
  restoreAdapter = registerLocalDatabaseAdapter(createIndexedDBLocalDatabaseAdapter());
  localStorage.clear();
});

afterEach(async () => {
  await localDatabase.deleteByPrefix(LEGACY_SWR_CACHE_COLLECTION, '');
  await localDatabase.deleteByPrefix('query-projections', '');
  restoreAdapter();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('purgeLegacySWRCache', () => {
  it('removes every scope of the legacy SWR cache from the local database and localStorage', async () => {
    await seedLegacyCache();
    await localDatabase.set('query-projections', 'replica-row', { data: 1 });
    localStorage.setItem('replica:recentList:v1:keep', '1');

    await purgeLegacySWRCache();

    expect(await legacyRows()).toEqual([]);
    expect(legacyLocalStorageKeys()).toEqual([]);
    // Replica storage is untouched.
    expect(await localDatabase.get('query-projections', 'replica-row')).toEqual({ data: 1 });
    expect(localStorage.getItem('replica:recentList:v1:keep')).toBe('1');
  });

  it('runs only once', async () => {
    await purgeLegacySWRCache();
    expect(localStorage.getItem(LEGACY_SWR_CACHE_PURGED_KEY)).toBe('1');

    // Anything under the old names after the purge is not ours to delete again.
    await seedLegacyCache();
    await purgeLegacySWRCache();

    expect(await legacyRows()).toHaveLength(2);
  });

  it('never throws and retries on the next boot when the local database fails', async () => {
    await seedLegacyCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deleteByPrefix = vi
      .spyOn(localDatabase, 'deleteByPrefix')
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    await expect(purgeLegacySWRCache()).resolves.toBeUndefined();
    expect(localStorage.getItem(LEGACY_SWR_CACHE_PURGED_KEY)).toBeNull();

    deleteByPrefix.mockRestore();
    await purgeLegacySWRCache();

    expect(await legacyRows()).toEqual([]);
    expect(localStorage.getItem(LEGACY_SWR_CACHE_PURGED_KEY)).toBe('1');
  });
});
