import { describe, expect, it, vi } from 'vitest';

import { runIndexedDBMigrations } from './indexedDBMigrations';

describe('runIndexedDBMigrations', () => {
  it('replaces the legacy Dexie store during the version 10 to 11 upgrade', () => {
    const database = {
      createObjectStore: vi.fn(),
      deleteObjectStore: vi.fn(),
      objectStoreNames: ['cache'],
    } as unknown as IDBDatabase;

    runIndexedDBMigrations(database, {} as IDBTransaction, 10, 11);

    expect(database.deleteObjectStore).toHaveBeenCalledWith('cache');
    expect(database.createObjectStore).toHaveBeenCalledWith('records', { keyPath: 'key' });
  });

  it('does not replay migrations that are already reflected by the database version', () => {
    const database = {
      createObjectStore: vi.fn(),
      deleteObjectStore: vi.fn(),
      objectStoreNames: ['records'],
    } as unknown as IDBDatabase;

    runIndexedDBMigrations(database, {} as IDBTransaction, 11, 11);

    expect(database.deleteObjectStore).not.toHaveBeenCalled();
    expect(database.createObjectStore).not.toHaveBeenCalled();
  });
});
