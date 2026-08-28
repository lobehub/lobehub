import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseKey,
  DesktopLocalDatabasePrefix,
  DesktopLocalDatabaseSet,
} from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createElectronLocalDatabaseAdapter } from './electronAdapter';

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  delete: vi.fn(),
  deleteByPrefix: vi.fn(),
  entriesByPrefix: vi.fn(),
  get: vi.fn(),
  initialize: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ localDatabase: mocks }),
}));

describe('createElectronLocalDatabaseAdapter', () => {
  const records = new Map<string, string>();
  const recordKey = (collection: string, key: string) => `${collection}\u0000${key}`;

  beforeEach(() => {
    records.clear();
    vi.clearAllMocks();

    mocks.initialize.mockResolvedValue(undefined);
    mocks.get.mockImplementation(async ({ collection, key }: DesktopLocalDatabaseKey) =>
      records.get(recordKey(collection, key)),
    );
    mocks.set.mockImplementation(async ({ collection, key, value }: DesktopLocalDatabaseSet) => {
      records.set(recordKey(collection, key), value);
    });
    mocks.delete.mockImplementation(async ({ collection, key }: DesktopLocalDatabaseKey) => {
      records.delete(recordKey(collection, key));
    });
    mocks.deleteByPrefix.mockImplementation(
      async ({ collection, prefix }: DesktopLocalDatabasePrefix) => {
        const storagePrefix = recordKey(collection, prefix);
        for (const key of records.keys()) if (key.startsWith(storagePrefix)) records.delete(key);
      },
    );
    mocks.entriesByPrefix.mockImplementation(
      async ({ collection, prefix }: DesktopLocalDatabasePrefix) => {
        const collectionPrefix = recordKey(collection, '');
        const storagePrefix = recordKey(collection, prefix);
        return [...records.entries()]
          .filter(([key]) => key.startsWith(storagePrefix))
          .map(([key, value]) => ({ key: key.slice(collectionPrefix.length), value }));
      },
    );
    mocks.batch.mockImplementation(async (operations: DesktopLocalDatabaseBatchOperation[]) => {
      for (const operation of operations) {
        const key = recordKey(operation.collection, operation.key);
        if (operation.type === 'delete') records.delete(key);
        else records.set(key, operation.value);
      }
    });
  });

  it('preserves structured values across the serialized IPC boundary', async () => {
    const adapter = createElectronLocalDatabaseAdapter();
    const value = {
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      optional: undefined,
    };

    await adapter.initialize();
    await adapter.set('cache', 'item', value);

    await expect(adapter.get('cache', 'item')).resolves.toEqual(value);
  });

  it('supports prefix queries and atomic batch payloads through IPC', async () => {
    const adapter = createElectronLocalDatabaseAdapter();

    await adapter.batch([
      { collection: 'cache', key: 'scope::1', type: 'set', value: { id: 1 } },
      { collection: 'cache', key: 'scope::2', type: 'set', value: { id: 2 } },
      { collection: 'cache', key: 'other::1', type: 'set', value: { id: 3 } },
    ]);

    await expect(adapter.entriesByPrefix('cache', 'scope::')).resolves.toEqual([
      { key: 'scope::1', value: { id: 1 } },
      { key: 'scope::2', value: { id: 2 } },
    ]);
  });
});
