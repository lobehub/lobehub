// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRoutedDevicePresence, resolveChannelRoutedDevice } from './routedDevice';

const {
  findWakeableManagedDevices,
  getScopedOnlineDevices,
  loadWorkspaceMemberOverrides,
  resolveCanManage,
} = vi.hoisted(() => ({
  findWakeableManagedDevices: vi.fn(),
  getScopedOnlineDevices: vi.fn(),
  loadWorkspaceMemberOverrides: vi.fn(),
  resolveCanManage: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({ getScopedOnlineDevices }));
vi.mock('@/server/services/aiAgent/pipeline/resolveRunAgentConfig', () => ({
  loadWorkspaceMemberOverrides,
  resolveCanManage,
}));
vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  findWakeableManagedDevices,
}));

const agentRow = { userId: 'author', visibility: 'public', workspaceId: 'workspace' };
const db = (rows: unknown[] = [agentRow]) => {
  const result = Object.assign(Promise.resolve(rows), { from: vi.fn(), where: vi.fn() });
  result.from.mockReturnValue(result);
  result.where.mockReturnValue(result);
  return { select: vi.fn(() => result) } as never;
};
const run = (agencyConfig: Record<string, unknown>) => ({
  agentId: 'agt',
  executionConfig: { agencyConfig } as never,
  userId: 'requester',
  workspaceId: 'workspace',
});
const online = (deviceId: string) => ({ deviceId, online: true });
/** Pools by scope: `workspace` for the Channel's workspace, `personal` without one. */
const pools = (workspace: unknown[], personal: unknown[] = []) =>
  getScopedOnlineDevices.mockImplementation(async (_db, _userId, scope?: string) =>
    scope ? workspace : personal,
  );
const presence = () => createRoutedDevicePresence({} as never, 'workspace');
const claudeOnDevice = {
  boundDeviceId: 'agent-device',
  executionTarget: 'device',
  heterogeneousProvider: { type: 'claude-code' },
};

describe('resolveChannelRoutedDevice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadWorkspaceMemberOverrides.mockResolvedValue({});
    resolveCanManage.mockResolvedValue(false);
    findWakeableManagedDevices.mockResolvedValue([]);
    pools([]);
  });

  it('routes a local CLI Agent to the device bound in its own settings', async () => {
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice), presence())).toEqual({
      deviceId: 'agent-device',
      online: false,
    });
    expect(loadWorkspaceMemberOverrides).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'requester', workspaceId: 'workspace' }),
      'agt',
    );
  });

  it("follows the requester's own device for the Agent", async () => {
    loadWorkspaceMemberOverrides.mockResolvedValue({
      device: { boundDeviceId: 'requester-device', executionTarget: 'device' },
    });
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice), presence())).toEqual({
      deviceId: 'requester-device',
      online: false,
    });
  });

  it('needs no device for a Native Agent, a sandbox run or a device dispatch would wake', async () => {
    expect(await resolveChannelRoutedDevice(db(), run({}), presence())).toBeUndefined();
    expect(
      await resolveChannelRoutedDevice(
        db(),
        run({ executionTarget: 'sandbox', heterogeneousProvider: { type: 'claude-code' } }),
        presence(),
      ),
    ).toBeUndefined();
    findWakeableManagedDevices.mockResolvedValue([{ deviceId: 'agent-device' }]);
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice), presence())).toBeUndefined();
  });

  it('needs no device when the Agent is gone', async () => {
    expect(
      await resolveChannelRoutedDevice(db([]), run(claudeOnDevice), presence()),
    ).toBeUndefined();
  });

  it("sees the requester's routed personal device online in a workspace Channel", async () => {
    pools([online('device-1')], [online('personal-laptop'), online('other-laptop')]);
    loadWorkspaceMemberOverrides.mockResolvedValue({
      device: { boundDeviceId: 'personal-laptop', executionTarget: 'device' },
    });
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice), presence())).toEqual({
      deviceId: 'personal-laptop',
      online: true,
    });
  });

  it('reports the routed device offline when neither pool has it', async () => {
    pools([online('device-1')], [online('other-laptop')]);
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice), presence())).toEqual({
      deviceId: 'agent-device',
      online: false,
    });
  });
});

describe('createRoutedDevicePresence', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reads each pool once per requester and only asks about the routed device', async () => {
    pools([online('device-1')], [online('personal-laptop')]);
    const cache = presence();
    await cache.prefetch('requester');
    expect(await cache.isOnline('requester', 'personal-laptop')).toBe(true);
    expect(await cache.isOnline('requester', 'device-1')).toBe(true);
    expect(await cache.isOnline('requester', 'missing')).toBe(false);
    expect(getScopedOnlineDevices).toHaveBeenCalledTimes(2);
  });

  it('uses only the personal pool for a personal Channel', async () => {
    pools([online('device-1')], [online('personal-laptop')]);
    const cache = createRoutedDevicePresence({} as never, null);
    expect(await cache.isOnline('requester', 'device-1')).toBe(false);
    expect(await cache.isOnline('requester', 'personal-laptop')).toBe(true);
  });
});
