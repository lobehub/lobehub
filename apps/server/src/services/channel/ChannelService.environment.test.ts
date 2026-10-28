// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const {
  agentEnvironment,
  create,
  getAgent,
  findDevice,
  notify,
  querySystemInfo,
  statPath,
  update,
  wake,
} = vi.hoisted(() => ({
  agentEnvironment: vi.fn(),
  create: vi.fn(),
  findDevice: vi.fn(),
  getAgent: vi.fn(),
  notify: vi.fn(),
  querySystemInfo: vi.fn(),
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
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceSystemInfo: querySystemInfo, statPath },
}));
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
    statPath.mockResolvedValue({ canonicalPath: '/real/b', isDirectory: true });
    update.mockResolvedValue({ id: 'member-1' });
  });
  const service = () => new ChannelService({} as never, 'owner');

  it('validates the new directory on the device and stores its canonical path', async () => {
    await service().updateAgentEnvironment('channel', 'member-1', {
      deviceId: 'mac',
      workingDirectory: '/b',
    });

    expect(getAgent).toHaveBeenCalledWith('agent-1');
    expect(update).toHaveBeenCalledWith('channel', 'member-1', {
      deviceId: 'mac',
      deviceOwnerId: 'owner',
      workingDirectory: '/real/b',
    });
    expect(wake).toHaveBeenCalledWith('channel');
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'channel');
  });

  it('keeps the old environment when a coding Agent would lose its device', async () => {
    await expect(service().updateAgentEnvironment('channel', 'member-1', {})).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );

    expect(update).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('creates a member in the device home folder when the Agent has no directory there', async () => {
    querySystemInfo.mockResolvedValue({ homePath: '/Users/me' });
    statPath.mockResolvedValue({ canonicalPath: '/Users/me', isDirectory: true });

    await service().create({ agents: [{ agentId: 'agent-1', deviceId: 'mac' }], title: 'c' });

    expect(querySystemInfo).toHaveBeenCalledWith('owner', 'mac', undefined);
    expect(statPath).toHaveBeenCalledWith(expect.objectContaining({ path: '/Users/me' }));
    expect(create).toHaveBeenCalledWith({
      agents: [
        {
          agentId: 'agent-1',
          config: { deviceId: 'mac', deviceOwnerId: 'owner', workingDirectory: '/Users/me' },
        },
      ],
      projectId: undefined,
      title: 'c',
    });
  });

  it('still asks for a directory when the device cannot report its home folder', async () => {
    querySystemInfo.mockResolvedValue(undefined);

    await expect(
      service().create({ agents: [{ agentId: 'agent-1', deviceId: 'mac' }], title: 'c' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(create).not.toHaveBeenCalled();
  });
});
