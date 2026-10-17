import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localDatabase, type LocalDatabaseAdapter, registerLocalDatabaseAdapter } from './index';

describe('localDatabase', () => {
  const collection = 'database-test';
  const otherCollection = 'database-test-other';

  beforeEach(async () => {
    await localDatabase.deleteByPrefix(collection, '');
    await localDatabase.deleteByPrefix(otherCollection, '');
  });

  it('stores values independently across collections', async () => {
    await localDatabase.set(collection, 'shared-key', { source: 'first' });
    await localDatabase.set(otherCollection, 'shared-key', { source: 'second' });

    await expect(localDatabase.get(collection, 'shared-key')).resolves.toEqual({ source: 'first' });
    await expect(localDatabase.get(otherCollection, 'shared-key')).resolves.toEqual({
      source: 'second',
    });
  });

  it('queries and deletes keys by prefix within one collection', async () => {
    await localDatabase.batch([
      { collection, key: 'scope-a::1', type: 'set', value: 1 },
      { collection, key: 'scope-a::2', type: 'set', value: 2 },
      { collection, key: 'scope-b::1', type: 'set', value: 3 },
    ]);

    await expect(localDatabase.entriesByPrefix(collection, 'scope-a::')).resolves.toEqual([
      { key: 'scope-a::1', value: 1 },
      { key: 'scope-a::2', value: 2 },
    ]);

    await localDatabase.deleteByPrefix(collection, 'scope-a::');

    await expect(localDatabase.entriesByPrefix(collection, '')).resolves.toEqual([
      { key: 'scope-b::1', value: 3 },
    ]);
  });

  it('discovers populated collections with current entry counts', async () => {
    await localDatabase.batch([
      { collection, key: 'first', type: 'set', value: 1 },
      { collection, key: 'second', type: 'set', value: 2 },
      { collection: otherCollection, key: 'only', type: 'set', value: 3 },
    ]);

    const collections = await localDatabase.listCollections();

    expect(collections.filter(({ name }) => name.startsWith('database-test'))).toEqual([
      { entryCount: 2, name: collection },
      { entryCount: 1, name: otherCollection },
    ]);
  });

  it('commits mixed writes and deletes as one batch', async () => {
    await localDatabase.set(collection, 'legacy', { value: 'old' });
    await localDatabase.batch([
      { collection, key: 'replacement', type: 'set', value: { value: 'new' } },
      { collection, key: 'legacy', type: 'delete' },
    ]);

    await expect(localDatabase.get(collection, 'legacy')).resolves.toBeUndefined();
    await expect(localDatabase.get(collection, 'replacement')).resolves.toEqual({ value: 'new' });
  });

  it('routes database operations through a registered runtime adapter', async () => {
    const adapter: LocalDatabaseAdapter = {
      batch: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteByPrefix: vi.fn().mockResolvedValue(undefined),
      entriesByPrefix: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ source: 'electron' }),
      initialize: vi.fn().mockResolvedValue(undefined),
      listCollections: vi.fn().mockResolvedValue([{ entryCount: 1, name: 'runtime' }]),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const unregister = registerLocalDatabaseAdapter(adapter);

    try {
      await expect(localDatabase.get('runtime', 'key')).resolves.toEqual({ source: 'electron' });
      await expect(localDatabase.listCollections()).resolves.toEqual([
        { entryCount: 1, name: 'runtime' },
      ]);
      await localDatabase.set('runtime', 'key', { value: 1 });

      expect(adapter.get).toHaveBeenCalledWith('runtime', 'key');
      expect(adapter.listCollections).toHaveBeenCalledOnce();
      expect(adapter.set).toHaveBeenCalledWith('runtime', 'key', { value: 1 });
    } finally {
      unregister();
    }
  });
});
