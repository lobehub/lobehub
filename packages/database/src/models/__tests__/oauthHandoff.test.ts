import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { oauthHandoffs } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OAuthHandoffModel } from '../oauthHandoff';

const serverDB: LobeChatDatabase = await getTestDB();
const oauthHandoffModel = new OAuthHandoffModel(serverDB);

describe('OAuthHandoffModel', () => {
  beforeEach(async () => {
    await serverDB.delete(oauthHandoffs);
  });

  afterEach(async () => {
    await serverDB.delete(oauthHandoffs);
    vi.useRealTimers();
  });

  describe('create', () => {
    it('should create a new OAuth handoff record', async () => {
      const result = await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'auth-code', state: 'state-value' },
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('handoff-1');
      expect(result.client).toBe('desktop');
      expect(result.payload).toEqual({ code: 'auth-code', state: 'state-value' });
    });

    it('should handle conflict by doing nothing', async () => {
      // Create first record
      await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'original-code' },
      });

      // Try to create duplicate - should not throw
      const result = await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'new-code' },
      });

      // Result is undefined when conflict occurs with onConflictDoNothing
      expect(result).toBeUndefined();

      // Original should remain unchanged
      const record = await serverDB.query.oauthHandoffs.findFirst({
        where: eq(oauthHandoffs.id, 'handoff-1'),
      });

      expect(record?.payload).toEqual({ code: 'original-code' });
    });
  });

  describe('fetchAndConsume', () => {
    it('should fetch and delete valid credentials', async () => {
      await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'auth-code', state: 'state-value' },
      });

      const result = await oauthHandoffModel.fetchAndConsume('handoff-1', 'desktop');

      expect(result).toBeDefined();
      expect(result?.id).toBe('handoff-1');
      expect(result?.payload).toEqual({ code: 'auth-code', state: 'state-value' });

      // Verify it was deleted
      const deleted = await serverDB.query.oauthHandoffs.findFirst({
        where: eq(oauthHandoffs.id, 'handoff-1'),
      });
      expect(deleted).toBeUndefined();
    });

    it('should return null for non-existent credentials', async () => {
      const result = await oauthHandoffModel.fetchAndConsume('non-existent', 'desktop');

      expect(result).toBeNull();
    });

    it('should return null when client type does not match', async () => {
      await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'auth-code' },
      });

      const result = await oauthHandoffModel.fetchAndConsume('handoff-1', 'browser-extension');

      expect(result).toBeNull();

      // Record should still exist
      const record = await serverDB.query.oauthHandoffs.findFirst({
        where: eq(oauthHandoffs.id, 'handoff-1'),
      });
      expect(record).toBeDefined();
    });

    it('should return null for expired credentials (older than 5 minutes)', async () => {
      // Create a record with old timestamp
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

      await serverDB.insert(oauthHandoffs).values({
        id: 'handoff-expired',
        client: 'desktop',
        payload: { code: 'auth-code' },
        createdAt: sixMinutesAgo,
        updatedAt: sixMinutesAgo,
      });

      const result = await oauthHandoffModel.fetchAndConsume('handoff-expired', 'desktop');

      expect(result).toBeNull();
    });

    it('should return valid credentials within 5 minutes', async () => {
      // Create a record with timestamp 4 minutes ago
      const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);

      await serverDB.insert(oauthHandoffs).values({
        id: 'handoff-valid',
        client: 'desktop',
        payload: { code: 'auth-code' },
        createdAt: fourMinutesAgo,
        updatedAt: fourMinutesAgo,
      });

      const result = await oauthHandoffModel.fetchAndConsume('handoff-valid', 'desktop');

      expect(result).toBeDefined();
      expect(result?.id).toBe('handoff-valid');
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired records', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const now = new Date();

      // Create expired record
      await serverDB.insert(oauthHandoffs).values({
        id: 'handoff-expired',
        client: 'desktop',
        payload: { code: 'expired-code' },
        createdAt: sixMinutesAgo,
        updatedAt: sixMinutesAgo,
      });

      // Create valid record
      await serverDB.insert(oauthHandoffs).values({
        id: 'handoff-valid',
        client: 'desktop',
        payload: { code: 'valid-code' },
        createdAt: now,
        updatedAt: now,
      });

      await oauthHandoffModel.cleanupExpired();

      // Verify expired record is deleted
      const expiredRecord = await serverDB.query.oauthHandoffs.findFirst({
        where: eq(oauthHandoffs.id, 'handoff-expired'),
      });
      expect(expiredRecord).toBeUndefined();

      // Verify valid record still exists
      const validRecord = await serverDB.query.oauthHandoffs.findFirst({
        where: eq(oauthHandoffs.id, 'handoff-valid'),
      });
      expect(validRecord).toBeDefined();
    });

    it('should not throw when no expired records exist', async () => {
      await expect(oauthHandoffModel.cleanupExpired()).resolves.not.toThrow();
    });

    it('should delete multiple expired records', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

      await serverDB.insert(oauthHandoffs).values([
        {
          id: 'handoff-expired-1',
          client: 'desktop',
          payload: { code: 'code-1' },
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
        },
        {
          id: 'handoff-expired-2',
          client: 'browser',
          payload: { code: 'code-2' },
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
        },
      ]);

      await oauthHandoffModel.cleanupExpired();

      // Verify all expired records are deleted
      const remainingRecords = await serverDB.query.oauthHandoffs.findMany();
      expect(remainingRecords).toHaveLength(0);
    });
  });

  describe('exists', () => {
    it('should return true for existing valid credentials', async () => {
      await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'auth-code' },
      });

      const result = await oauthHandoffModel.exists('handoff-1', 'desktop');

      expect(result).toBe(true);
    });

    it('should return false for non-existent credentials', async () => {
      const result = await oauthHandoffModel.exists('non-existent', 'desktop');

      expect(result).toBe(false);
    });

    it('should return false when client type does not match', async () => {
      await oauthHandoffModel.create({
        id: 'handoff-1',
        client: 'desktop',
        payload: { code: 'auth-code' },
      });

      const result = await oauthHandoffModel.exists('handoff-1', 'browser-extension');

      expect(result).toBe(false);
    });

    it('should return false for expired credentials', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

      await serverDB.insert(oauthHandoffs).values({
        id: 'handoff-expired',
        client: 'desktop',
        payload: { code: 'auth-code' },
        createdAt: sixMinutesAgo,
        updatedAt: sixMinutesAgo,
      });

      const result = await oauthHandoffModel.exists('handoff-expired', 'desktop');

      expect(result).toBe(false);
    });
  });
});
