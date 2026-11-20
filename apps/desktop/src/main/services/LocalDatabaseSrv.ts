import path from 'node:path';

import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseCollectionInfo,
  DesktopLocalDatabaseEntry,
  DesktopLocalDatabaseKeyGroup,
  DesktopLocalDatabaseKeyPage,
} from '@lobechat/electron-client-ipc';
import { and, asc, count, eq, gte, lt, sql } from 'drizzle-orm';

import { createLocalDatabaseRuntime, type LocalDatabaseRuntime } from '@/database/client';
import { localRecords } from '@/database/schema';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:LocalDatabaseSrv');
const DATABASE_FILENAME = 'local-database.sqlite3';
const PREFIX_UPPER_BOUND = '\u{10FFFF}';

const collectionPrefix = (collection: string) => `${collection.length}:${collection}`;
const storageKey = (collection: string, key: string) => `${collectionPrefix(collection)}${key}`;
const collectionFromStorageKey = (key: string): string | undefined => {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex < 1) return undefined;

  const collectionLength = Number(key.slice(0, separatorIndex));
  if (!Number.isSafeInteger(collectionLength) || collectionLength < 0) return undefined;

  const collectionStart = separatorIndex + 1;
  const collectionEnd = collectionStart + collectionLength;
  if (collectionEnd > key.length) return undefined;

  return key.slice(collectionStart, collectionEnd);
};
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

  async keyGroupsByPrefix(
    collection: string,
    prefix: string,
    delimiter: string,
  ): Promise<DesktopLocalDatabaseKeyGroup[]> {
    const { lowerBound, upperBound } = prefixRange(collection, prefix);
    const rows = await this.getRuntime()
      .db.select({ id: localRecords.id })
      .from(localRecords)
      .where(and(gte(localRecords.id, lowerBound), lt(localRecords.id, upperBound)));
    const counts = new Map<string, number>();

    for (const { id } of rows) {
      const delimiterIndex = id.indexOf(delimiter, lowerBound.length);
      if (delimiterIndex < 0) continue;

      const name = id.slice(lowerBound.length, delimiterIndex);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([name, entryCount]) => ({ entryCount, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async keysByPrefix(
    collection: string,
    prefix: string,
    { limit, search }: { limit?: number; search?: string } = {},
  ): Promise<DesktopLocalDatabaseKeyPage> {
    const { lowerBound, upperBound } = prefixRange(collection, prefix);
    const keyPrefix = collectionPrefix(collection);
    const term = search?.trim().toLowerCase();
    // SQLite substr() counts code points while String#length counts UTF-16 units.
    const keyStart = [...keyPrefix].length + 1;
    const where = and(
      gte(localRecords.id, lowerBound),
      lt(localRecords.id, upperBound),
      term ? sql`instr(lower(substr(${localRecords.id}, ${keyStart})), ${term}) > 0` : undefined,
    );
    const { db } = this.getRuntime();
    const [{ total }] = await db.select({ total: count() }).from(localRecords).where(where);
    const query = db
      .select({ id: localRecords.id })
      .from(localRecords)
      .where(where)
      .orderBy(asc(localRecords.id));
    const rows = await (limit === undefined ? query : query.limit(limit));

    return { keys: rows.map(({ id }) => id.slice(keyPrefix.length)), total };
  }

  async listCollections(): Promise<DesktopLocalDatabaseCollectionInfo[]> {
    const rows = await this.getRuntime().db.select({ id: localRecords.id }).from(localRecords);
    const counts = new Map<string, number>();

    for (const { id } of rows) {
      const collection = collectionFromStorageKey(id);
      if (collection === undefined) continue;
      counts.set(collection, (counts.get(collection) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([name, entryCount]) => ({ entryCount, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
