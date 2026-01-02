import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { sql } from 'drizzle-orm';
import { PgliteDatabase, drizzle } from 'drizzle-orm/pglite';
import { Md5 } from 'ts-md5';

import migrations from '../core/migrations.json';
import { DrizzleMigrationModel } from '../models/drizzleMigration';
import * as schema from '../schemas';

const pgliteSchemaHashCache = 'LOBE_CHAT_PGLITE_SCHEMA_HASH';
const DB_NAME = 'lobechat';

type DrizzleInstance = PgliteDatabase<typeof schema>;

class DatabaseManager {
  private static instance: DatabaseManager;
  private dbInstance: DrizzleInstance | null = null;
  private initPromise: Promise<DrizzleInstance> | null = null;
  private isLocalDBSchemaSynced = false;

  private constructor() {}

  static getInstance() {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private async migrate(): Promise<DrizzleInstance> {
    if (this.isLocalDBSchemaSynced) return this.db;

    let hash: string | undefined;
    if (typeof localStorage !== 'undefined') {
      const cacheHash = localStorage.getItem(pgliteSchemaHashCache);
      hash = Md5.hashStr(JSON.stringify(migrations));
      // if hash is the same, no need to migrate
      if (hash === cacheHash) {
        try {
          const drizzleMigration = new DrizzleMigrationModel(this.db as any);

          // Check if tables exist in database
          const tableCount = await drizzleMigration.getTableCounts();

          // If table count > 0, consider database properly initialized
          if (tableCount > 0) {
            this.isLocalDBSchemaSynced = true;
            return this.db;
          }
        } catch (error) {
          console.warn('Error checking table existence, proceeding with migration', error);
        }
      }
    }

    const start = Date.now();
    try {
      // @ts-expect-error - migrate internal API
      await this.db.dialect.migrate(migrations, this.db.session, {});

      if (typeof localStorage !== 'undefined' && hash) {
        localStorage.setItem(pgliteSchemaHashCache, hash);
      }

      this.isLocalDBSchemaSynced = true;
      console.info(`🗂 Migration success, take ${Date.now() - start}ms`);
    } catch (cause) {
      console.error('❌ Local database schema migration failed', cause);
      throw cause;
    }

    return this.db;
  }

  async initialize(): Promise<DrizzleInstance> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.dbInstance) return this.dbInstance;

      const time = Date.now();

      // 直接使用 pglite，自动处理 wasm 加载
      const pglite = new PGlite(`idb://${DB_NAME}`, {
        extensions: { vector },
        relaxedDurability: true,
      });

      this.dbInstance = drizzle({ client: pglite, schema });

      await this.migrate();

      console.log(`✅ Database initialized in ${Date.now() - time}ms`);

      return this.dbInstance;
    })();

    return this.initPromise;
  }

  get db(): DrizzleInstance {
    if (!this.dbInstance) {
      throw new Error('Database not initialized. Please call initialize() first.');
    }
    return this.dbInstance;
  }

  createProxy(): DrizzleInstance {
    return new Proxy({} as DrizzleInstance, {
      get: (target, prop) => {
        return this.db[prop as keyof DrizzleInstance];
      },
    });
  }

  async resetDatabase(): Promise<void> {
    // 1. Close existing PGlite connection
    if (this.dbInstance) {
      try {
        // @ts-ignore
        await (this.dbInstance.session as any).client.close();
        console.log('PGlite instance closed successfully.');
      } catch (e) {
        console.error('Error closing PGlite instance:', e);
      }
    }

    // 2. Reset database instance and initialization state
    this.dbInstance = null;
    this.initPromise = null;
    this.isLocalDBSchemaSynced = false;

    // 3. Delete IndexedDB database
    return new Promise<void>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        console.warn('IndexedDB is not available, cannot delete database');
        resolve();
        return;
      }

      const dbName = `/pglite/${DB_NAME}`;
      const request = indexedDB.deleteDatabase(dbName);

      request.onsuccess = () => {
        console.log(`✅ Database '${dbName}' reset successfully`);

        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(pgliteSchemaHashCache);
        }

        resolve();
      };

      // eslint-disable-next-line unicorn/prefer-add-event-listener
      request.onerror = (event) => {
        const error = (event.target as IDBOpenDBRequest)?.error;
        console.error(`❌ Error resetting database '${dbName}':`, error);
        reject(
          new Error(
            `Failed to reset database '${dbName}'. Error: ${error?.message || 'Unknown error'}`,
          ),
        );
      };

      request.onblocked = (event) => {
        console.warn(`Deletion of database '${dbName}' is blocked.`, event);
        reject(
          new Error(
            `Failed to reset database '${dbName}' because it is blocked by other open connections.`,
          ),
        );
      };
    });
  }
}

// Export singleton
const dbManager = DatabaseManager.getInstance();

export const clientDB = dbManager.createProxy();

export const initializeDB = () => dbManager.initialize();

export const resetClientDatabase = async () => {
  await dbManager.resetDatabase();
};

export const updateMigrationRecord = async (migrationHash: string) => {
  await clientDB.execute(
    sql`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (${migrationHash}, ${Date.now()});`,
  );

  await initializeDB();
};
