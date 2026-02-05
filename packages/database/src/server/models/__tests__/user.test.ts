import { INBOX_SESSION_ID } from '@lobechat/const';
import type { UserGuide, UserPreference } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import dayjs from 'dayjs';
import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { getTestDB } from '../../../core/getTestDB';
import { SessionModel } from '../../../models/session';
import { UserModel, UserNotFoundError } from '../../../models/user';
import type { UserSettingsItem } from '../../../schemas';
import { nextauthAccounts, users, userSettings } from '../../../schemas';

const serverDB = await getTestDB();

const userId = 'user-db';
const userEmail = 'user@example.com';
const userModel = new UserModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(userSettings);
  process.env.KEY_VAULTS_SECRET = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(userSettings);
  process.env.KEY_VAULTS_SECRET = undefined;
});

describe('UserModel', () => {
  describe('createUser', () => {
    it('should create a new user and inbox session', async () => {
      const params = {
        id: userId,
        username: 'testuser',
        email: 'test@example.com',
      };

      await UserModel.createUser(serverDB, params);

      const user = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
      expect(user).not.toBeNull();
      expect(user?.username).toBe('testuser');
      expect(user?.email).toBe('test@example.com');

      const sessionModel = new SessionModel(serverDB, userId);
      const inbox = await sessionModel.findByIdOrSlug(INBOX_SESSION_ID);
      expect(inbox).not.toBeNull();
    });
  });

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      await serverDB.insert(users).values({ id: userId });

      await UserModel.deleteUser(serverDB, userId);

      const user = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
      expect(user).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find a user by ID', async () => {
      await serverDB.insert(users).values({ id: userId, username: 'testuser' });

      const user = await UserModel.findById(serverDB, userId);

      expect(user).not.toBeNull();
      expect(user?.id).toBe(userId);
      expect(user?.username).toBe('testuser');
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      await serverDB.insert(users).values({ id: userId, email: userEmail });

      const user = await UserModel.findByEmail(serverDB, userEmail);

      expect(user).not.toBeNull();
      expect(user?.id).toBe(userId);
      expect(user?.email).toBe(userEmail);
    });
  });

  describe('getUserState', () => {
    it('should get user state with decrypted keyVaults', async () => {
      const preference = { useCmdEnterToSend: true } as UserPreference;
      const keyVaults = { apiKey: 'secret' };

      await serverDB.insert(users).values({ id: userId, preference });

      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const encryptedKeyVaults = await gateKeeper.encrypt(JSON.stringify(keyVaults));

      await serverDB.insert(userSettings).values({
        id: userId,
        keyVaults: encryptedKeyVaults,
      });

      const state = await userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);

      expect(state.userId).toBe(userId);
      expect(state.preference).toEqual(preference);
      expect(state.settings.keyVaults).toEqual(keyVaults);
    });

    it('should throw an error if user not found', async () => {
      const userModel = new UserModel(serverDB, 'invalid-user-id');

      await expect(userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults)).rejects.toThrow(
        'user not found',
      );
    });
  });

  describe('updateUser', () => {
    it('should update user fields', async () => {
      await serverDB.insert(users).values({ id: userId, username: 'oldname' });

      await userModel.updateUser({ username: 'newname' });

      const updatedUser = await serverDB.query.users.findFirst({
        where: eq(users.id, userId),
      });
      expect(updatedUser?.username).toBe('newname');
    });
  });

  describe('getUserSettings', () => {
    it('should get user settings', async () => {
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(userSettings).values({ id: userId, general: { language: 'en-US' } });

      const data = await userModel.getUserSettings();

      expect(data).toMatchObject({ id: userId, general: { language: 'en-US' } });
    });
  });

  describe('deleteSetting', () => {
    it('should delete user settings', async () => {
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(userSettings).values({ id: userId });

      await userModel.deleteSetting();

      const settings = await serverDB.query.userSettings.findFirst({
        where: eq(users.id, userId),
      });

      expect(settings).toBeUndefined();
    });
  });

  describe('updateSetting', () => {
    it('should update user settings with new item', async () => {
      const settings = {
        general: { language: 'en-US' },
      } as UserSettingsItem;
      await serverDB.insert(users).values({ id: userId });

      await userModel.updateSetting(settings);

      const updatedSettings = await serverDB.query.userSettings.findFirst({
        where: eq(users.id, userId),
      });
      expect(updatedSettings?.general).toEqual(settings.general);
    });

    it('should update user settings with exist item', async () => {
      const settings = {
        general: { language: 'en-US' },
      } as UserSettingsItem;
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(userSettings).values({ ...settings, keyVaults: '', id: userId });

      const newSettings = {
        general: { fontSize: 16, language: 'zh-CN', themeMode: 'dark' },
      } as UserSettingsItem;
      await userModel.updateSetting(newSettings);

      const updatedSettings = await serverDB.query.userSettings.findFirst({
        where: eq(users.id, userId),
      });
      expect(updatedSettings?.general).toEqual(newSettings.general);
    });
  });

  describe('updatePreference', () => {
    it('should update user preference', async () => {
      const preference = { guide: { topic: false } } as UserPreference;
      await serverDB.insert(users).values({ id: userId, preference });

      const newPreference: Partial<UserPreference> = {
        guide: { topic: true, moveSettingsToAvatar: true },
      };
      await userModel.updatePreference(newPreference);

      const updatedUser = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
      expect(updatedUser?.preference).toEqual({ ...preference, ...newPreference });
    });
  });

  describe('updateGuide', () => {
    it('should update user guide', async () => {
      const preference = { guide: { topic: false } } as UserGuide;
      await serverDB.insert(users).values({ id: userId, preference });

      const newGuide: Partial<UserGuide> = {
        topic: true,
        moveSettingsToAvatar: true,
        uploadFileInKnowledgeBase: true,
      };
      await userModel.updateGuide(newGuide);

      const updatedUser = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
      expect(updatedUser?.preference).toEqual({ ...preference, guide: newGuide });
    });
  });

  describe('getUserApiKeys', () => {
    it('should get and decrypt user API keys', async () => {
      const keyVaults = { openai: { apiKey: 'test-key' } };
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const encryptedKeyVaults = await gateKeeper.encrypt(JSON.stringify(keyVaults));

      const userId = 'user-api-id';

      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(userSettings).values({
        id: userId,
        keyVaults: encryptedKeyVaults,
      });

      const result = await UserModel.getUserApiKeys(
        serverDB,
        userId,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
      expect(result).toEqual(keyVaults);
    });

    it('should throw error when user not found', async () => {
      await expect(
        UserModel.getUserApiKeys(serverDB, 'non-existent-id', KeyVaultsGateKeeper.getUserKeyVaults),
      ).rejects.toThrow('user not found');
    });

    it('should handle decrypt failure and return empty object', async () => {
      const userId = 'user-api-test-id';
      // 模拟解密失败的情况
      const invalidEncryptedData = 'invalid:-encrypted-:data';
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(userSettings).values({
        id: userId,
        keyVaults: invalidEncryptedData,
      });

      const result = await UserModel.getUserApiKeys(
        serverDB,
        userId,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
      expect(result).toEqual({});
    });
  });

  describe('getUserRegistrationDuration', () => {
    it('should return default values when user not found', async () => {
      const duration = await userModel.getUserRegistrationDuration();
      const today = dayjs().format('YYYY-MM-DD');

      expect(duration).toEqual({
        createdAt: today,
        duration: 1,
        updatedAt: today,
      });
    });

    it('should calculate correct duration for existing user', async () => {
      // Mock the current date
      const now = new Date('2024-01-15');
      vi.setSystemTime(now);

      const createdAt = new Date('2024-01-10'); // 5 days ago
      await serverDB.insert(users).values({
        id: userId,
        createdAt,
      });

      const duration = await userModel.getUserRegistrationDuration();

      expect(duration).toEqual({
        createdAt: '2024-01-10',
        duration: 6, // 5 days difference + 1
        updatedAt: '2024-01-15',
      });

      vi.useRealTimers();
    });
  });

  // 补充一些边界情况的测试
  describe('edge cases', () => {
    describe('updatePreference', () => {
      it('should handle undefined preference', async () => {
        await serverDB.insert(users).values({ id: userId });

        const newPreference: Partial<UserPreference> = {
          guide: { topic: true },
        };

        await userModel.updatePreference(newPreference);

        const updatedUser = await serverDB.query.users.findFirst({
          where: eq(users.id, userId),
        });

        expect(updatedUser?.preference).toMatchObject(newPreference);
      });

      it('should do nothing if user not found', async () => {
        const nonExistentUserModel = new UserModel(serverDB, 'non-existent-id');
        const result = await nonExistentUserModel.updatePreference({ guide: { topic: true } });
        expect(result).toBeUndefined();
      });
    });

    describe('updateGuide', () => {
      it('should handle undefined guide', async () => {
        await serverDB.insert(users).values({
          id: userId,
          preference: {} as UserPreference,
        });

        const newGuide: Partial<UserGuide> = {
          topic: true,
        };

        await userModel.updateGuide(newGuide);

        const updatedUser = await serverDB.query.users.findFirst({
          where: eq(users.id, userId),
        });
        expect(updatedUser?.preference).toEqual({ guide: newGuide });
      });

      it('should do nothing if user not found', async () => {
        const nonExistentUserModel = new UserModel(serverDB, 'non-existent-id');
        const result = await nonExistentUserModel.updateGuide({ topic: true });
        expect(result).toBeUndefined();
      });
    });

    describe('createUser', () => {
      it('should not create duplicate user with same id', async () => {
        const params = {
          id: userId,
          username: 'existinguser',
          email: 'existing@example.com',
        };

        // First creation
        await UserModel.createUser(serverDB, params);

        // Attempt to create with same ID but different details
        await UserModel.createUser(serverDB, {
          ...params,
          username: 'newuser',
          email: 'new@example.com',
        });

        const user = await UserModel.findById(serverDB, userId);
        expect(user?.username).toBe('existinguser');
        expect(user?.email).toBe('existing@example.com');
      });
    });

    describe('getUserState', () => {
      it('should handle empty settings', async () => {
        await serverDB.insert(users).values({
          id: userId,
          preference: {} as UserPreference,
          isOnboarded: true,
        });

        const state = await userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);

        expect(state).toMatchObject({
          userId,
          isOnboarded: true,
          preference: {},
          settings: {
            defaultAgent: {},
            general: {},
            keyVaults: {},
            languageModel: {},
            systemAgent: {},
            tool: {},
            tts: {},
          },
        });
      });
    });
  });

  describe('getUserSSOProviders', () => {
    it('should get user SSO providers from nextauth accounts', async () => {
      // Insert a user and associated OAuth account
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(nextauthAccounts).values({
        userId,
        type: 'oauth',
        provider: 'github',
        providerAccountId: '123456',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        scope: 'user:email',
      } as any);

      const result = await userModel.getUserSSOProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        provider: 'github',
        providerAccountId: '123456',
      });
      expect(result[0].expiresAt).toBeDefined();
    });

    it('should return empty array when no SSO providers exist', async () => {
      await serverDB.insert(users).values({ id: userId });

      const result = await userModel.getUserSSOProviders();
      expect(result).toEqual([]);
    });
  });

  describe('static methods', () => {
    describe('makeSureUserExist', () => {
      it('should create user if not exists', async () => {
        const newUserId = 'new-user-123';

        // Ensure user doesn't exist
        const existingUser = await serverDB.query.users.findFirst({
          where: eq(users.id, newUserId),
        });
        expect(existingUser).toBeUndefined();

        // Call makeSureUserExist
        await UserModel.makeSureUserExist(serverDB, newUserId);

        // Verify user was created
        const createdUser = await serverDB.query.users.findFirst({
          where: eq(users.id, newUserId),
        });
        expect(createdUser).toBeDefined();
        expect(createdUser?.id).toBe(newUserId);
      });

      it('should not create duplicate user if already exists', async () => {
        // Create user first
        await serverDB.insert(users).values({ id: userId });

        // Call makeSureUserExist again
        await UserModel.makeSureUserExist(serverDB, userId);

        // Verify there's still only one user with this ID
        const userCount = await serverDB
          .select({ count: count() })
          .from(users)
          .where(eq(users.id, userId));

        expect(userCount[0].count).toBe(1);
      });
    });
  });
});

describe('UserNotFoundError', () => {
  it('should extend TRPCError with correct code and message', () => {
    const error = new UserNotFoundError();

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toBe('user not found');
  });
});
