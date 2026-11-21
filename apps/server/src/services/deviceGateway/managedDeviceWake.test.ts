import type { LobeChatDatabase } from '@lobechat/database';
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findPersonalByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  isAvailable: vi.fn(),
  queryDeviceList: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('@/business/server/managedDevice', () => ({
  managedDeviceProvider: {
    isAvailable: mocks.isAvailable,
    listStates: vi.fn(),
    wake: mocks.wake,
  },
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findPersonalByDeviceId: mocks.findPersonalByDeviceId,
      findWorkspaceDeviceById: mocks.findWorkspaceDeviceById,
    };
  }),
}));

vi.mock('./index', () => ({
  deviceGateway: { isConfigured: true, queryDeviceList: mocks.queryDeviceList },
}));

const {
  DEVICE_WAKING_ERROR_CODE,
  MANAGED_DEVICE_TOOL_CALL_WAIT_MS,
  MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS,
  MANAGED_DEVICE_WAKE_REQUEST_TIMEOUT_MS,
  MANAGED_DEVICE_WAKE_TIMEOUT_MS,
  awaitManagedDeviceForToolCall,
  findWakeableManagedDevices,
  isDeviceUnreachableResult,
  requestManagedDeviceWake,
  waitForManagedDeviceOnline,
  wakeManagedDevice,
} = await import('./managedDeviceWake');

const db = {} as unknown as LobeChatDatabase;
const caller = { db, userId: 'user-1' };
const managedRow = (deviceId: string, workspaceId: string | null = null) => ({
  deviceId,
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  workspaceId,
});
const connectedRow = (deviceId: string) => ({
  deviceId,
  identitySource: 'machine-id',
  workspaceId: null,
});
const live = (deviceId: string) => ({ deviceId, online: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAvailable.mockResolvedValue(true);
  mocks.findPersonalByDeviceId.mockResolvedValue(undefined);
  mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
  mocks.queryDeviceList.mockResolvedValue([]);
  mocks.wake.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('findWakeableManagedDevices', () => {
  it('returns nothing and reads nothing when managed devices are not available', async () => {
    mocks.isAvailable.mockResolvedValue(false);

    await expect(findWakeableManagedDevices(caller, ['managed-a'])).resolves.toEqual([]);
    expect(mocks.findPersonalByDeviceId).not.toHaveBeenCalled();
    expect(mocks.queryDeviceList).not.toHaveBeenCalled();
  });

  it('keeps only offline managed devices, using the online set it is given', async () => {
    mocks.findPersonalByDeviceId.mockImplementation(async (deviceId: string) =>
      deviceId === 'device-x' ? connectedRow(deviceId) : managedRow(deviceId),
    );

    const result = await findWakeableManagedDevices(
      caller,
      ['managed-a', 'managed-online', 'device-x', undefined, 'managed-a'],
      ['managed-online'],
    );

    expect(result).toEqual([{ deviceId: 'managed-a', scope: 'personal' }]);
    expect(mocks.queryDeviceList).not.toHaveBeenCalled();
  });

  it('asks the gateway when no online set is given', async () => {
    mocks.findPersonalByDeviceId.mockImplementation(async (deviceId: string) =>
      managedRow(deviceId),
    );
    mocks.queryDeviceList.mockResolvedValue([live('managed-online')]);

    const result = await findWakeableManagedDevices(caller, ['managed-a', 'managed-online']);

    expect(result).toEqual([{ deviceId: 'managed-a', scope: 'personal' }]);
  });

  it('addresses a workspace managed device through its workspace pool', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue(managedRow('managed-w', 'ws-1'));

    const result = await findWakeableManagedDevices({ ...caller, workspaceId: 'ws-1' }, [
      'managed-w',
    ]);

    expect(result).toEqual([{ deviceId: 'managed-w', scope: 'workspace', workspaceId: 'ws-1' }]);
    expect(mocks.queryDeviceList).toHaveBeenCalledWith('user-1', 'ws-1');
  });
});

describe('wakeManagedDevice', () => {
  it('passes the owner scope of the device to the provider and reports the acceptance', async () => {
    await expect(
      wakeManagedDevice('user-1', {
        deviceId: 'managed-w',
        scope: 'workspace',
        workspaceId: 'ws-1',
      }),
    ).resolves.toBe(true);

    expect(mocks.wake).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' }, 'managed-w');
  });

  it('logs a refused wake instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.wake.mockRejectedValue(new Error('quota'));

    await expect(
      wakeManagedDevice('user-1', { deviceId: 'managed-a', scope: 'personal' }),
    ).resolves.toBe(false);
    expect(mocks.wake).toHaveBeenCalledWith({ userId: 'user-1' }, 'managed-a');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('gives up on a wake request that hangs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.wake.mockReturnValue(new Promise(() => {}));

    const pending = wakeManagedDevice('user-1', { deviceId: 'managed-a', scope: 'personal' });
    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_WAKE_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('requestManagedDeviceWake', () => {
  it('wakes a managed device the caller can see and reports the acceptance', async () => {
    mocks.findPersonalByDeviceId.mockResolvedValue(managedRow('managed-a'));

    await expect(requestManagedDeviceWake(caller, 'managed-a')).resolves.toBe('accepted');
    expect(mocks.wake).toHaveBeenCalledWith({ userId: 'user-1' }, 'managed-a');
  });

  it('never wakes an ordinary connected device', async () => {
    mocks.findPersonalByDeviceId.mockResolvedValue(connectedRow('desktop-a'));

    await expect(requestManagedDeviceWake(caller, 'desktop-a')).resolves.toBe('not-managed');
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it('passes a refused wake to the caller', async () => {
    mocks.findPersonalByDeviceId.mockResolvedValue(managedRow('managed-a'));
    mocks.wake.mockRejectedValue(new Error('limit reached'));

    await expect(requestManagedDeviceWake(caller, 'managed-a')).rejects.toThrow('limit reached');
  });
});

describe('waitForManagedDeviceOnline', () => {
  const target = { deviceId: 'managed-a', scope: 'personal' } as const;

  it('resolves true once the device comes online within the timeout', async () => {
    vi.useFakeTimers();
    mocks.queryDeviceList
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('gateway blip'))
      .mockResolvedValueOnce([])
      .mockResolvedValue([live('managed-a')]);

    const pending = waitForManagedDeviceOnline('user-1', target);
    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS * 3);

    await expect(pending).resolves.toBe(true);
    expect(mocks.queryDeviceList).toHaveBeenCalledTimes(4);
    expect(mocks.queryDeviceList).toHaveBeenCalledWith('user-1', undefined);
  });

  it('resolves false when the device stays offline until the timeout', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pending = waitForManagedDeviceOnline('user-1', target);
    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_WAKE_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
    // One poll at the start, then one per interval until the deadline.
    expect(mocks.queryDeviceList).toHaveBeenCalledTimes(
      MANAGED_DEVICE_WAKE_TIMEOUT_MS / MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS + 1,
    );
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('ends early when the caller stops waiting', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shouldStop = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

    const pending = waitForManagedDeviceOnline('user-1', target, { shouldStop });
    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS);

    await expect(pending).resolves.toBe(false);
    expect(mocks.queryDeviceList).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('isDeviceUnreachableResult', () => {
  it('matches only failures where the device has no live connection', () => {
    expect(isDeviceUnreachableResult({ error: 'DEVICE_OFFLINE', success: false })).toBe(true);
    expect(
      isDeviceUnreachableResult({ errorData: { code: 'DEVICE_NOT_FOUND' }, success: false }),
    ).toBe(true);
    expect(isDeviceUnreachableResult({ error: 'File not found', success: false })).toBe(false);
    expect(isDeviceUnreachableResult({ error: 'DEVICE_OFFLINE', success: true })).toBe(false);
  });
});

describe('awaitManagedDeviceForToolCall', () => {
  it('waits after an accepted wake and returns DEVICE_WAKING with a retry hint', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.findPersonalByDeviceId.mockResolvedValue(managedRow('managed-a'));

    const settled = vi.fn();
    const pending = awaitManagedDeviceForToolCall(caller, 'managed-a');
    void pending.then(settled);
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).not.toHaveBeenCalled();
    expect(mocks.queryDeviceList.mock.calls.length).toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_TOOL_CALL_WAIT_MS);
    const result = await pending;

    expect(mocks.wake).toHaveBeenCalledWith({ userId: 'user-1' }, 'managed-a');
    expect(result).toMatchObject({
      error: {
        code: DEVICE_WAKING_ERROR_CODE,
        deviceId: 'managed-a',
        retryAfterSeconds: expect.any(Number),
      },
      success: false,
    });
    expect(typeof result === 'object' && result.content).toContain('Retry');
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: DEVICE_WAKING_ERROR_CODE }),
      }),
    );
    warn.mockRestore();
  });

  it('answers online when the device connects during the wait', async () => {
    vi.useFakeTimers();
    mocks.findPersonalByDeviceId.mockResolvedValue(managedRow('managed-a'));
    mocks.queryDeviceList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([live('managed-a')]);

    const pending = awaitManagedDeviceForToolCall(caller, 'managed-a');
    await vi.advanceTimersByTimeAsync(MANAGED_DEVICE_WAKE_POLL_INTERVAL_MS);

    await expect(pending).resolves.toBe('online');
  });

  it('returns at once without waiting when the provider refuses the wake', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.findPersonalByDeviceId.mockResolvedValue(managedRow('managed-a'));
    mocks.wake.mockRejectedValue(new Error('device is being deleted'));

    const settled = vi.fn();
    void awaitManagedDeviceForToolCall(caller, 'managed-a').then(settled);
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toHaveBeenCalledWith(undefined);
    expect(mocks.wake).toHaveBeenCalledOnce();
    // Only the online check before the wake; the wait loop never polls.
    expect(mocks.queryDeviceList).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    warn.mockRestore();
  });

  it('leaves ordinary devices alone', async () => {
    mocks.findPersonalByDeviceId.mockResolvedValueOnce(connectedRow('device-x'));

    await expect(awaitManagedDeviceForToolCall(caller, 'device-x')).resolves.toBeUndefined();
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});
