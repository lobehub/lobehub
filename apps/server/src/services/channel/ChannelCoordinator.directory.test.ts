// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { executions, getScopedOnlineDevices, statPath } = vi.hoisted(() => ({
  executions: {
    candidates: vi.fn(),
    claim: vi.fn(),
    confirmDirectory: vi.fn(),
  },
  getScopedOnlineDevices: vi.fn(),
  statPath: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: class {} }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: () => ({}) }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { statPath } }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({ getScopedOnlineDevices }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('./attachments', () => ({ resolveChannelAttachments: vi.fn() }));
vi.mock('./ChannelRoutingService', () => ({
  ChannelRoutingService: class {
    advance = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));

const pendingMember = {
  config: { deviceId: 'mac', deviceOwnerId: 'owner', pendingWorkingDirectory: '~/repo/' },
  id: 'member-1',
};

const coordinator = () => {
  const query = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), { from: vi.fn(), where: vi.fn() });
    result.from.mockReturnValue(result);
    result.where.mockReturnValue(result);
    return result;
  };
  const select = vi
    .fn()
    .mockReturnValueOnce(query([{ id: 'channel', status: 'active', workspaceId: null }]))
    .mockReturnValueOnce(query([pendingMember]));
  return new ChannelCoordinator({ select } as never);
};

describe('confirming a member directory saved without the device', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executions.candidates.mockResolvedValue({
      heads: [{ id: 'job-1', memberId: 'member-1', status: 'queued' }],
      inFlight: [],
    });
    executions.claim.mockResolvedValue(null);
  });

  it('stores the canonical path once the device is online, before claiming', async () => {
    getScopedOnlineDevices.mockResolvedValue([{ deviceId: 'mac', online: true }]);
    statPath.mockResolvedValue({ canonicalPath: '/home/u/repo', isDirectory: true });

    await coordinator().advance('channel');

    expect(statPath).toHaveBeenCalledWith({
      deviceId: 'mac',
      path: '~/repo/',
      userId: 'owner',
      workspaceId: undefined,
    });
    expect(executions.confirmDirectory).toHaveBeenCalledWith('channel', 'member-1', {
      canonicalPath: '/home/u/repo',
      deviceId: 'mac',
      pendingWorkingDirectory: '~/repo/',
    });
    expect(executions.confirmDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      executions.claim.mock.invocationCallOrder[0],
    );
  });

  it('does not ask an offline device and lets the claim wait for it', async () => {
    getScopedOnlineDevices.mockResolvedValue([{ deviceId: 'mac', online: false }]);

    await coordinator().advance('channel');

    expect(statPath).not.toHaveBeenCalled();
    expect(executions.confirmDirectory).not.toHaveBeenCalled();
    expect(executions.claim).toHaveBeenCalled();
  });

  it('leaves a directory the device cannot find pending', async () => {
    getScopedOnlineDevices.mockResolvedValue([{ deviceId: 'mac', online: true }]);
    statPath.mockResolvedValue({ exists: false, isDirectory: false });

    await coordinator().advance('channel');

    expect(executions.confirmDirectory).not.toHaveBeenCalled();
    expect(executions.claim).toHaveBeenCalled();
  });
});
