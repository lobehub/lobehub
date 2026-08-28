import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import { runLocalDatabaseMigrations } from './migrations/runner';
import { localDatabaseSchema } from './schema';

const configureDatabase = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);
};

const createDrizzleDatabase = (database: DatabaseSync) =>
  drizzle(
    async (query, params, method) => {
      const statement = database.prepare(query);

      switch (method) {
        case 'all': {
          statement.setReturnArrays(true);
          return { rows: statement.all(...params) as never[] };
        }

        case 'get': {
          statement.setReturnArrays(true);
          return { rows: statement.get(...params) as never };
        }

        case 'run': {
          statement.run(...params);
          return { rows: [] };
        }

        case 'values': {
          statement.setReturnArrays(true);
          return { rows: statement.all(...params) as never[] };
        }
      }
    },
    { schema: localDatabaseSchema },
  );

export type LocalDrizzleDatabase = ReturnType<typeof createDrizzleDatabase>;

export interface LocalDatabaseRuntime {
  database: DatabaseSync;
  db: LocalDrizzleDatabase;
}

export const createLocalDatabaseRuntime = (databasePath: string): LocalDatabaseRuntime => {
  const database = new DatabaseSync(databasePath);

  try {
    configureDatabase(database);
    runLocalDatabaseMigrations(database);
    return { database, db: createDrizzleDatabase(database) };
  } catch (error) {
    database.close();
    throw error;
  }
};
