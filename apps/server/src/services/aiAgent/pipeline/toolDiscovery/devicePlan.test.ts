import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDevicePlan } from './devicePlan';

const mocks = vi.hoisted(() => ({
  deviceSystemInfo: vi.fn(),
  findWakeableManagedDevices: vi.fn(),
  updateMessage: vi.fn(),
  wakeManagedDevice: vi.fn(),
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  afterUnscoped: (work: () => unknown) => work(),
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  findWakeableManagedDevices: mocks.findWakeableManagedDevices,
  wakeManagedDevice: mocks.wakeManagedDevice,
}));

const deps = {
  db: {},
  messageModel: { update: mocks.updateMessage },
  userId: 'user-1',
} as any;

const ctx = (agencyConfig: Record<string, unknown>) =>
  ({
    agentConfig: { agencyConfig },
    assistantMessageId: 'asst-1',
    canUseDevice: true,
    runFacts: { deviceSystemInfo: mocks.deviceSystemInfo },
    topicId: 'topic-1',
  }) as any;

const input = (overrides: Record<string, unknown> = {}) =>
  ({
    isFixedDeviceTarget: false,
    ...overrides,
  }) as any;

const online = (deviceId: string) => ({
  deviceId,
  hostname: deviceId,
  lastSeen: '2026-01-01T00:00:00.000Z',
  online: true,
  platform: 'linux',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findWakeableManagedDevices.mockResolvedValue([]);
  mocks.wakeManagedDevice.mockResolvedValue(true);
  mocks.deviceSystemInfo.mockResolvedValue({ supportedTools: [] });
});

describe('resolveDevicePlan — managed cloud devices', () => {
  it('wakes an offline bound managed device and keeps the run on it', async () => {
    mocks.findWakeableManagedDevices.mockResolvedValue([
      { deviceId: 'managed-a', scope: 'personal' },
    ]);

    const result = await resolveDevicePlan(
      deps,
      ctx({ boundDeviceId: 'managed-a', executionTarget: 'device' }),
      input(),
      {
        boundDeviceId: 'managed-a',
        gatewayConfigured: true,
        onlineDevices: [online('device-b')],
      },
    );

    expect(mocks.findWakeableManagedDevices).toHaveBeenCalledWith(
      { db: deps.db, userId: 'user-1', workspaceId: undefined },
      [undefined, 'managed-a', undefined],
      ['device-b'],
    );
    expect(result.executionPlan).toEqual({
      deviceId: 'managed-a',
      kind: 'device-wakeable',
      target: 'device',
    });
    expect(mocks.wakeManagedDevice).toHaveBeenCalledWith('user-1', {
      deviceId: 'managed-a',
      scope: 'personal',
    });
    // The waking device is bound by the operation, never probed on the request path.
    expect(result.activeDeviceId).toBeUndefined();
    expect(result.activeDeviceScope).toBe('personal');
    expect(mocks.deviceSystemInfo).not.toHaveBeenCalled();
    expect(result.deviceCapable).toBe(true);
    expect(result.deviceLocked).toBe(true);
  });

  it('does not fail a fixed device target while its managed device wakes', async () => {
    mocks.findWakeableManagedDevices.mockResolvedValue([
      { deviceId: 'managed-a', scope: 'personal' },
    ]);

    const result = await resolveDevicePlan(
      deps,
      ctx({
        boundDeviceId: 'managed-a',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      }),
      input({ isFixedDeviceTarget: true }),
      {
        boundDeviceId: 'managed-a',
        gatewayConfigured: true,
        onlineDevices: [],
      },
    );

    expect(result.executionPlan.kind).toBe('device-wakeable');
    expect(mocks.updateMessage).not.toHaveBeenCalled();
  });

  it('keeps an offline ordinary device unrouted and wakes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveDevicePlan(
      deps,
      ctx({ boundDeviceId: 'device-x', executionTarget: 'device' }),
      input(),
      {
        boundDeviceId: 'device-x',
        gatewayConfigured: true,
        onlineDevices: [],
      },
    );

    expect(result.executionPlan).toEqual({
      kind: 'device-unrouted',
      reason: 'bound-device-offline',
      target: 'device',
    });
    expect(mocks.wakeManagedDevice).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not look for managed devices when the sender may not use a device', async () => {
    await resolveDevicePlan(
      deps,
      { ...ctx({ boundDeviceId: 'managed-a', executionTarget: 'device' }), canUseDevice: false },
      input(),
      {
        boundDeviceId: 'managed-a',
        gatewayConfigured: true,
        onlineDevices: [],
      },
    );

    expect(mocks.findWakeableManagedDevices).not.toHaveBeenCalled();
    expect(mocks.wakeManagedDevice).not.toHaveBeenCalled();
  });
});
