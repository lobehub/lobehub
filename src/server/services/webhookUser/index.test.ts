import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';

import { WebhookUserService } from './index';

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

describe('WebhookUserService', () => {
  let service: WebhookUserService;
  let mockDb: any;
  let mockUserModel: any;

  const mockUser = {
    avatar: 'https://example.com/avatar.png',
    email: 'test@example.com',
    fullName: 'Test User',
    id: 'user-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUserModel = {
      updateUser: vi.fn(),
    };
    (UserModel as any).mockImplementation(() => mockUserModel);

    const deleteChainMock = {
      where: vi.fn().mockResolvedValue(undefined),
    };

    mockDb = {
      delete: vi.fn().mockReturnValue(deleteChainMock),
      query: {
        account: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn(),
    };

    service = new WebhookUserService(mockDb);
  });

  describe('safeUpdateUser', () => {
    it('should update user when found in Better Auth accounts table', async () => {
      const betterAuthAccount = { userId: 'user-123', providerId: 'logto', accountId: 'acc-123' };

      mockDb.query.account.findFirst.mockResolvedValue(betterAuthAccount);
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      const updateData = {
        avatar: 'https://new-avatar.com/img.png',
        email: 'new@example.com',
        fullName: 'New Name',
      };

      const result = await service.safeUpdateUser(
        { providerId: 'logto', accountId: 'acc-123' },
        updateData,
      );

      expect(UserModel).toHaveBeenCalledWith(mockDb, 'user-123');
      expect(mockUserModel.updateUser).toHaveBeenCalledWith({
        avatar: updateData.avatar,
        email: updateData.email,
        fullName: updateData.fullName,
      });
      expect(result.status).toBe(200);
    });

    it('should update user when found in NextAuth accounts table (fallback)', async () => {
      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // Setup chain mock for NextAuth query
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([{ users: mockUser }])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      const updateData = { email: 'updated@example.com' };

      const result = await service.safeUpdateUser(
        { providerId: 'casdoor', accountId: 'casdoor-acc-456' },
        updateData,
      );

      expect(UserModel).toHaveBeenCalledWith(mockDb, 'user-123');
      expect(mockUserModel.updateUser).toHaveBeenCalledWith({
        avatar: undefined,
        email: 'updated@example.com',
        fullName: undefined,
      });
      expect(result.status).toBe(200);
    });

    it('should warn and not update when user not found', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // NextAuth account also not found
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      const result = await service.safeUpdateUser(
        { providerId: 'logto', accountId: 'unknown-acc' },
        { email: 'test@example.com' },
      );

      expect(UserModel).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(result.status).toBe(200);

      consoleWarnSpy.mockRestore();
    });

    it('should only update provided fields', async () => {
      const betterAuthAccount = { userId: 'user-123', providerId: 'logto', accountId: 'acc-123' };

      mockDb.query.account.findFirst.mockResolvedValue(betterAuthAccount);
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      // Only updating email
      const result = await service.safeUpdateUser(
        { providerId: 'logto', accountId: 'acc-123' },
        { email: 'only-email@example.com' },
      );

      expect(mockUserModel.updateUser).toHaveBeenCalledWith({
        avatar: undefined,
        email: 'only-email@example.com',
        fullName: undefined,
      });
      expect(result.status).toBe(200);
    });
  });

  describe('safeSignOutUser', () => {
    it('should delete all sessions when user found in Better Auth accounts table', async () => {
      const betterAuthAccount = { userId: 'user-123', providerId: 'logto', accountId: 'acc-123' };

      mockDb.query.account.findFirst.mockResolvedValue(betterAuthAccount);
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);

      const result = await service.safeSignOutUser({
        providerId: 'logto',
        accountId: 'acc-123',
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });

    it('should delete all sessions when user found in NextAuth accounts table (fallback)', async () => {
      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // NextAuth account found
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([{ users: mockUser }])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      const result = await service.safeSignOutUser({
        providerId: 'casdoor',
        accountId: 'casdoor-acc-456',
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });

    it('should warn and not delete sessions when user not found', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // NextAuth account also not found
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      const result = await service.safeSignOutUser({
        providerId: 'logto',
        accountId: 'unknown-acc',
      });

      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(result.status).toBe(200);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('getUserByAccount (via public methods)', () => {
    it('should prioritize Better Auth account over NextAuth account', async () => {
      const betterAuthAccount = { userId: 'better-auth-user', providerId: 'logto', accountId: 'acc' };
      const betterAuthUser = { ...mockUser, id: 'better-auth-user' };

      mockDb.query.account.findFirst.mockResolvedValue(betterAuthAccount);
      mockDb.query.users.findFirst.mockResolvedValue(betterAuthUser);

      await service.safeUpdateUser({ providerId: 'logto', accountId: 'acc' }, {});

      // Should use Better Auth user, not query NextAuth table
      expect(UserModel).toHaveBeenCalledWith(mockDb, 'better-auth-user');
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should fallback to NextAuth account when Better Auth account not found', async () => {
      const nextAuthUser = { ...mockUser, id: 'nextauth-user' };

      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // NextAuth account found
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([{ users: nextAuthUser }])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      await service.safeUpdateUser({ providerId: 'casdoor', accountId: 'acc' }, {});

      // Should use NextAuth user
      expect(UserModel).toHaveBeenCalledWith(mockDb, 'nextauth-user');
    });

    it('should return null when user not found in both tables', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Better Auth account not found
      mockDb.query.account.findFirst.mockResolvedValue(null);

      // NextAuth account also not found
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb) => cb([])),
        where: vi.fn().mockReturnThis(),
      };
      mockDb.select.mockReturnValue(chainMock);

      await service.safeUpdateUser({ providerId: 'unknown', accountId: 'unknown' }, {});

      // Should not create UserModel since user not found
      expect(UserModel).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
