// @vitest-environment node
import { CHANNEL_LIMITS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelError } from '@/database/repositories/channel';

import { ChannelService } from './ChannelService';

const {
  create,
  createGroupFromDirect,
  findAccess,
  findDevice,
  getAgent,
  notify,
  querySystemInfo,
  statPath,
} = vi.hoisted(() => ({
  create: vi.fn(),
  createGroupFromDirect: vi.fn(),
  findAccess: vi.fn(),
  findDevice: vi.fn(),
  getAgent: vi.fn(),
  notify: vi.fn(),
  querySystemInfo: vi.fn(),
  statPath: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    create = create;
    createGroupFromDirect = createGroupFromDirect;
    findAccess = findAccess;
  },
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {} }));
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
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

const claudeCode = { heterogeneousProvider: { type: 'claude-code' } };

describe('the direct Channel of a new Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_1' } });
    findDevice.mockImplementation(async (deviceId: string) => ({
      defaultCwd: null,
      deviceId,
      platform: 'darwin',
      userId: 'owner',
    }));
    statPath.mockImplementation(async ({ path }: { path: string }) => ({
      canonicalPath: `/real${path}`,
      isDirectory: true,
    }));
    querySystemInfo.mockResolvedValue({ homePath: '/Users/owner' });
  });
  const createDirect = (localDeviceId?: string) =>
    new ChannelService({} as never, 'owner').createDirect('agt_new', { localDeviceId });

  it.each([
    ['its personal name', { name: ' 小满 ', title: 'Health Assistant' }, '小满'],
    ['its role when it has no name', { name: '', title: 'Health Assistant' }, 'Health Assistant'],
    ['a generic label when it has neither', { name: null, title: '  ' }, 'Agent'],
    [
      'a name cut to the Channel title limit',
      { name: 'x'.repeat(CHANNEL_LIMITS.titleLength + 20) },
      'x'.repeat(CHANNEL_LIMITS.titleLength),
    ],
  ])('binds a native Agent and titles the Channel with %s', async (_, identity, title) => {
    getAgent.mockResolvedValue({ model: 'gpt-5', ...identity });
    await expect(createDirect('desktop')).resolves.toEqual({ channel: { id: 'chn_1' } });
    expect(getAgent).toHaveBeenCalledTimes(1);
    // A native Agent with no device of its own answers without one, even from a desktop.
    expect(findDevice).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_new', title });
  });

  it.each([
    [
      'its own directory on that device',
      { workingDirByDevice: { mac: { path: '/repo' } } },
      null,
      '/real/repo',
    ],
    ["the device's default directory", {}, '/projects', '/real/projects'],
    ["the device's home folder", {}, null, '/real/Users/owner'],
  ])(
    'seats an external Agent on its bound device in %s',
    async (_, directories, defaultCwd, workingDirectory) => {
      getAgent.mockResolvedValue({
        agencyConfig: { ...claudeCode, ...directories, boundDeviceId: 'mac' },
        name: 'Claude',
      });
      findDevice.mockResolvedValue({
        defaultCwd,
        deviceId: 'mac',
        platform: 'darwin',
        userId: 'owner',
      });

      await createDirect('desktop');

      expect(findDevice).toHaveBeenCalledWith('mac');
      expect(create).toHaveBeenCalledWith({
        agentConfig: { deviceId: 'mac', deviceOwnerId: 'owner', workingDirectory },
        agentId: 'agt_new',
        title: 'Claude',
      });
    },
  );

  it("seats a local external Agent on its creator's desktop", async () => {
    getAgent.mockResolvedValue({ agencyConfig: claudeCode, name: 'Claude' });
    await createDirect('desktop');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfig: {
          deviceId: 'desktop',
          deviceOwnerId: 'owner',
          workingDirectory: '/real/Users/owner',
        },
      }),
    );
  });

  it.each([
    ['a local external Agent created away from a desktop', claudeCode, undefined],
    [
      'an external Agent that runs in a sandbox',
      { ...claudeCode, executionTarget: 'sandbox' },
      'desktop',
    ],
    [
      'a runtime Channels do not support',
      { heterogeneousProvider: { type: 'openclaw' } },
      'desktop',
    ],
  ])('opens nothing for %s', async (_, agencyConfig, localDeviceId) => {
    getAgent.mockResolvedValue({ agencyConfig, name: 'Agent' });
    await expect(createDirect(localDeviceId)).resolves.toBeUndefined();
    expect(findDevice).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens nothing for an Agent the creator cannot reach', async () => {
    getAgent.mockResolvedValue(null);
    await expect(createDirect('desktop')).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a device that is not the creator’s', () => findDevice.mockResolvedValue(undefined)],
    ['a device that cannot be reached', () => statPath.mockResolvedValue(undefined)],
  ])('refuses %s rather than seat the Agent where it cannot run', async (_, arrange) => {
    getAgent.mockResolvedValue({ agencyConfig: claudeCode, name: 'Claude' });
    arrange();
    await expect(createDirect('desktop')).rejects.toBeInstanceOf(ChannelError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('inviting from a direct conversation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findAccess.mockResolvedValue({ channel: { agentId: 'agt_ada', id: 'chn_direct' } });
    createGroupFromDirect.mockResolvedValue({ channel: { id: 'chn_group' } });
    getAgent.mockResolvedValue({ model: 'gpt-5' });
  });
  const invite = () =>
    new ChannelService({} as never, 'owner', 'workspace').createGroupFromDirect('chn_direct', {
      agents: [{ agentId: 'agt_bo' }],
      title: 'Ada, Bo, Mia',
      userIds: ['user-mia'],
    });

  it('starts the group with the invited Agents resolved, then tells its members', async () => {
    await expect(invite()).resolves.toEqual({ channel: { id: 'chn_group' } });
    expect(getAgent).toHaveBeenCalledWith('agt_bo');
    expect(createGroupFromDirect).toHaveBeenCalledWith('chn_direct', {
      agents: [{ agentId: 'agt_bo', config: {}, description: undefined, name: undefined }],
      title: 'Ada, Bo, Mia',
      userIds: ['user-mia'],
    });
    expect(notify).toHaveBeenCalledWith({}, 'chn_group');
  });

  it('probes nothing for a conversation the caller cannot reach', async () => {
    findAccess.mockResolvedValue(undefined);
    await expect(invite()).rejects.toBeInstanceOf(ChannelError);
    expect(getAgent).not.toHaveBeenCalled();
    expect(createGroupFromDirect).not.toHaveBeenCalled();
  });
});
