import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushTokenRouter } from '@/server/routers/lambda/pushToken';

const mockUpsert = vi.fn();
const mockUnregister = vi.fn();

vi.mock('@/database/models/pushToken', () => ({
  PushTokenModel: vi.fn(() => ({
    unregister: mockUnregister,
    upsert: mockUpsert,
  })),
}));

const createCaller = (ctxOverrides: Partial<any> = {}) => {
  const ctx = {
    serverDB: {} as any,
    userId: 'user-1',
    ...ctxOverrides,
  };

  return pushTokenRouter.createCaller(ctx);
};

describe('pushTokenRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should upsert with the input fields', async () => {
      mockUpsert.mockResolvedValueOnce({ id: 'row-1' });

      const caller = createCaller();
      const result = await caller.register({
        appVersion: '1.0.0',
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
        locale: 'zh-CN',
        platform: 'ios',
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        appVersion: '1.0.0',
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
        locale: 'zh-CN',
        platform: 'ios',
      });
      expect(result).toEqual({ id: 'row-1' });
    });

    it('should accept omitted optional fields', async () => {
      mockUpsert.mockResolvedValueOnce({ id: 'row-1' });
      const caller = createCaller();

      await caller.register({
        deviceId: 'd',
        expoToken: 't',
        platform: 'android',
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        deviceId: 'd',
        expoToken: 't',
        platform: 'android',
      });
    });

    it('should reject empty deviceId', async () => {
      const caller = createCaller();
      await expect(
        caller.register({ deviceId: '', expoToken: 't', platform: 'ios' }),
      ).rejects.toThrow();
    });

    it('should reject empty expoToken', async () => {
      const caller = createCaller();
      await expect(
        caller.register({ deviceId: 'd', expoToken: '', platform: 'ios' }),
      ).rejects.toThrow();
    });

    it('should reject invalid platform', async () => {
      const caller = createCaller();
      await expect(
        // @ts-expect-error testing runtime validation
        caller.register({ deviceId: 'd', expoToken: 't', platform: 'windows' }),
      ).rejects.toThrow();
    });
  });

  describe('unregister', () => {
    it('should call model.unregister with deviceId', async () => {
      mockUnregister.mockResolvedValueOnce(undefined);
      const caller = createCaller();

      await caller.unregister({ deviceId: 'device-1' });

      expect(mockUnregister).toHaveBeenCalledWith('device-1');
    });

    it('should reject empty deviceId', async () => {
      const caller = createCaller();
      await expect(caller.unregister({ deviceId: '' })).rejects.toThrow();
    });
  });
});
