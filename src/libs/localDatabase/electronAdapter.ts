import type { DesktopLocalDatabaseEntry } from '@lobechat/electron-client-ipc';
import superjson from 'superjson';

import { ensureElectronIpc } from '@/utils/electron/ipc';

import type { LocalDatabaseAdapter, LocalDatabaseBatchOperation } from './types';

const serializeBatchOperation = (operation: LocalDatabaseBatchOperation) => {
  if (operation.type === 'delete') return operation;

  return { ...operation, value: superjson.stringify(operation.value) };
};

export const createElectronLocalDatabaseAdapter = (): LocalDatabaseAdapter => ({
  batch: async (operations) => {
    await ensureElectronIpc().localDatabase.batch(operations.map(serializeBatchOperation));
  },
  delete: async (collection, key) => {
    await ensureElectronIpc().localDatabase.delete({ collection, key });
  },
  deleteByPrefix: async (collection, prefix) => {
    await ensureElectronIpc().localDatabase.deleteByPrefix({ collection, prefix });
  },
  entriesByPrefix: async <T>(collection: string, prefix: string) => {
    const entries = await ensureElectronIpc().localDatabase.entriesByPrefix({
      collection,
      prefix,
    });

    return entries.map(({ key, value }: DesktopLocalDatabaseEntry) => ({
      key,
      value: superjson.parse<T>(value),
    }));
  },
  get: async <T>(collection: string, key: string) => {
    const value = await ensureElectronIpc().localDatabase.get({ collection, key });
    return value === undefined ? undefined : superjson.parse<T>(value);
  },
  initialize: async () => {
    await ensureElectronIpc().localDatabase.initialize();
  },
  set: async (collection, key, value) => {
    await ensureElectronIpc().localDatabase.set({
      collection,
      key,
      value: superjson.stringify(value),
    });
  },
});
