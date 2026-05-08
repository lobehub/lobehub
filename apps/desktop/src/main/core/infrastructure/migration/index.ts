import type Store from 'electron-store';

import type { ElectronMainStore } from '@/types/store';
import { createLogger } from '@/utils/logger';

import normalizeUpdateChannelMigration from './001-normalize-update-channel';
import type { StoreMigration } from './defineMigration';

export const APPLIED_STORE_MIGRATIONS_KEY = 'lobeDesktopAppliedStoreMigrations';

const logger = createLogger('core:storeMigration');

const migrations: StoreMigration[] = [normalizeUpdateChannelMigration];

const getAppliedMigrationIds = (store: Store<ElectronMainStore>): string[] => {
  return (
    (store.get(APPLIED_STORE_MIGRATIONS_KEY as keyof ElectronMainStore) as string[] | undefined) ??
    []
  );
};

const setAppliedMigrationIds = (store: Store<ElectronMainStore>, ids: string[]) => {
  store.set(
    APPLIED_STORE_MIGRATIONS_KEY as keyof ElectronMainStore,
    ids as ElectronMainStore[keyof ElectronMainStore],
  );
};

export const getStoreMigrations = () => migrations;

export const runStoreMigrations = (store: Store<ElectronMainStore>) => {
  logger.info('Store migrations started');

  const appliedMigrationIds = new Set(getAppliedMigrationIds(store));
  let hasNewMigrationApplied = false;

  for (const migration of migrations) {
    if (appliedMigrationIds.has(migration.id)) continue;

    logger.info(`Running store migration: ${migration.id}`);
    migration.up(store);
    appliedMigrationIds.add(migration.id);
    hasNewMigrationApplied = true;
  }

  if (hasNewMigrationApplied) {
    setAppliedMigrationIds(store, [...appliedMigrationIds]);
  }

  logger.info(
    hasNewMigrationApplied
      ? 'Store migrations finished (updates applied)'
      : 'Store migrations finished (nothing pending)',
  );
};
