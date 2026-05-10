// @vitest-environment node
import { Plans } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getReferralStatus,
  getSubscriptionPlan,
  onUserActivityForBusiness,
} from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { serverDB } from '@/database/server';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { userRouter } from '../user';

const mockAfterTasks = vi.hoisted((): Promise<void>[] => []);

// Mock modules
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void> | void) => {
    mockAfterTasks.push(Promise.resolve(callback()));
  },
}));

vi.mock('@/business/server/user', () => ({
  getReferralStatus: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  onUserActivityForBusiness: vi.fn(),
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

describe('userRouter', () => {
  const mockUserId = 'test-user-id';
  const mockCtx = {
    userId: mockUserId,
  };

  const flushAfterTasks = async () => {
    await Promise.all(mockAfterTasks.splice(0));
  };

  beforeEach(() => {
    mockAfterTasks.length = 0;
    vi.clearAllMocks();
    vi.mocked(getReferralStatus).mockResolvedValue(undefined);
    vi.mocked(getSubscriptionPlan).mockResolvedValue(Plans.Free);
    vi.mocked(onUserActivityForBusiness).mockResolvedValue(undefined);
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
            advanceLastActiveAt: vi.fn().mockResolvedValue(undefined),
            getUserState: vi.fn().mockResolvedValue(mockState),
            updateUser: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(5),
          }) as any,
      );

      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(true),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserState();

      expect(result).toMatchObject({
        isOnboard: true,
        preference: { telemetry: true },
        settings: {},
        hasConversation: true,
        canEnablePWAGuide: true,
        canEnableTrace: true,
        userId: mockUserId,
      });
    });

    it('should invoke the user activity hook after winning the lastActiveAt update', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const previousLastActiveAt = new Date('2026-03-01T00:00:00.000Z');
      const advanceLastActiveAt = vi.fn().mockResolvedValue({
        previousLastActiveAt,
        userCreatedAt: createdAt,
      });
      const mockState = {
        isOnboarded: true,
        preference: {},
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            advanceLastActiveAt,
            getUserState: vi.fn().mockResolvedValue(mockState),
          }) as any,
      );
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(0),
          }) as any,
      );
      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).getUserState();
      await flushAfterTasks();

      expect(advanceLastActiveAt).toHaveBeenCalledWith(expect.any(Date));
      expect(onUserActivityForBusiness).toHaveBeenCalledWith({
        currentTime: expect.any(Date),
        previousLastActiveAt,
        userCreatedAt: createdAt,
        userId: mockUserId,
      });
    });

    it('should skip the user activity hook when a concurrent request already updated lastActiveAt', async () => {
      const advanceLastActiveAt = vi.fn().mockResolvedValue(undefined);
      const mockState = {
        isOnboarded: true,
        preference: {},
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            advanceLastActiveAt,
            getUserState: vi.fn().mockResolvedValue(mockState),
          }) as any,
      );
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(0),
          }) as any,
      );
      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).getUserState();
      await flushAfterTasks();

      expect(advanceLastActiveAt).toHaveBeenCalledWith(expect.any(Date));
      expect(onUserActivityForBusiness).not.toHaveBeenCalled();
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
