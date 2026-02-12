import type { UserPreference } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { nextauthAccounts, users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { ListUsersForMemoryExtractorCursor } from '../user';
import { UserModel, UserNotFoundError } from '../user';

const userId = 'user-model-test';
const otherUserId = 'other-user-test';

const serverDB: LobeChatDatabase = await getTestDB();
const userModel = new UserModel(serverDB, userId);

// Mock decryptor function
const mockDecryptor = vi.fn().mockResolvedValue({});

describe('UserModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([
      { id: userId, email: 'test@example.com', fullName: 'Test User' },
      { id: otherUserId, email: 'other@example.com' },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
    vi.clearAllMocks();
  });

  describe('getUserRegistrationDuration', () => {
    it('should return registration duration for existing user', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await serverDB.update(users).set({ createdAt: thirtyDaysAgo }).where(eq(users.id, userId));

      const result = await userModel.getUserRegistrationDuration();

      expect(result.duration).toBeGreaterThanOrEqual(30);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should return default duration for non-existent user', async () => {
      const nonExistentUserModel = new UserModel(serverDB, 'non-existent');

      const result = await nonExistentUserModel.getUserRegistrationDuration();

      expect(result.duration).toBe(1);
    });
  });

  describe('getUserState', () => {
    it('should return user state with settings', async () => {
      // Create user settings
      await serverDB.insert(userSettings).values({
        id: userId,
        general: { fontSize: 14 },
        tts: { voice: 'default' },
      });

      const result = await userModel.getUserState(mockDecryptor);

      expect(result.userId).toBe(userId);
      expect(result.email).toBe('test@example.com');
      expect(result.fullName).toBe('Test User');
      expect(result.settings.general).toEqual({ fontSize: 14 });
      expect(result.settings.tts).toEqual({ voice: 'default' });
    });

    it('should throw UserNotFoundError for non-existent user', async () => {
      const nonExistentUserModel = new UserModel(serverDB, 'non-existent');

      await expect(nonExistentUserModel.getUserState(mockDecryptor)).rejects.toThrow(
        UserNotFoundError,
      );
    });

    it('should handle decryptor errors gracefully', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        keyVaults: 'encrypted-data',
      });

      const failingDecryptor = vi.fn().mockRejectedValue(new Error('Decryption failed'));

      const result = await userModel.getUserState(failingDecryptor);

      expect(result.settings.keyVaults).toEqual({});
    });
  });

  describe('getUserSSOProviders', () => {
    it('should return SSO providers for user', async () => {
      await serverDB.insert(nextauthAccounts).values({
        userId,
        provider: 'google',
        providerAccountId: 'google-123',
        type: 'oauth' as any,
      });

      const result = await userModel.getUserSSOProviders();

      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe('google');
      expect(result[0].providerAccountId).toBe('google-123');
    });

    it('should return empty array when no SSO providers', async () => {
      const result = await userModel.getUserSSOProviders();

      expect(result).toHaveLength(0);
    });
  });

  describe('getUserSettings', () => {
    it('should return user settings', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        general: { fontSize: 14 },
      });

      const result = await userModel.getUserSettings();

      expect(result).toBeDefined();
      expect(result?.general).toEqual({ fontSize: 14 });
    });

    it('should return undefined when no settings exist', async () => {
      const result = await userModel.getUserSettings();

      expect(result).toBeUndefined();
    });
  });

  describe('updateUser', () => {
    it('should update user properties', async () => {
      await userModel.updateUser({
        fullName: 'Updated Name',
        avatar: 'https://example.com/avatar.jpg',
      });

      const updated = await serverDB.query.users.findFirst({
        where: eq(users.id, userId),
      });

      expect(updated?.fullName).toBe('Updated Name');
      expect(updated?.avatar).toBe('https://example.com/avatar.jpg');
    });
  });

  describe('deleteSetting', () => {
    it('should delete user settings', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        general: { fontSize: 14 },
      });

      await userModel.deleteSetting();

      const settings = await serverDB.query.userSettings.findFirst({
        where: eq(userSettings.id, userId),
      });

      expect(settings).toBeUndefined();
    });
  });

  describe('updateSetting', () => {
    it('should create settings if not exist', async () => {
      await userModel.updateSetting({
        general: { fontSize: 16 },
      });

      const settings = await serverDB.query.userSettings.findFirst({
        where: eq(userSettings.id, userId),
      });

      expect(settings?.general).toEqual({ fontSize: 16 });
    });

    it('should update existing settings', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        general: { fontSize: 14 },
      });

      await userModel.updateSetting({
        general: { fontSize: 18 },
      });

      const settings = await serverDB.query.userSettings.findFirst({
        where: eq(userSettings.id, userId),
      });

      expect(settings?.general).toEqual({ fontSize: 18 });
    });
  });

  describe('updatePreference', () => {
    it('should update user preference', async () => {
      await userModel.updatePreference({
        telemetry: false,
      });

      const user = await serverDB.query.users.findFirst({
        where: eq(users.id, userId),
      });

      expect((user?.preference as UserPreference)?.telemetry).toBe(false);
    });

    it('should merge with existing preference', async () => {
      await serverDB
        .update(users)
        .set({ preference: { telemetry: true, useCmdEnterToSend: true } })
        .where(eq(users.id, userId));

      await userModel.updatePreference({
        telemetry: false,
      });

      const user = await serverDB.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const preference = user?.preference as UserPreference;
      expect(preference?.telemetry).toBe(false);
      expect(preference?.useCmdEnterToSend).toBe(true);
    });

    it('should do nothing for non-existent user', async () => {
      const nonExistentUserModel = new UserModel(serverDB, 'non-existent');

      await expect(
        nonExistentUserModel.updatePreference({ telemetry: false }),
      ).resolves.toBeUndefined();
    });
  });

  describe('updateGuide', () => {
    it('should update user guide preference', async () => {
      await userModel.updateGuide({
        moveSettingsToAvatar: true,
      });

      const user = await serverDB.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const preference = user?.preference as UserPreference;
      expect(preference?.guide?.moveSettingsToAvatar).toBe(true);
    });

    it('should do nothing for non-existent user', async () => {
      const nonExistentUserModel = new UserModel(serverDB, 'non-existent');

      await expect(
        nonExistentUserModel.updateGuide({ moveSettingsToAvatar: true }),
      ).resolves.toBeUndefined();
    });
  });

  describe('static methods', () => {
    describe('makeSureUserExist', () => {
      it('should create user if not exists', async () => {
        await UserModel.makeSureUserExist(serverDB, 'new-user-id');

        const user = await serverDB.query.users.findFirst({
          where: eq(users.id, 'new-user-id'),
        });

        expect(user).toBeDefined();
      });

      it('should not throw if user already exists', async () => {
        await expect(UserModel.makeSureUserExist(serverDB, userId)).resolves.not.toThrow();
      });
    });

    describe('createUser', () => {
      it('should create a new user', async () => {
        const result = await UserModel.createUser(serverDB, {
          id: 'brand-new-user',
          email: 'new@example.com',
        });

        expect(result.duplicate).toBe(false);
        expect(result.user?.id).toBe('brand-new-user');
        expect(result.user?.email).toBe('new@example.com');
      });

      it('should return duplicate flag for existing user', async () => {
        const result = await UserModel.createUser(serverDB, {
          id: userId,
          email: 'duplicate@example.com',
        });

        expect(result.duplicate).toBe(true);
      });
    });

    describe('deleteUser', () => {
      it('should delete a user', async () => {
        await UserModel.deleteUser(serverDB, userId);

        const user = await serverDB.query.users.findFirst({
          where: eq(users.id, userId),
        });

        expect(user).toBeUndefined();
      });
    });

    describe('findById', () => {
      it('should find user by id', async () => {
        const user = await UserModel.findById(serverDB, userId);

        expect(user).toBeDefined();
        expect(user?.email).toBe('test@example.com');
      });

      it('should return undefined for non-existent user', async () => {
        const user = await UserModel.findById(serverDB, 'non-existent');

        expect(user).toBeUndefined();
      });
    });

    describe('findByEmail', () => {
      it('should find user by email', async () => {
        const user = await UserModel.findByEmail(serverDB, 'test@example.com');

        expect(user).toBeDefined();
        expect(user?.id).toBe(userId);
      });

      it('should return undefined for non-existent email', async () => {
        const user = await UserModel.findByEmail(serverDB, 'nonexistent@example.com');

        expect(user).toBeUndefined();
      });
    });

    describe('getUserApiKeys', () => {
      it('should return decrypted API keys', async () => {
        await serverDB.insert(userSettings).values({
          id: userId,
          keyVaults: 'encrypted-keys',
        });

        const decryptor = vi.fn().mockResolvedValue({
          openai: 'sk-xxx',
        });

        const result = await UserModel.getUserApiKeys(serverDB, userId, decryptor);

        expect(decryptor).toHaveBeenCalledWith('encrypted-keys', userId);
        expect(result).toEqual({ openai: 'sk-xxx' });
      });

      it('should throw UserNotFoundError when settings not found', async () => {
        await expect(
          UserModel.getUserApiKeys(serverDB, 'non-existent', mockDecryptor),
        ).rejects.toThrow(UserNotFoundError);
      });
    });

    describe('listUsersForMemoryExtractor', () => {
      it('should paginate users by createdAt and id', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values([
          { id: 'u1', createdAt: new Date('2024-01-01T00:00:00Z') },
          { id: 'u2', createdAt: new Date('2024-01-02T00:00:00Z') },
          { id: 'u3', createdAt: new Date('2024-01-03T00:00:00Z') },
        ]);

        const page1 = await UserModel.listUsersForMemoryExtractor(serverDB, { limit: 1 });
        expect(page1.map((u) => u.id)).toEqual(['u1']);

        const cursor: ListUsersForMemoryExtractorCursor = {
          createdAt: page1[0].createdAt,
          id: page1[0].id,
        };

        const page2 = await UserModel.listUsersForMemoryExtractor(serverDB, { cursor, limit: 10 });
        expect(page2.map((u) => u.id)).toEqual(['u2', 'u3']);
      });

      it('should filter by whitelist when provided', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values([
          { id: 'user-a', createdAt: new Date('2024-01-01T00:00:00Z') },
          { id: 'user-b', createdAt: new Date('2024-01-02T00:00:00Z') },
          { id: 'user-c', createdAt: new Date('2024-01-03T00:00:00Z') },
          { id: 'user-d', createdAt: new Date('2024-01-04T00:00:00Z') },
        ]);

        const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
          whitelist: ['user-b', 'user-d'],
        });

        expect(result.map((u) => u.id)).toEqual(['user-b', 'user-d']);
      });

      it('should combine whitelist with cursor', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values([
          { id: 'user-a', createdAt: new Date('2024-01-01T00:00:00Z') },
          { id: 'user-b', createdAt: new Date('2024-01-02T00:00:00Z') },
          { id: 'user-c', createdAt: new Date('2024-01-03T00:00:00Z') },
          { id: 'user-d', createdAt: new Date('2024-01-04T00:00:00Z') },
        ]);

        const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
          cursor: { createdAt: new Date('2024-01-02T00:00:00Z'), id: 'user-b' },
          whitelist: ['user-a', 'user-c', 'user-d'],
        });

        // Only users in whitelist that are after cursor
        expect(result.map((u) => u.id)).toEqual(['user-c', 'user-d']);
      });

      it('should return all users when whitelist is empty array', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values([
          { id: 'user-1', createdAt: new Date('2024-01-01T00:00:00Z') },
          { id: 'user-2', createdAt: new Date('2024-01-02T00:00:00Z') },
        ]);

        const result = await UserModel.listUsersForMemoryExtractor(serverDB, {
          whitelist: [],
        });

        // Empty whitelist should not filter (same as no whitelist)
        expect(result.map((u) => u.id)).toEqual(['user-1', 'user-2']);
      });
    });

    describe('getInfoForAIGeneration', () => {
      it('should return user info with language preference', async () => {
        await serverDB.insert(userSettings).values({
          id: userId,
          general: { responseLanguage: 'zh-CN' },
        });

        const result = await UserModel.getInfoForAIGeneration(serverDB, userId);

        expect(result.userName).toBe('Test User');
        expect(result.responseLanguage).toBe('zh-CN');
      });

      it('should default to en-US when no language preference set', async () => {
        const result = await UserModel.getInfoForAIGeneration(serverDB, userId);

        expect(result.responseLanguage).toBe('en-US');
      });

      it('should use firstName when fullName is not available', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values({
          id: userId,
          firstName: 'John',
        });

        const result = await UserModel.getInfoForAIGeneration(serverDB, userId);

        expect(result.userName).toBe('John');
      });

      it('should default to User when no name is available', async () => {
        await serverDB.delete(users);
        await serverDB.insert(users).values({
          id: userId,
        });

        const result = await UserModel.getInfoForAIGeneration(serverDB, userId);

        expect(result.userName).toBe('User');
      });

      it('should handle non-existent user', async () => {
        const result = await UserModel.getInfoForAIGeneration(serverDB, 'non-existent-user');

        expect(result.userName).toBe('User');
        expect(result.responseLanguage).toBe('en-US');
      });
    });
  });
});
