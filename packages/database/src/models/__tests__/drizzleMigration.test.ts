// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { DrizzleMigrationModel } from '../drizzleMigration';

const serverDB: LobeChatDatabase = await getTestDB();

const drizzleMigrationModel = new DrizzleMigrationModel(serverDB);

describe('DrizzleMigrationModel', () => {
  beforeEach(async () => {
    // Clean up database before each test if needed
  });

  describe('getTableCounts', () => {
    it('should return table count from information_schema', async () => {
      const count = await drizzleMigrationModel.getTableCounts();

      expect(count).toBeTypeOf('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should return integer value', async () => {
      const count = await drizzleMigrationModel.getTableCounts();

      expect(Number.isInteger(count)).toBe(true);
    });
  });

  describe('getMigrationList', () => {
    it('should return migration list', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      expect(Array.isArray(migrations)).toBe(true);
    });

    it('should return migration items with required fields', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      migrations.forEach((migration) => {
        expect(migration).toHaveProperty('hash');
        expect(migration).toHaveProperty('created_at');
        expect(typeof migration.hash).toBe('string');
      });
    });
  });

  describe('getLatestMigrationHash', () => {
    it('should return the hash of the latest migration', async () => {
      const hash = await drizzleMigrationModel.getLatestMigrationHash();
      const migrations = await drizzleMigrationModel.getMigrationList();

      if (migrations.length > 0) {
        expect(hash).toBe(migrations[0].hash);
        expect(typeof hash).toBe('string');
      }
    });

    it('should return the first item hash from migration list', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      if (migrations.length > 0) {
        const latestHash = await drizzleMigrationModel.getLatestMigrationHash();
        expect(latestHash).toBe(migrations[0].hash);
      }
    });
  });
});
