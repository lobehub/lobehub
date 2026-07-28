import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseEntry,
} from '@lobechat/electron-client-ipc';
import { app as electronApp } from 'electron';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:LocalDatabaseSrv');
const DATABASE_FILENAME = 'local-database.sqlite3';
const PREFIX_UPPER_BOUND = '\u{10FFFF}';

interface DatabaseStatements {
  delete: StatementSync;
  deleteByPrefix: StatementSync;
  entriesByPrefix: StatementSync;
  get: StatementSync;
  set: StatementSync;
}

interface SerializedDatabaseRow {
  key: string;
  value: string;
}

export default class LocalDatabaseService extends ServiceModule {
  private database: DatabaseSync | null = null;
  private statements: DatabaseStatements | null = null;

  constructor(app: App) {
    super(app);
    electronApp.once('before-quit', this.destroy);
  }

  initialize(): void {
    if (this.database) return;

    const databasePath = path.join(this.app.appStoragePath, DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);

    try {
      database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS local_records (
          collection TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (collection, key)
        ) WITHOUT ROWID;
      `);

      this.statements = {
        delete: database.prepare('DELETE FROM local_records WHERE collection = ? AND key = ?'),
        deleteByPrefix: database.prepare(`
          DELETE FROM local_records
          WHERE collection = ? AND key >= ? AND key < ?
        `),
        entriesByPrefix: database.prepare(`
          SELECT key, value FROM local_records
          WHERE collection = ? AND key >= ? AND key < ?
          ORDER BY key
        `),
        get: database.prepare(
          'SELECT key, value FROM local_records WHERE collection = ? AND key = ?',
        ),
        set: database.prepare(`
          INSERT INTO local_records (collection, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT (collection, key) DO UPDATE SET value = excluded.value
        `),
      };
      this.database = database;
      logger.info('Local database initialized');
    } catch (error) {
      database.close();
      throw error;
    }
  }

  batch(operations: DesktopLocalDatabaseBatchOperation[]): void {
    if (operations.length === 0) return;

    const { database, statements } = this.getRuntime();
    database.exec('BEGIN IMMEDIATE');

    try {
      for (const operation of operations) {
        if (operation.type === 'delete') {
          statements.delete.run(operation.collection, operation.key);
        } else {
          statements.set.run(operation.collection, operation.key, operation.value);
        }
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  delete(collection: string, key: string): void {
    this.getRuntime().statements.delete.run(collection, key);
  }

  deleteByPrefix(collection: string, prefix: string): void {
    const upperBound = `${prefix}${PREFIX_UPPER_BOUND}`;
    this.getRuntime().statements.deleteByPrefix.run(collection, prefix, upperBound);
  }

  entriesByPrefix(collection: string, prefix: string): DesktopLocalDatabaseEntry[] {
    const upperBound = `${prefix}${PREFIX_UPPER_BOUND}`;
    return this.getRuntime().statements.entriesByPrefix.all(
      collection,
      prefix,
      upperBound,
    ) as unknown as DesktopLocalDatabaseEntry[];
  }

  get(collection: string, key: string): SerializedDatabaseRow | undefined {
    return this.getRuntime().statements.get.get(collection, key) as unknown as
      SerializedDatabaseRow | undefined;
  }

  set(collection: string, key: string, value: string): void {
    this.getRuntime().statements.set.run(collection, key, value);
  }

  destroy = (): void => {
    this.statements = null;
    this.database?.close();
    this.database = null;
  };

  private getRuntime(): { database: DatabaseSync; statements: DatabaseStatements } {
    this.initialize();

    return {
      database: this.database!,
      statements: this.statements!,
    };
  }
}
