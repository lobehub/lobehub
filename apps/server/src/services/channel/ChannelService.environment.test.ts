// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { agentEnvironment, create, getAgent, findDevice, notify, statPath, update, wake } =
  vi.hoisted(() => ({
    agentEnvironment: vi.fn(),
    create: vi.fn(),
    findDevice: vi.fn(),
    getAgent: vi.fn(),
    notify: vi.fn(),
    statPath: vi.fn(),
    update: vi.fn(),
    wake: vi.fn(),
  }));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    agentEnvironment = agentEnvironment;
    create = create;
    updateAgentEnvironment = update;
  },
}));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findPersonalByDeviceId = findDevice;
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = getAgent;
  },
}));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { statPath } }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: notify }));
vi.mock('./queue', () => ({ wakeChannel: wake }));

describe('changing an Agent member’s channel environment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    agentEnvironment.mockResolvedValue({
      agentId: 'agent-1',
      deviceId: 'mac',
      workingDirectory: '/a',
    });
    getAgent.mockResolvedValue({ agencyConfig: { heterogeneousProvider: { type: 'codex' } } });
    findDevice.mockResolvedValue({ deviceId: 'mac', platform: 'darwin', userId: 'owner' });
    update.mockResolvedValue({ id: 'member-1' });
  });
  const service = () => new ChannelService({} as never, 'owner');

  it('saves the new directory without asking the device', async () => {
    await service().updateAgentEnvironment('channel', 'member-1', {
      deviceId: 'mac',
      workingDirectory: ' /b ',
    });

    expect(getAgent).toHaveBeenCalledWith('agent-1');
    expect(statPath).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('channel', 'member-1', {
      deviceId: 'mac',
      deviceOwnerId: 'owner',
      pendingWorkingDirectory: '/b',
    });
    expect(wake).toHaveBeenCalledWith('channel');
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'channel');
  });

  it('creates a channel while the chosen device is offline', async () => {
    // An offline device or an unconfigured gateway answers nothing.
    statPath.mockResolvedValue(undefined);
    create.mockResolvedValue({ id: 'channel' });

    await service().create({
      agents: [{ agentId: 'agent-1', deviceId: 'mac', workingDirectory: '/b' }],
      title: 'Build',
    });

    expect(statPath).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      agents: [
        {
          agentId: 'agent-1',
          config: { deviceId: 'mac', deviceOwnerId: 'owner', pendingWorkingDirectory: '/b' },
        },
      ],
      projectId: undefined,
      title: 'Build',
    });
  });

  it('keeps the old environment when a coding Agent would lose its device', async () => {
    await expect(service().updateAgentEnvironment('channel', 'member-1', {})).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );

    expect(update).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
