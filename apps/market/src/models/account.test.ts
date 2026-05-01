import { eq } from 'drizzle-orm';
import type * as DrizzleMigrator from 'drizzle-orm/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketAccounts } from '../../../../packages/database/src/schemas/market';
import type { MarketDatabase } from '../types';
import { MarketAccountModel } from './account';

interface DatabaseTestUtils {
  getTestDB: () => Promise<MarketDatabase>;
}

vi.mock('@/config/db', () => ({
  serverDBEnv: {},
}));

// PGlite rejects a prepared statement containing multiple migration commands; split those Drizzle statements in tests only.
vi.mock('drizzle-orm/migrator', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleMigrator>();

  return {
    ...actual,
    readMigrationFiles: (config: Parameters<typeof actual.readMigrationFiles>[0]) =>
      actual.readMigrationFiles(config).map((migration) => ({
        ...migration,
        sql: migration.sql.flatMap((statement) => {
          if (
            !statement.includes('DROP CONSTRAINT IF EXISTS') ||
            !statement.includes('ADD CONSTRAINT')
          ) {
            return statement;
          }

          return statement
            .split(/;\s*\n/)
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => `${part};`);
        }),
      })),
  };
});

const loadDatabaseTestUtils = async (): Promise<DatabaseTestUtils> =>
  await import('@lobechat/database/test-utils' as string);

const { getTestDB } = await loadDatabaseTestUtils();

describe('MarketAccountModel', async () => {
  const db: MarketDatabase = await getTestDB();
  const model = new MarketAccountModel(db);

  beforeEach(async () => {
    await db.delete(marketAccounts);
  });

  describe('upsertFromTrustedPayload', () => {
    it('creates an account from a trusted payload and updates the same account for the same user', async () => {
      const created = await model.upsertFromTrustedPayload({
        clientId: 'trusted-client',
        email: 'Ada.Lovelace+Market@example.com',
        name: 'Ada Lovelace',
        nonce: 'nonce-1',
        timestamp: Date.now(),
        userId: 'lobe-user-1',
      });

      expect(created).toMatchObject({
        displayName: 'Ada Lovelace',
        email: 'Ada.Lovelace+Market@example.com',
        lobeUserId: 'lobe-user-1',
        namespace: 'ada-lovelace-market',
        userName: 'ada-lovelace-market',
      });

      const updated = await model.upsertFromTrustedPayload({
        clientId: 'trusted-client',
        email: 'ada.updated@example.com',
        name: 'Ada Updated',
        nonce: 'nonce-2',
        timestamp: Date.now(),
        userId: 'lobe-user-1',
      });

      expect(updated).toMatchObject({
        id: created.id,
        displayName: 'Ada Updated',
        email: 'ada.updated@example.com',
        lobeUserId: 'lobe-user-1',
        namespace: 'ada-lovelace-market',
        userName: 'ada-lovelace-market',
      });
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

      const rows = await db
        .select()
        .from(marketAccounts)
        .where(eq(marketAccounts.lobeUserId, 'lobe-user-1'));

      expect(rows).toHaveLength(1);
    });

    it('creates distinct namespace and userName values for different users with the same email local-part', async () => {
      const first = await model.upsertFromTrustedPayload({
        clientId: 'trusted-client',
        email: 'ada@example.com',
        name: 'Ada Example',
        nonce: 'nonce-1',
        timestamp: Date.now(),
        userId: 'lobe-user-1',
      });
      const second = await model.upsertFromTrustedPayload({
        clientId: 'trusted-client',
        email: 'ada@company.com',
        name: 'Ada Company',
        nonce: 'nonce-2',
        timestamp: Date.now(),
        userId: 'lobe-user-2',
      });

      expect(first).toMatchObject({
        namespace: 'ada',
        userName: 'ada',
      });
      expect(second.namespace).not.toBe(first.namespace);
      expect(second.userName).not.toBe(first.userName);
      expect(second).toMatchObject({
        namespace: 'ada-lobe-user-2',
        userName: 'ada-lobe-user-2',
      });
    });

    it('atomically returns one account row for concurrent first-time upserts of the same user', async () => {
      const [first, second] = await Promise.all([
        model.upsertFromTrustedPayload({
          clientId: 'trusted-client',
          email: 'grace@example.com',
          name: 'Grace First',
          nonce: 'nonce-1',
          timestamp: Date.now(),
          userId: 'lobe-user-1',
        }),
        model.upsertFromTrustedPayload({
          clientId: 'trusted-client',
          email: 'grace@company.com',
          name: 'Grace Second',
          nonce: 'nonce-2',
          timestamp: Date.now(),
          userId: 'lobe-user-1',
        }),
      ]);

      expect(second.id).toBe(first.id);

      const rows = await db
        .select()
        .from(marketAccounts)
        .where(eq(marketAccounts.lobeUserId, 'lobe-user-1'));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        namespace: 'grace',
        userName: 'grace',
      });
      expect(['Grace First', 'Grace Second']).toContain(rows[0].displayName);
      expect(['grace@example.com', 'grace@company.com']).toContain(rows[0].email);
    });

    it('retries namespace collisions for concurrent first-time upserts of different users', async () => {
      const [first, second] = await Promise.all([
        model.upsertFromTrustedPayload({
          clientId: 'trusted-client',
          email: 'alan@example.com',
          name: 'Alan Example',
          nonce: 'nonce-1',
          timestamp: Date.now(),
          userId: 'lobe-user-1',
        }),
        model.upsertFromTrustedPayload({
          clientId: 'trusted-client',
          email: 'alan@company.com',
          name: 'Alan Company',
          nonce: 'nonce-2',
          timestamp: Date.now(),
          userId: 'lobe-user-2',
        }),
      ]);

      expect(first.id).not.toBe(second.id);
      expect(first.namespace).not.toBe(second.namespace);
      expect(first.userName).not.toBe(second.userName);

      const rows = await db.select().from(marketAccounts);

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.namespace).sort()).toEqual(['alan', 'alan-lobe-user-2']);
      expect(rows.map((row) => row.userName).sort()).toEqual(['alan', 'alan-lobe-user-2']);
    });
  });
});
