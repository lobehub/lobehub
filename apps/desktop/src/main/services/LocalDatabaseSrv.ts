import path from 'node:path';

import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseEntry,
} from '@lobechat/electron-client-ipc';
import { and, asc, eq, gte, lt } from 'drizzle-orm';

import { createLocalDatabaseRuntime, type LocalDatabaseRuntime } from '@/database/client';
import { localRecords } from '@/database/schema';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:LocalDatabaseSrv');
const DATABASE_FILENAME = 'local-database.sqlite3';
const PREFIX_UPPER_BOUND = '\u{10FFFF}';

const collectionPrefix = (collection: string) => `${collection.length}:${collection}`;
const storageKey = (collection: string, key: string) => `${collectionPrefix(collection)}${key}`;
const prefixRange = (collection: string, prefix: string) => {
  const lowerBound = storageKey(collection, prefix);
  return { lowerBound, upperBound: `${lowerBound}${PREFIX_UPPER_BOUND}` };
};

export default class LocalDatabaseService extends ServiceModule {
  private runtime: LocalDatabaseRuntime | null = null;

  initialize(): void {
    if (this.runtime) return;

    const databasePath = path.join(this.app.appStoragePath, DATABASE_FILENAME);
    this.runtime = createLocalDatabaseRuntime(databasePath);
    logger.info('Local database initialized');
  }

  async batch(operations: DesktopLocalDatabaseBatchOperation[]): Promise<void> {
    if (operations.length === 0) return;

    await this.getRuntime().db.transaction(async (tx) => {
      for (const operation of operations) {
        const id = storageKey(operation.collection, operation.key);

        if (operation.type === 'delete') {
          await tx.delete(localRecords).where(eq(localRecords.id, id)).run();
        } else {
          await tx
            .insert(localRecords)
            .values({ id, value: operation.value })
            .onConflictDoUpdate({ set: { value: operation.value }, target: localRecords.id })
            .run();
        }
      }
    });
  }

  async delete(collection: string, key: string): Promise<void> {
    await this.getRuntime()
      .db.delete(localRecords)
      .where(eq(localRecords.id, storageKey(collection, key)))
      .run();
  }

  async deleteByPrefix(collection: string, prefix: string): Promise<void> {
    const { lowerBound, upperBound } = prefixRange(collection, prefix);
    await this.getRuntime()
      .db.delete(localRecords)
      .where(and(gte(localRecords.id, lowerBound), lt(localRecords.id, upperBound)))
      .run();
  }

  async entriesByPrefix(collection: string, prefix: string): Promise<DesktopLocalDatabaseEntry[]> {
    const { lowerBound, upperBound } = prefixRange(collection, prefix);
    const rows = await this.getRuntime()
      .db.select({ id: localRecords.id, value: localRecords.value })
      .from(localRecords)
      .where(and(gte(localRecords.id, lowerBound), lt(localRecords.id, upperBound)))
      .orderBy(asc(localRecords.id));
    const keyOffset = collectionPrefix(collection).length;

    return rows.map(({ id, value }) => ({ key: id.slice(keyOffset), value }));
  }

  async get(collection: string, key: string): Promise<string | undefined> {
    const [row] = await this.getRuntime()
      .db.select({ value: localRecords.value })
      .from(localRecords)
      .where(eq(localRecords.id, storageKey(collection, key)))
      .limit(1);
    return row?.value;
  }

  async set(collection: string, key: string, value: string): Promise<void> {
    await this.getRuntime()
      .db.insert(localRecords)
      .values({ id: storageKey(collection, key), value })
      .onConflictDoUpdate({ set: { value }, target: localRecords.id })
      .run();
  }

  destroy = (): void => {
    this.runtime?.database.close();
    this.runtime = null;
  };

  private getRuntime(): LocalDatabaseRuntime {
    this.initialize();
    return this.runtime!;
  }
}
