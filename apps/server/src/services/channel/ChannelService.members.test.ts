// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';
import { notifyChannel } from './notify';

const { create, findAccess, getAgent, moveToSection, setPinned } = vi.hoisted(() => ({
  create: vi.fn(),
  findAccess: vi.fn(),
  getAgent: vi.fn(),
  moveToSection: vi.fn(),
  setPinned: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    create = create;
    findAccess = findAccess;
    moveToSection = moveToSection;
    setPinned = setPinned;
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

describe('pinning or filing an open project Channel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  const service = () => new ChannelService({} as never, 'mia', 'workspace');

  it('tells its members about a teammate who joins it by pinning', async () => {
    const pinnedAt = new Date();
    setPinned.mockResolvedValue(pinnedAt);

    expect(await service().setPinned('chn_1', true)).toBe(pinnedAt);
    expect(setPinned).toHaveBeenCalledWith('chn_1', true);
    expect(notifyChannel).toHaveBeenCalledWith(expect.anything(), 'chn_1');
  });

  it('tells its members about a teammate who joins it by filing it under a section', async () => {
    moveToSection.mockResolvedValue('sec_1');

    expect(await service().moveToSection('chn_1', 'sec_1')).toBe('sec_1');
    expect(notifyChannel).toHaveBeenCalledWith(expect.anything(), 'chn_1');
  });

  it("keeps a member's own pin, section and unpin quiet", async () => {
    findAccess.mockResolvedValue({ channel: { id: 'chn_1' }, member: { id: 'mem_1' } });

    await service().setPinned('chn_1', true);
    await service().moveToSection('chn_1', 'sec_1');
    await service().setPinned('chn_1', false);
    await service().moveToSection('chn_1', null);

    expect(notifyChannel).not.toHaveBeenCalled();
  });

  it('notifies nobody when the write is refused', async () => {
    setPinned.mockRejectedValue(new Error('NOT_FOUND'));

    await expect(service().setPinned('chn_1', true)).rejects.toThrow('NOT_FOUND');
    expect(notifyChannel).not.toHaveBeenCalled();
  });
});
