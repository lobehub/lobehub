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
const presence = () => createRoutedDevicePresence({} as never);
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

  it("checks a continued conversation's device, not the binding it supersedes", async () => {
    // The requester moved their own binding to an offline device after a run on `device-1`.
    pools([online('device-1')]);
    loadWorkspaceMemberOverrides.mockResolvedValue({
      device: { boundDeviceId: 'offline-device', executionTarget: 'device' },
    });
    const continued = {
      ...run(claudeOnDevice),
      continuation: { agentId: 'agt', metadata: { boundDeviceId: 'device-1' } } as never,
    };
    expect(await resolveChannelRoutedDevice(db(), continued, presence())).toEqual({
      deviceId: 'device-1',
      online: true,
    });
  });

  it('keeps the binding when the workspace fixes the target or the pin was an auto pick', async () => {
    const pinned = { agentId: 'agt', metadata: { boundDeviceId: 'device-1' } } as never;
    const fixed = { ...claudeOnDevice, executionTargetSelectionPolicy: 'fixed' };
    expect(
      await resolveChannelRoutedDevice(db(), { ...run(fixed), continuation: pinned }, presence()),
    ).toEqual({ deviceId: 'agent-device', online: false });
    const auto = { ...claudeOnDevice, executionTarget: 'auto' };
    expect(
      (await resolveChannelRoutedDevice(db(), { ...run(auto), continuation: pinned }, presence()))
        ?.deviceId,
    ).not.toBe('device-1');
  });

  it('leaves a project-directory conversation to the run', async () => {
    const continued = {
      ...run(claudeOnDevice),
      continuation: { agentId: 'agt', metadata: {}, projectWorkingDirectoryId: 'dir' } as never,
    };
    expect(await resolveChannelRoutedDevice(db(), continued, presence())).toBeUndefined();
  });

  // A shared Agent runs as its owner in the owner's scope; the visitor's Channel may sit in a
  // workspace the owner's device was never in.
  it("checks a shared Agent's device in the owner's scope, not the visitor Channel's", async () => {
    getScopedOnlineDevices.mockImplementation(async (_db, userId: string, scope?: string) =>
      userId === 'owner' && !scope ? [online('agent-device')] : [],
    );
    expect(
      await resolveChannelRoutedDevice(
        db(),
        { ...run(claudeOnDevice), userId: 'owner', workspaceId: null },
        presence(),
      ),
    ).toEqual({ deviceId: 'agent-device', online: true });
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
    await cache.prefetch('requester', 'workspace');
    expect(await cache.isOnline('requester', 'personal-laptop', 'workspace')).toBe(true);
    expect(await cache.isOnline('requester', 'device-1', 'workspace')).toBe(true);
    expect(await cache.isOnline('requester', 'missing', 'workspace')).toBe(false);
    expect(getScopedOnlineDevices).toHaveBeenCalledTimes(2);
  });

  it('uses only the personal pool for a personal run', async () => {
    pools([online('device-1')], [online('personal-laptop')]);
    const cache = presence();
    expect(await cache.isOnline('requester', 'device-1', null)).toBe(false);
    expect(await cache.isOnline('requester', 'personal-laptop', null)).toBe(true);
  });
});
