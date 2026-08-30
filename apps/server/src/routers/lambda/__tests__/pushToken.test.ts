import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { AgentInterventionReviewStatus } from '@/business/server/agent-run/agentInterventionReview';
import type * as LiveActivityBusiness from '@/business/server/notification/liveActivity';
import { pushTokenRouter } from '@/server/routers/lambda/pushToken';

const mockUpsert = vi.fn();
const mockUnregister = vi.fn();
const mockUnregisterLiveActivities = vi.fn();
const mockDeleteByExpoTokenAndDevice = vi.fn();
const mockRegisterPushToStart = vi.fn();
const mockRegisterLiveActivity = vi.fn();

vi.mock('@/business/server/notification/liveActivity', () => ({
  registerAgentInterventionLiveActivity: (...args: unknown[]) => mockRegisterLiveActivity(...args),
  registerLiveActivityPushToStartToken: (...args: unknown[]) => mockRegisterPushToStart(...args),
}));

vi.mock('@/database/models/pushToken', () => ({
  PushLiveActivityModel: vi.fn(() => ({
    unregisterDevice: mockUnregisterLiveActivities,
  })),
  PushTokenModel: vi.fn(() => ({
    unregister: mockUnregister,
    upsert: mockUpsert,
  })),
  deletePushTokenByExpoTokenAndDevice: (...args: unknown[]) =>
    mockDeleteByExpoTokenAndDevice(...args),
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

    it('persists the iOS push-to-start token through the business slot', async () => {
      mockUpsert.mockResolvedValueOnce({ id: 'row-1' });
      mockRegisterPushToStart.mockResolvedValueOnce(undefined);
      const caller = createCaller();

      await caller.register({
        apnsEnvironment: 'production',
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[abc]',
        liveActivityPushToStartToken: 'push-to-start-token',
        platform: 'ios',
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        deviceId: 'iphone',
        expoToken: 'ExponentPushToken[abc]',
        platform: 'ios',
      });
      expect(mockRegisterPushToStart).toHaveBeenCalledWith({
        apnsEnvironment: 'production',
        deviceId: 'iphone',
        liveActivityPushToStartToken: 'push-to-start-token',
        userId: 'user-1',
        workspaceId: undefined,
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

  describe('registerLiveActivity', () => {
    it('exposes the exact terminal fallback from the OSS business slot', async () => {
      const business = await vi.importActual<typeof LiveActivityBusiness>(
        '@/business/server/notification/liveActivity',
      );

      const result = await business.registerAgentInterventionLiveActivity({
        activityId: 'native-activity-1',
        activityKey: 'batch-1',
        apnsEnvironment: 'sandbox',
        deviceId: 'iphone',
        operationId: 'op-1',
        pushToken: 'activity-update-token',
        userId: 'user-1',
      });

      expect(result).toEqual({ interventionStatus: 'unavailable', interventionTerminal: true });
      expectTypeOf<LiveActivityBusiness.RegisterAgentInterventionLiveActivityResult>().toEqualTypeOf<{
        interventionStatus: AgentInterventionReviewStatus;
        interventionTerminal: boolean;
      }>();
    });

    it('registers by durable activityKey and returns interventionStatus', async () => {
      mockRegisterLiveActivity.mockResolvedValueOnce({
        interventionStatus: 'resolved',
        interventionTerminal: true,
      });
      const caller = createCaller();

      const result = await caller.registerLiveActivity({
        activityId: 'native-activity-1',
        activityKey: 'op-1:tool-1',
        apnsEnvironment: 'sandbox',
        deviceId: 'iphone',
        operationId: 'op-1',
        pushToken: 'activity-update-token',
      });

      expect(mockRegisterLiveActivity).toHaveBeenCalledWith({
        activityId: 'native-activity-1',
        activityKey: 'op-1:tool-1',
        apnsEnvironment: 'sandbox',
        deviceId: 'iphone',
        operationId: 'op-1',
        pushToken: 'activity-update-token',
        userId: 'user-1',
        workspaceId: undefined,
      });
      expect(result).toEqual({ interventionStatus: 'resolved', interventionTerminal: true });
      expectTypeOf(
        result,
      ).toEqualTypeOf<LiveActivityBusiness.RegisterAgentInterventionLiveActivityResult>();
      expectTypeOf(result.interventionStatus).toEqualTypeOf<AgentInterventionReviewStatus>();
    });

    it.each([
      { interventionStatus: 'approved', interventionTerminal: true },
      { interventionStatus: 'rejected', interventionTerminal: true },
      { interventionStatus: 'mixed', interventionTerminal: false },
      { interventionStatus: 'mixed', interventionTerminal: true },
    ] satisfies LiveActivityBusiness.RegisterAgentInterventionLiveActivityResult[])(
      'preserves generic status $interventionStatus with terminal=$interventionTerminal',
      async (registrationResult) => {
        mockRegisterLiveActivity.mockResolvedValueOnce(registrationResult);
        const caller = createCaller();

        const result = await caller.registerLiveActivity({
          activityId: 'native-activity-1',
          activityKey: 'batch-1',
          apnsEnvironment: 'sandbox',
          deviceId: 'iphone',
          operationId: 'op-1',
          pushToken: 'activity-update-token',
        });

        expect(result).toEqual(registrationResult);
      },
    );

    it('rejects a legacy activityId-only registration without a durable activityKey', async () => {
      const caller = createCaller();
      await expect(
        // @ts-expect-error validates that activityKey is mandatory
        caller.registerLiveActivity({
          activityId: 'local-activity-id',
          apnsEnvironment: 'production',
          deviceId: 'iphone',
          operationId: 'op-1',
          pushToken: 'token',
        }),
      ).rejects.toThrow();
    });

    it('rejects an activityKey-only registration without the native activityId', async () => {
      const caller = createCaller();
      await expect(
        // @ts-expect-error validates that activityId is mandatory
        caller.registerLiveActivity({
          activityKey: 'op-1:tool-1',
          apnsEnvironment: 'production',
          deviceId: 'iphone',
          operationId: 'op-1',
          pushToken: 'token',
        }),
      ).rejects.toThrow();
    });
  });

  describe('unregister', () => {
    it('should delete by (expoToken, deviceId) when expoToken is provided', async () => {
      mockDeleteByExpoTokenAndDevice.mockResolvedValueOnce(undefined);
      const caller = createCaller();

      const result = await caller.unregister({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
      });

      expect(mockDeleteByExpoTokenAndDevice).toHaveBeenCalledWith(expect.anything(), {
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
      });
      expect(result).toEqual({ success: true });
      // Legacy (userId, deviceId) path must not fire when expoToken is present
      expect(mockUnregister).not.toHaveBeenCalled();
    });

    it('should fall back to (userId, deviceId) for legacy clients with a session', async () => {
      // Path B — v1.0.7 only sends deviceId; if the request still carries a
      // valid session we MUST delete the row, otherwise PushChannel keeps
      // notifying a signed-out device (Expo DeviceNotRegistered only fires on
      // uninstall, not logout).
      mockUnregister.mockResolvedValueOnce(undefined);
      const caller = createCaller();

      const result = await caller.unregister({ deviceId: 'device-1' });

      expect(mockUnregister).toHaveBeenCalledWith('device-1');
      expect(mockUnregisterLiveActivities).toHaveBeenCalledWith('device-1');
      expect(mockDeleteByExpoTokenAndDevice).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should silently succeed without expoToken AND without session', async () => {
      // Path C — v1.0.7 + dead session: the only safe move is silent OK.
      // Orphan row will be cleaned up by the process-push-receipts worker via
      // Expo DeviceNotRegistered receipts. Returning 200 here stops the storm.
      const caller = createCaller({ userId: undefined });

      const result = await caller.unregister({ deviceId: 'device-1' });

      expect(mockDeleteByExpoTokenAndDevice).not.toHaveBeenCalled();
      expect(mockUnregister).not.toHaveBeenCalled();
      expect(mockUnregisterLiveActivities).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should succeed for an unauthenticated caller carrying expoToken', async () => {
      // New clients (>=1.0.8) hit Path A regardless of session.
      const caller = createCaller({ userId: undefined });

      const result = await caller.unregister({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
      });

      expect(result).toEqual({ success: true });
      expect(mockDeleteByExpoTokenAndDevice).toHaveBeenCalled();
      expect(mockUnregister).not.toHaveBeenCalled();
      expect(mockUnregisterLiveActivities).not.toHaveBeenCalled();
    });

    it('should prefer expoToken precision over the legacy userId fallback', async () => {
      // If both are available, always take Path A — the (expoToken, deviceId)
      // pair is more precise and doesn't risk deleting a wrong row.
      const caller = createCaller();

      await caller.unregister({
        deviceId: 'device-1',
        expoToken: 'ExponentPushToken[abc]',
      });

      expect(mockDeleteByExpoTokenAndDevice).toHaveBeenCalled();
      expect(mockUnregister).not.toHaveBeenCalled();
    });

    it('should reject empty deviceId', async () => {
      const caller = createCaller();
      await expect(caller.unregister({ deviceId: '' })).rejects.toThrow();
    });

    it('should reject empty expoToken when provided', async () => {
      const caller = createCaller();
      await expect(caller.unregister({ deviceId: 'device-1', expoToken: '' })).rejects.toThrow();
    });
  });
});
