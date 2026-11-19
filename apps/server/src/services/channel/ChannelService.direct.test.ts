// @vitest-environment node
import { CHANNEL_LIMITS } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelError } from '@/database/repositories/channel';

import { ChannelService } from './ChannelService';

const {
  contactScope,
  create,
  createGroupFromDirect,
  findAccess,
  findDevice,
  findDirectAccess,
  findProjectMainChannelId,
  findShare,
  findSharedAgent,
  getAgent,
  notify,
  querySystemInfo,
  statPath,
} = vi.hoisted(() => ({
  contactScope: vi.fn(),
  create: vi.fn(),
  createGroupFromDirect: vi.fn(),
  findAccess: vi.fn(),
  findDevice: vi.fn(),
  findDirectAccess: vi.fn(),
  findProjectMainChannelId: vi.fn(),
  findShare: vi.fn(),
  findSharedAgent: vi.fn(),
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
    findDirectAccess = findDirectAccess;
  },
}));
vi.mock('@/database/repositories/channel/projectMainChannel', () => ({
  findProjectMainChannelId,
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {} }));
vi.mock('@/database/models/contact', async (original) => ({
  ...(await original<object>()),
  ContactModel: class {
    constructor(_db: unknown, userId: string, workspaceId?: string) {
      contactScope(userId, workspaceId);
    }
    findAgentAccess = findSharedAgent;
  },
}));
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: { findBySlugOrId: findShare },
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
  const createDirect = () => new ChannelService({} as never, 'owner').createDirect('agt_new');

  it.each([
    ['its personal name', { name: ' 小满 ', title: 'Health Assistant' }, '小满'],
    ['its role when it has no name', { name: '', title: 'Health Assistant' }, 'Health Assistant'],
    ['a generic label when it has neither', { name: null, title: '  ' }, 'Agent'],
    [
      'a name cut to the Channel title limit',
      { name: 'x'.repeat(CHANNEL_LIMITS.titleLength + 20) },
      'x'.repeat(CHANNEL_LIMITS.titleLength),
    ],
  ])('titles the Channel with %s', async (_, identity, title) => {
    getAgent.mockResolvedValue({ model: 'gpt-5', ...identity });
    await expect(createDirect()).resolves.toEqual({ channel: { id: 'chn_1' } });
    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_new', title });
  });

  // A Channel binds no device by default: the Agent runs where its own settings say. Opening the
  // conversation used to probe the bound device and failed while it was offline.
  it.each([
    ['a native Agent bound to a device', { boundDeviceId: 'mac', executionTarget: 'device' }],
    [
      'an external Agent bound to a device with a directory',
      { ...claudeCode, boundDeviceId: 'mac', workingDirByDevice: { mac: { path: '/repo' } } },
    ],
    ['a local external Agent', claudeCode],
    ['an external Agent that runs in a sandbox', { ...claudeCode, executionTarget: 'sandbox' }],
  ])('opens %s without binding or probing a device', async (_, agencyConfig) => {
    getAgent.mockResolvedValue({ agencyConfig, model: 'gpt-5', name: 'Windy' });

    await expect(createDirect()).resolves.toEqual({ channel: { id: 'chn_1' } });

    expect(findDevice).not.toHaveBeenCalled();
    expect(statPath).not.toHaveBeenCalled();
    expect(querySystemInfo).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_new', title: 'Windy' });
  });

  it.each(['hermes', 'openclaw'])('opens a remote %s Agent without a device', async (type) => {
    getAgent.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: { type } },
      name: 'Agent',
    });
    await expect(createDirect()).resolves.toEqual({ channel: { id: 'chn_1' } });
    expect(findDevice).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_new', title: 'Agent' });
  });

  it('opens nothing for an unknown runtime', async () => {
    getAgent.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: { type: 'unknown-cli' } },
      name: 'Agent',
    });
    await expect(createDirect()).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens nothing for an Agent the creator cannot reach', async () => {
    getAgent.mockResolvedValue(null);
    await expect(createDirect()).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens a contact’s shared Agent in a personal conversation without a device', async () => {
    getAgent.mockResolvedValue(null);
    findSharedAgent.mockResolvedValue({ name: null, ownerId: 'other', title: 'Shared Helper' });
    await createDirect();
    expect(create).toHaveBeenCalledWith({
      agentConfig: {},
      agentId: 'agt_new',
      sharedAgent: true,
      title: 'Shared Helper',
    });
  });

  it('opens a shared Agent added in a workspace in that workspace', async () => {
    getAgent.mockResolvedValue(null);
    findSharedAgent.mockResolvedValue({ name: null, ownerId: 'other', title: 'Shared Helper' });
    await new ChannelService({} as never, 'owner', 'ws_1').createDirect('agt_1');
    // The entry is looked up among those added in this workspace.
    expect(contactScope).toHaveBeenCalledWith('owner', 'ws_1');
    expect(create).toHaveBeenCalledWith({
      agentConfig: {},
      agentId: 'agt_1',
      sharedAgent: true,
      title: 'Shared Helper',
    });
  });
});

describe('opening the direct Channel of an existing Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_new' } });
    getAgent.mockResolvedValue({ model: 'gpt-5', name: 'Nasa' });
  });
  const openDirect = () => new ChannelService({} as never, 'owner').openDirect('agt_old');

  it('reuses the existing conversation without probing its device again', async () => {
    findDirectAccess.mockResolvedValue({ channel: { id: 'chn_old', isDeleted: null } });
    await expect(openDirect()).resolves.toEqual({ channel: { id: 'chn_old', isDeleted: null } });
    expect(findDirectAccess).toHaveBeenCalledWith('agt_old');
    expect(getAgent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves a conversation the person moved to the trash there', async () => {
    findDirectAccess.mockResolvedValue({ channel: { id: 'chn_old', isDeleted: true } });
    await expect(openDirect()).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens one for an Agent made before direct Channels', async () => {
    findDirectAccess.mockResolvedValue(undefined);
    await expect(openDirect()).resolves.toEqual({ channel: { id: 'chn_new' } });
    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_old', title: 'Nasa' });
  });
});

describe('opening an Agent from the contacts or Agent list', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_new' } });
    getAgent.mockResolvedValue({ model: 'gpt-5', name: 'Apollo' });
  });
  const openAgent = () => new ChannelService({} as never, 'owner', 'ws').openAgent('agt_main');

  // Creating a project used to leave two conversations with its main Agent in the list: the
  // project's General Channel and a direct conversation opened on the first click.
  it("opens a project's main Agent in the project's Channel without a direct conversation", async () => {
    findDirectAccess.mockResolvedValue(undefined);
    findProjectMainChannelId.mockResolvedValue('chn_general');

    await expect(openAgent()).resolves.toBe('chn_general');

    expect(findProjectMainChannelId).toHaveBeenCalledWith({}, 'owner', 'ws', 'agt_main');
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a direct conversation the person already has with that Agent', async () => {
    findDirectAccess.mockResolvedValue({ channel: { id: 'chn_dm', isDeleted: null } });

    await expect(openAgent()).resolves.toBe('chn_dm');

    expect(findProjectMainChannelId).not.toHaveBeenCalled();
  });

  it('opens a direct conversation for an Agent that leads no project', async () => {
    findDirectAccess.mockResolvedValue(undefined);
    findProjectMainChannelId.mockResolvedValue(undefined);

    await expect(openAgent()).resolves.toBe('chn_new');

    expect(create).toHaveBeenCalledWith({ agentConfig: {}, agentId: 'agt_main', title: 'Apollo' });
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

describe('opening another person’s Agent from its share', () => {
  const share = {
    agentId: 'agt_shared',
    agentName: null,
    agentTitle: 'Shared Helper',
    ownerId: 'other',
    visibility: 'link',
  };
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_shared' } });
    findShare.mockResolvedValue(share);
  });
  const openShared = (input: string, workspaceId?: string) =>
    new ChannelService({} as never, 'me', workspaceId).openShared(input);

  it('opens a direct conversation from a pasted link without any contact entry', async () => {
    await openShared('https://app.lobehub.com/a/shared-helper');
    expect(findShare).toHaveBeenCalledWith(expect.anything(), 'shared-helper');
    expect(findSharedAgent).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      agentConfig: {},
      agentId: 'agt_shared',
      sharedAgent: true,
      title: 'Shared Helper',
    });
  });

  it('reopens the existing conversation', async () => {
    findDirectAccess.mockResolvedValue({ channel: { id: 'chn_old', isDeleted: false } });
    await expect(openShared('shared-helper')).resolves.toMatchObject({
      channel: { id: 'chn_old' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a paused share', { ...share, visibility: 'private' }],
    ['a missing share', null],
  ])('refuses %s', async (_, found) => {
    findShare.mockResolvedValue(found);
    await expect(openShared('shared-helper')).rejects.toThrow('Agent not found');
    expect(create).not.toHaveBeenCalled();
  });

  it('opens in a workspace as well', async () => {
    await expect(openShared('shared-helper', 'ws_1')).resolves.toMatchObject({
      channel: { id: 'chn_shared' },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sharedAgent: true }));
  });
});
