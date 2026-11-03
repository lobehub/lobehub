// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';
import { notifyChannel } from './notify';

const { create, getAgent } = vi.hoisted(() => ({ create: vi.fn(), getAgent: vi.fn() }));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    create = create;
  },
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {} }));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = getAgent;
  },
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

describe('creating a Channel with people', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_1' } });
    getAgent.mockResolvedValue({ model: 'gpt-5' });
  });
  const service = () => new ChannelService({} as never, 'owner', 'workspace');

  it('starts a group with only people and tells them about it', async () => {
    await service().create({ agents: [], title: 'Team', userIds: ['mia'] });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ agents: [], title: 'Team', userIds: ['mia'] }),
    );
    expect(notifyChannel).toHaveBeenCalledWith(expect.anything(), 'chn_1');
  });

  it('keeps an Agent-only group quiet beyond its creator', async () => {
    await service().create({ agents: [{ agentId: 'agt_1' }], title: 'Team' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userIds: [] }));
    expect(notifyChannel).not.toHaveBeenCalled();
  });

  it('starts a group with only its creator, without notifying the creator as an invitee', async () => {
    await service().create({ agents: [], title: 'Me', userIds: ['owner'] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ agents: [], userIds: [] }));
    expect(notifyChannel).not.toHaveBeenCalled();
  });
});
