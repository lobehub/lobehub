// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { pushLiveActivities, pushTokens, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  deletePushTokenByExpoTokenAndDevice,
  deletePushTokensByExpoTokens,
  PushLiveActivityModel,
  PushTokenModel,
} from '../pushToken';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'push-token-model-test-user-id';
const otherUserId = 'push-token-model-test-other-user';
const model = new PushTokenModel(serverDB, userId);
const liveActivityModel = new PushLiveActivityModel(serverDB, userId);

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

    it('persists the sandbox ActivityKit start token and updates it on registration', async () => {
      await model.upsert({
        apnsEnvironment: 'sandbox',
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[ios]',
        liveActivityPushToStartToken: 'start-token-1',
        platform: 'ios',
      });

      const updated = await model.upsert({
        apnsEnvironment: 'sandbox',
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[ios]',
        liveActivityPushToStartToken: 'start-token-2',
        platform: 'ios',
      });

      expect(updated).toMatchObject({
        apnsEnvironment: 'sandbox',
        liveActivityPushToStartToken: 'start-token-2',
      });
    });
  });

  describe('updateLiveActivityRegistration', () => {
    it('rotates ActivityKit registration only for an existing owned device', async () => {
      await model.upsert({
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[ios]',
        platform: 'ios',
      });

      const updated = await model.updateLiveActivityRegistration('iphone', {
        apnsEnvironment: 'production',
        liveActivityPushToStartToken: 'push-to-start-token',
      });

      expect(updated).toMatchObject({
        apnsEnvironment: 'production',
        deviceId: 'iphone',
        liveActivityPushToStartToken: 'push-to-start-token',
        userId,
      });
    });

    it('does not create a row or update another owner for an unknown device', async () => {
      const otherModel = new PushTokenModel(serverDB, otherUserId);
      await otherModel.upsert({
        deviceId: 'shared-device',
        expoToken: 'ExponentPushToken[other]',
        platform: 'ios',
      });

      await expect(
        model.updateLiveActivityRegistration('shared-device', {
          apnsEnvironment: 'sandbox',
          liveActivityPushToStartToken: 'must-not-leak',
        }),
      ).resolves.toBeUndefined();

      await expect(otherModel.listByUserId()).resolves.toEqual([
        expect.objectContaining({
          apnsEnvironment: null,
          liveActivityPushToStartToken: null,
        }),
      ]);
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

    it('atomically removes every Live Activity row for the matched owner and device', async () => {
      await model.upsert({ deviceId: 'target-device', expoToken: 'target-token', platform: 'ios' });
      await liveActivityModel.upsert({
        activityId: 'target-native-1',
        activityKey: 'target-activity-1',
        apnsEnvironment: 'sandbox',
        deviceId: 'target-device',
        operationId: 'target-operation',
        pushToken: 'target-live-token-1',
      });
      await liveActivityModel.upsert({
        activityId: 'target-native-2',
        activityKey: 'target-activity-2',
        apnsEnvironment: 'sandbox',
        deviceId: 'target-device',
        operationId: 'target-operation',
        pushToken: 'target-live-token-2',
      });
      await liveActivityModel.upsert({
        activityId: 'kept-native',
        activityKey: 'target-activity-1',
        apnsEnvironment: 'sandbox',
        deviceId: 'kept-device',
        operationId: 'target-operation',
        pushToken: 'kept-live-token',
      });
      const otherLiveActivityModel = new PushLiveActivityModel(serverDB, otherUserId);
      await otherLiveActivityModel.upsert({
        activityId: 'other-native',
        activityKey: 'target-activity-1',
        apnsEnvironment: 'production',
        deviceId: 'target-device',
        operationId: 'other-operation',
        pushToken: 'other-live-token',
      });

      await deletePushTokenByExpoTokenAndDevice(serverDB, {
        deviceId: 'target-device',
        expoToken: 'target-token',
      });

      await expect(model.listByUserId()).resolves.toEqual([]);
      await expect(liveActivityModel.listByActivityKey('target-activity-1')).resolves.toEqual([
        expect.objectContaining({ deviceId: 'kept-device' }),
      ]);
      await expect(liveActivityModel.listByActivityKey('target-activity-2')).resolves.toEqual([]);
      await expect(
        otherLiveActivityModel.listByActivityKey('target-activity-1'),
      ).resolves.toHaveLength(1);
    });

    it('should not delete when only deviceId matches but expoToken differs', async () => {
      // Defensive: a malicious caller knowing only the deviceId must not be
      // able to unregister someone else's row.
      await model.upsert({ deviceId: 'a', expoToken: 'real-token', platform: 'ios' });
      await liveActivityModel.upsert({
        activityId: 'native-a',
        activityKey: 'activity-a',
        apnsEnvironment: 'sandbox',
        deviceId: 'a',
        operationId: 'operation-a',
        pushToken: 'live-token-a',
      });

      await deletePushTokenByExpoTokenAndDevice(serverDB, {
        deviceId: 'a',
        expoToken: 'guessed-token',
      });

      const remaining = await model.listByUserId();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].expoToken).toBe('real-token');
      await expect(liveActivityModel.listByActivityKey('activity-a')).resolves.toHaveLength(1);
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

describe('PushLiveActivityModel', () => {
  const register = (overrides: Partial<Parameters<typeof liveActivityModel.upsert>[0]> = {}) =>
    liveActivityModel.upsert({
      activityId: 'native-activity-1',
      activityKey: 'intervention-1',
      apnsEnvironment: 'sandbox',
      deviceId: 'iphone',
      operationId: 'shared-operation',
      pushToken: 'activity-update-token-1',
      ...overrides,
    });

  it('keeps separate callbacks from the same operation by opaque activity key', async () => {
    await register();
    await register({
      activityId: 'native-activity-2',
      activityKey: 'intervention-2',
      pushToken: 'activity-update-token-2',
    });

    const first = await liveActivityModel.listByActivityKey('intervention-1');
    const second = await liveActivityModel.listByActivityKey('intervention-2');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      activityKey: 'intervention-1',
      operationId: 'shared-operation',
    });
    expect(second).toHaveLength(1);
  });

  it('upserts one device/activity key without overwriting another callback', async () => {
    const first = await register();
    const refreshed = await register({
      activityId: 'native-activity-refreshed',
      pushToken: 'activity-update-token-refreshed',
    });

    expect(refreshed.id).toBe(first.id);
    expect(refreshed).toMatchObject({
      activityId: 'native-activity-refreshed',
      pushToken: 'activity-update-token-refreshed',
    });
    const rows = await serverDB
      .select()
      .from(pushLiveActivities)
      .where(eq(pushLiveActivities.activityKey, 'intervention-1'));
    expect(rows).toHaveLength(1);
  });

  it('lists and unregisters only the requested activity key', async () => {
    await register();
    await register({
      activityId: 'native-activity-2',
      activityKey: 'intervention-2',
      pushToken: 'activity-update-token-2',
    });

    await liveActivityModel.unregister('intervention-1');

    await expect(liveActivityModel.listByActivityKey('intervention-1')).resolves.toEqual([]);
    await expect(liveActivityModel.listByActivityKey('intervention-2')).resolves.toHaveLength(1);
  });

  it('conditionally unregisters only the exact stale push token after a rotation', async () => {
    await register();
    await register({ pushToken: 'activity-update-token-rotated' });

    await liveActivityModel.unregisterIfPushToken(
      'intervention-1',
      'iphone',
      'activity-update-token-1',
    );
    await expect(liveActivityModel.listByActivityKey('intervention-1')).resolves.toEqual([
      expect.objectContaining({ pushToken: 'activity-update-token-rotated' }),
    ]);

    await liveActivityModel.unregisterIfPushToken(
      'intervention-1',
      'iphone',
      'activity-update-token-rotated',
    );
    await expect(liveActivityModel.listByActivityKey('intervention-1')).resolves.toEqual([]);
  });

  it('unregisters every activity for one owned device without touching siblings or another owner', async () => {
    await register();
    await register({
      activityId: 'native-activity-2',
      activityKey: 'intervention-2',
      pushToken: 'activity-update-token-2',
    });
    await register({
      activityId: 'native-activity-other-device',
      deviceId: 'ipad',
      pushToken: 'activity-update-token-other-device',
    });
    const otherModel = new PushLiveActivityModel(serverDB, otherUserId);
    await otherModel.upsert({
      activityId: 'other-native-activity',
      activityKey: 'intervention-1',
      apnsEnvironment: 'production',
      deviceId: 'iphone',
      operationId: 'other-operation',
      pushToken: 'other-update-token',
    });

    await liveActivityModel.unregisterDevice('iphone');

    await expect(liveActivityModel.listByActivityKey('intervention-1')).resolves.toEqual([
      expect.objectContaining({ deviceId: 'ipad' }),
    ]);
    await expect(liveActivityModel.listByActivityKey('intervention-2')).resolves.toEqual([]);
    await expect(otherModel.listByActivityKey('intervention-1')).resolves.toHaveLength(1);
  });

  it('does not expose another user activity registration with the same key', async () => {
    await register();
    const otherModel = new PushLiveActivityModel(serverDB, otherUserId);
    await otherModel.upsert({
      activityId: 'other-native-activity',
      activityKey: 'intervention-1',
      apnsEnvironment: 'production',
      deviceId: 'other-iphone',
      operationId: 'other-operation',
      pushToken: 'other-update-token',
    });

    await expect(liveActivityModel.listByActivityKey('intervention-1')).resolves.toHaveLength(1);
    await liveActivityModel.unregister('intervention-1');
    await expect(otherModel.listByActivityKey('intervention-1')).resolves.toHaveLength(1);
  });
});
