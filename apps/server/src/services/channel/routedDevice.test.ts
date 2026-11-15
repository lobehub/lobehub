// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveChannelRoutedDevice } from './routedDevice';

const { findWakeableManagedDevices, loadWorkspaceMemberOverrides, resolveCanManage } = vi.hoisted(
  () => ({
    findWakeableManagedDevices: vi.fn(),
    loadWorkspaceMemberOverrides: vi.fn(),
    resolveCanManage: vi.fn(),
  }),
);
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
  });

  it('routes a local CLI Agent to the device bound in its own settings', async () => {
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice))).toBe('agent-device');
    expect(loadWorkspaceMemberOverrides).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'requester', workspaceId: 'workspace' }),
      'agt',
    );
  });

  it("follows the requester's own device for the Agent", async () => {
    loadWorkspaceMemberOverrides.mockResolvedValue({
      device: { boundDeviceId: 'requester-device', executionTarget: 'device' },
    });
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice))).toBe('requester-device');
  });

  it('needs no device for a Native Agent, a sandbox run or a device dispatch would wake', async () => {
    expect(await resolveChannelRoutedDevice(db(), run({}))).toBeUndefined();
    expect(
      await resolveChannelRoutedDevice(
        db(),
        run({ executionTarget: 'sandbox', heterogeneousProvider: { type: 'claude-code' } }),
      ),
    ).toBeUndefined();
    findWakeableManagedDevices.mockResolvedValue([{ deviceId: 'agent-device' }]);
    expect(await resolveChannelRoutedDevice(db(), run(claudeOnDevice))).toBeUndefined();
  });

  it('needs no device when the Agent is gone', async () => {
    expect(await resolveChannelRoutedDevice(db([]), run(claudeOnDevice))).toBeUndefined();
  });
});
