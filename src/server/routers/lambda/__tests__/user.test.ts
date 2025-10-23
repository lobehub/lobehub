// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enableClerk } from '@/const/auth';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel, UserNotFoundError } from '@/database/models/user';
import { serverDB } from '@/database/server';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { NextAuthUserService } from '@/server/services/nextAuthUser';
import { UserService } from '@/server/services/user';

import { userRouter } from '../user';

// Mock modules
vi.mock('@clerk/nextjs/server', () => ({
  currentUser: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  serverDB: {},
}));

vi.mock('@/database/models/message');
vi.mock('@/database/models/session');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/server/modules/S3');
vi.mock('@/server/services/user');
vi.mock('@/server/services/nextAuthUser');
vi.mock('@/const/auth', () => ({
  enableClerk: true,
}));

describe('userRouter', () => {
  const mockUserId = 'test-user-id';
  const mockCtx = {
    userId: mockUserId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserRegistrationDuration', () => {
    it('should return registration duration', async () => {
      const mockDuration = { duration: 100, createdAt: '2023-01-01', updatedAt: '2023-01-02' };
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserRegistrationDuration: vi.fn().mockResolvedValue(mockDuration),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserRegistrationDuration();

      expect(result).toEqual(mockDuration);
      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('getUserSSOProviders', () => {
    it('should return SSO providers', async () => {
      const mockProviders = [
        {
          provider: 'google',
          providerAccountId: '123',
          userId: 'user-1',
          type: 'oauth',
        },
      ];
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserSSOProviders: vi.fn().mockResolvedValue(mockProviders),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserSSOProviders();

      expect(result).toEqual(mockProviders);
      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('getUserState', () => {
    it('should return user state', async () => {
      const mockState = {
        isOnboarded: true,
        preference: { telemetry: true },
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserState: vi.fn().mockResolvedValue(mockState),
          }) as any,
      );

      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(true),
          }) as any,
      );

      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(true),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserState();

      expect(result).toEqual({
        isOnboard: true,
        preference: { telemetry: true },
        settings: {},
        hasConversation: true,
        canEnablePWAGuide: true,
        canEnableTrace: true,
        userId: mockUserId,
      });
    });

    it('should create new user when user not found (clerk enabled)', async () => {
      const mockClerkUser = {
        id: mockUserId,
        createdAt: new Date(),
        emailAddresses: [{ id: 'email-1', emailAddress: 'test@example.com' }],
        firstName: 'Test',
        lastName: 'User',
        imageUrl: 'avatar.jpg',
        phoneNumbers: [],
        primaryEmailAddressId: 'email-1',
        primaryPhoneNumberId: null,
        username: 'testuser',
      };

      const { currentUser } = await import('@clerk/nextjs/server');
      vi.mocked(currentUser).mockResolvedValue(mockClerkUser as any);

      vi.mocked(UserService).mockImplementation(
        () =>
          ({
            createUser: vi.fn().mockResolvedValue({ success: true }),
          }) as any,
      );

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserState: vi
              .fn()
              .mockRejectedValueOnce(new UserNotFoundError())
              .mockResolvedValueOnce({
                isOnboarded: false,
                preference: { telemetry: null },
                settings: {},
              }),
          }) as any,
      );

      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx } as any).getUserState();

      expect(result).toEqual({
        isOnboard: true,
        preference: { telemetry: null },
        settings: {},
        hasConversation: false,
        canEnablePWAGuide: false,
        canEnableTrace: false,
        userId: mockUserId,
      });
    });
  });

  describe('makeUserOnboarded', () => {
    it('should update user onboarded status', async () => {
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateUser: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).makeUserOnboarded();

      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('unlinkSSOProvider', () => {
    it('should unlink SSO provider successfully', async () => {
      const mockInput = {
        provider: 'google',
        providerAccountId: '123',
      };

      const mockAccount = {
        userId: mockUserId,
        provider: 'google',
        providerAccountId: '123',
        type: 'oauth',
      };

      vi.mocked(NextAuthUserService).mockReturnValue({
        getAccount: vi.fn().mockResolvedValue(mockAccount),
        unlinkAccount: vi.fn().mockResolvedValue(undefined),
      } as any);

      await expect(
        userRouter.createCaller({ ...mockCtx }).unlinkSSOProvider(mockInput),
      ).resolves.not.toThrow();
    });

    it('should throw error if account does not exist', async () => {
      const mockInput = {
        provider: 'google',
        providerAccountId: '123',
      };

      vi.mocked(NextAuthUserService).mockReturnValue({
        getAccount: vi.fn().mockResolvedValue(null),
        unlinkAccount: vi.fn(),
      } as any);

      await expect(
        userRouter.createCaller({ ...mockCtx }).unlinkSSOProvider(mockInput),
      ).rejects.toThrow('The account does not exist');
    });
  });

  describe('updateSettings', () => {
    it('should update settings with encrypted key vaults', async () => {
      const mockSettings = {
        keyVaults: { openai: { key: 'test-key' } },
        general: { language: 'en-US' },
      };

      const mockEncryptedVaults = 'encrypted-data';
      const mockGateKeeper = {
        encrypt: vi.fn().mockResolvedValue(mockEncryptedVaults),
      };

      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings(mockSettings);

      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify(mockSettings.keyVaults));
    });

    it('should update settings without key vaults', async () => {
      const mockSettings = {
        general: { language: 'en-US' },
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings(mockSettings);

      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });
});
