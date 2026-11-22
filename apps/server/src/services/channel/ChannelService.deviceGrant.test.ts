// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { addAgent, decide, devicesByUser, findAccess, getAgent, notify, statPath, wake } =
  vi.hoisted(() => ({
    addAgent: vi.fn(),
    decide: vi.fn(),
    /** Workspace devices each user can see, by their user id. */
    devicesByUser: new Map<string, Record<string, unknown>[]>(),
    findAccess: vi.fn(),
    getAgent: vi.fn(),
    notify: vi.fn(),
    statPath: vi.fn(),
    wake: vi.fn(),
  }));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    addAgent = addAgent;
    findAccess = findAccess;
  },
}));
vi.mock('@/database/repositories/channel/grants', () => ({
  decideDeviceGrant: decide,
  listDeviceGrants: vi.fn(),
}));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    constructor(
      _db: unknown,
      private readonly userId: string,
    ) {}
    findWorkspaceDeviceById = async (deviceId: string) =>
      devicesByUser.get(this.userId)?.find((device) => device.deviceId === deviceId);
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = getAgent;
  },
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceSystemInfo: vi.fn(), statPath },
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: notify }));
vi.mock('./queue', () => ({ wakeChannel: wake }));

/** The Agent row lookup `workspaceChannelDevice` makes for the Agent's owner. */
const dbWithAgentOwner = (ownerId: string) =>
  ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ userId: ownerId }] }) }),
    }),
  }) as never;

const device = (deviceId: string, userId: string, visibility: 'private' | 'public') => ({
  deviceId,
  platform: 'darwin',
  userId,
  visibility,
});

describe('picking a workspace device for a Channel Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    devicesByUser.clear();
    findAccess.mockResolvedValue({ channel: {}, member: { role: 'admin' } });
    getAgent.mockResolvedValue({ agencyConfig: { heterogeneousProvider: { type: 'codex' } } });
    statPath.mockResolvedValue({ canonicalPath: '/repo', isDirectory: true });
    addAgent.mockImplementation(async (_channelId, input) => input);
  });
  const add = (callerId: string, agentOwnerId: string, deviceId: string) =>
    new ChannelService(dbWithAgentOwner(agentOwnerId), callerId, 'ws').addAgent('chn_1', {
      agentId: 'agent-1',
      deviceId,
      workingDirectory: '/repo',
    });

  it('accepts a device shared with the workspace, owned by whoever enrolled it', async () => {
    devicesByUser.set('arvin', [device('shared', 'canis', 'public')]);
    await expect(add('arvin', 'canis', 'shared')).resolves.toMatchObject({
      config: { deviceId: 'shared', deviceOwnerId: 'canis', workingDirectory: '/repo' },
    });
  });

  it("accepts the caller's own private device", async () => {
    devicesByUser.set('canis', [device('mine', 'canis', 'private')]);
    await expect(add('canis', 'canis', 'mine')).resolves.toMatchObject({
      config: { deviceId: 'mine', deviceOwnerId: 'canis' },
    });
  });

  it("accepts the Agent owner's private device, for them to approve", async () => {
    devicesByUser.set('canis', [device('canis-mac', 'canis', 'private')]);
    await expect(add('arvin', 'canis', 'canis-mac')).resolves.toMatchObject({
      config: { deviceId: 'canis-mac', deviceOwnerId: 'canis' },
    });
  });

  it("refuses another member's private device the Agent does not belong to", async () => {
    devicesByUser.set('mia', [device('mia-mac', 'mia', 'private')]);
    await expect(add('arvin', 'canis', 'mia-mac')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(addAgent).not.toHaveBeenCalled();
  });
});

describe('deciding a device grant', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lets a reply waiting on the decision start right away', async () => {
    decide.mockResolvedValue({ channelId: 'chn_1', status: 'approved' });
    await new ChannelService({} as never, 'canis', 'ws').decideDeviceGrant('grant-1', 'approve');
    expect(decide).toHaveBeenCalledWith({}, 'canis', 'grant-1', 'approve');
    expect(wake).toHaveBeenCalledWith('chn_1');
    expect(notify).toHaveBeenCalledWith({}, 'chn_1');
  });
});
