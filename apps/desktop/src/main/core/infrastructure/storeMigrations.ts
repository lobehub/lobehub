import type Store from 'electron-store';
import { gt, valid } from 'semver';

import { coerceStoredUpdateChannel } from '@/modules/updater/configs';
import type { ElectronMainStore } from '@/types/store';

export const STORE_SCHEMA_VERSION = '1.0.0';
export const STORE_SCHEMA_VERSION_KEY = '__internal__.storeSchemaVersion';

type StoreMigration = {
  up: (store: Store<ElectronMainStore>) => void;
  version: string;
};

export const storeMigrations: StoreMigration[] = [
  {
    up: (store) => {
      const storedChannel = store.get('updateChannel');
      const normalizedChannel = coerceStoredUpdateChannel(storedChannel);

      if (storedChannel && storedChannel !== normalizedChannel) {
        store.set('updateChannel', normalizedChannel);
      }
    },
    version: '1.0.0',
  },
];

type MigrationLogger = {
  info: (...args: any[]) => void;
};

const getStoreSchemaVersion = (store: Store<ElectronMainStore>) => {
  return store.get(STORE_SCHEMA_VERSION_KEY as keyof ElectronMainStore) as string | undefined;
};

const setStoreSchemaVersion = (store: Store<ElectronMainStore>, version: string) => {
  store.set(
    STORE_SCHEMA_VERSION_KEY as keyof ElectronMainStore,
    version as ElectronMainStore[keyof ElectronMainStore],
  );
};

export const runStoreMigrations = (store: Store<ElectronMainStore>, logger?: MigrationLogger) => {
  const currentVersion = getStoreSchemaVersion(store);
  const fromVersion = valid(currentVersion) ? currentVersion : '0.0.0';

  for (const migration of storeMigrations) {
    if (!gt(migration.version, fromVersion)) continue;

    logger?.info(`Running store migration: ${fromVersion} -> ${migration.version}`);
    migration.up(store);
    setStoreSchemaVersion(store, migration.version);
  }

  if (fromVersion !== STORE_SCHEMA_VERSION) {
    setStoreSchemaVersion(store, STORE_SCHEMA_VERSION);
  }
};
