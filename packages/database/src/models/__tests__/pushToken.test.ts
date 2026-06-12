// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { pushTokens, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  deletePushTokenByExpoTokenAndDevice,
  deletePushTokensByExpoTokens,
  PushTokenModel,
} from '../pushToken';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'push-token-model-test-user-id';
const otherUserId = 'push-token-model-test-other-user';
const model = new PushTokenModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('PushTokenModel', () => {
  describe('upsert', () => {
    it('should insert a new token row', async () => {
      const result = await model.upsert({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
        platform: 'ios',
      });

      expect(result.id).toBeDefined();
      expect(result).toMatchObject({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
        platform: 'ios',
        userId,
      });
    });

    it('should update lastSeenAt and expoToken when re-registering same device', async () => {
      const first = await model.upsert({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[old]',
        platform: 'ios',
      });
      const firstSeen = first.lastSeenAt;

      // wait so timestamps clearly differ
      await new Promise((r) => setTimeout(r, 50));

      const updated = await model.upsert({
        appVersion: '1.2.3',
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[new]',
        platform: 'ios',
      });

      expect(updated.id).toBe(first.id); // same row, not a new one
      expect(updated.expoToken).toBe('ExponentPushToken[new]');
      expect(updated.appVersion).toBe('1.2.3');
      expect(updated.lastSeenAt.getTime()).toBeGreaterThan(firstSeen.getTime());

      const rows = await serverDB.select().from(pushTokens).where(eq(pushTokens.userId, userId));
      expect(rows).toHaveLength(1);
    });

    it('should support same user with multiple devices', async () => {
      await model.upsert({
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[ios]',
        platform: 'ios',
      });
      await model.upsert({
        deviceId: 'pixel',
        expoToken: 'ExponentPushToken[android]',
        platform: 'android',
      });

      const tokens = await model.listByUserId();
      expect(tokens).toHaveLength(2);
    });
  });

  describe('unregister', () => {
    it('should delete only the specified device', async () => {
      await model.upsert({ deviceId: 'a', expoToken: 't1', platform: 'ios' });
      await model.upsert({ deviceId: 'b', expoToken: 't2', platform: 'android' });

      await model.unregister('a');

      const tokens = await model.listByUserId();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].deviceId).toBe('b');
    });

    it('should not delete another user tokens', async () => {
      await model.upsert({ deviceId: 'shared-device', expoToken: 'mine', platform: 'ios' });

      const otherModel = new PushTokenModel(serverDB, otherUserId);
      await otherModel.upsert({
        deviceId: 'shared-device',
        expoToken: 'theirs',
        platform: 'ios',
      });

      await model.unregister('shared-device');

      const theirs = await otherModel.listByUserId();
      expect(theirs).toHaveLength(1);
      expect(theirs[0].expoToken).toBe('theirs');
    });
  });

  describe('listByUserId', () => {
    it('should return empty array when no tokens', async () => {
      const tokens = await model.listByUserId();
      expect(tokens).toEqual([]);
    });

    it('should only return current user tokens', async () => {
      await model.upsert({ deviceId: 'mine', expoToken: 'a', platform: 'ios' });
      const otherModel = new PushTokenModel(serverDB, otherUserId);
      await otherModel.upsert({ deviceId: 'theirs', expoToken: 'b', platform: 'ios' });

      const tokens = await model.listByUserId();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].userId).toBe(userId);
    });
  });

  describe('deletePushTokensByExpoTokens helper', () => {
    it('should noop on empty array', async () => {
      await model.upsert({ deviceId: 'a', expoToken: 'keep', platform: 'ios' });
      await deletePushTokensByExpoTokens(serverDB, []);
      const tokens = await model.listByUserId();
      expect(tokens).toHaveLength(1);
    });

    it('should delete cross-user by expoToken', async () => {
      await model.upsert({ deviceId: 'mine', expoToken: 'bad-token', platform: 'ios' });
      const otherModel = new PushTokenModel(serverDB, otherUserId);
      await otherModel.upsert({ deviceId: 'theirs', expoToken: 'bad-token', platform: 'ios' });
      await otherModel.upsert({ deviceId: 'good', expoToken: 'good-token', platform: 'ios' });

      await deletePushTokensByExpoTokens(serverDB, ['bad-token']);

      const mine = await model.listByUserId();
      const theirs = await otherModel.listByUserId();
      expect(mine).toHaveLength(0);
      expect(theirs).toHaveLength(1);
      expect(theirs[0].expoToken).toBe('good-token');
    });
  });

  describe('deletePushTokenByExpoTokenAndDevice helper', () => {
    it('should delete only the row matching both deviceId and expoToken', async () => {
      await model.upsert({ deviceId: 'a', expoToken: 'token-a', platform: 'ios' });
      await model.upsert({ deviceId: 'b', expoToken: 'token-b', platform: 'ios' });

      await deletePushTokenByExpoTokenAndDevice(serverDB, {
        deviceId: 'a',
        expoToken: 'token-a',
      });

      const remaining = await model.listByUserId();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].deviceId).toBe('b');
    });

    it('should not delete when only deviceId matches but expoToken differs', async () => {
      // Defensive: a malicious caller knowing only the deviceId must not be
      // able to unregister someone else's row.
      await model.upsert({ deviceId: 'a', expoToken: 'real-token', platform: 'ios' });

      await deletePushTokenByExpoTokenAndDevice(serverDB, {
        deviceId: 'a',
        expoToken: 'guessed-token',
      });

      const remaining = await model.listByUserId();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].expoToken).toBe('real-token');
    });

    it('should be a no-op when no row matches', async () => {
      await expect(
        deletePushTokenByExpoTokenAndDevice(serverDB, {
          deviceId: 'never',
          expoToken: 'never',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('cascade delete on user removal', () => {
    it('should delete tokens when user is deleted', async () => {
      await model.upsert({ deviceId: 'a', expoToken: 't', platform: 'ios' });
      await serverDB.delete(users).where(eq(users.id, userId));

      const remaining = await serverDB
        .select()
        .from(pushTokens)
        .where(eq(pushTokens.userId, userId));
      expect(remaining).toHaveLength(0);
    });
  });
});
