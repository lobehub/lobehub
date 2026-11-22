// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { addAgent, addProjectAgent, create, findAccess, findProject, getAgent, hasAgent } =
  vi.hoisted(() => ({
    addAgent: vi.fn(),
    addProjectAgent: vi.fn(),
    create: vi.fn(),
    findAccess: vi.fn(),
    findProject: vi.fn(),
    getAgent: vi.fn(),
    hasAgent: vi.fn(),
  }));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    addAgent = addAgent;
    create = create;
    findAccess = findAccess;
  },
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: class {
    addAgent = addProjectAgent;
    findById = findProject;
    hasAgent = hasAgent;
  },
}));
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

describe('creating a Channel inside a project', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_1' } });
    getAgent.mockResolvedValue({ model: 'gpt-5' });
    hasAgent.mockResolvedValue(true);
  });
  const service = () => new ChannelService({} as never, 'owner', 'workspace');
  const agents = [{ agentId: 'agt_1' }];

  it('groups the Channel under a project the caller can read', async () => {
    findProject.mockResolvedValue({ id: 'pro_1' });
    await service().create({ agents, projectId: 'pro_1', title: 'Launch' });
    expect(findProject).toHaveBeenCalledWith('pro_1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'pro_1', title: 'Launch' }),
    );
  });

  it('rejects a project outside the caller’s scope before creating anything', async () => {
    findProject.mockResolvedValue(undefined);
    await expect(
      service().create({ agents, projectId: 'pro_other', title: 'Launch' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getAgent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a Channel without a project standalone', async () => {
    await service().create({ agents, title: 'Launch' });
    expect(findProject).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
  });
});

describe('seating Agents in a project Channel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_1' } });
    getAgent.mockResolvedValue({ model: 'gpt-5' });
    findProject.mockResolvedValue({ id: 'pro_1' });
    findAccess.mockResolvedValue({
      channel: { id: 'chn_1', projectId: 'pro_1' },
      member: { role: 'owner' },
    });
    addAgent.mockResolvedValue({ id: 'member_1' });
  });
  const service = (options = {}) => new ChannelService({} as never, 'owner', 'workspace', options);

  it('adds a project member Agent without touching the project', async () => {
    hasAgent.mockResolvedValue(true);
    await service().addAgent('chn_1', { agentId: 'agt_1' });
    expect(addProjectAgent).not.toHaveBeenCalled();
    expect(addAgent).toHaveBeenCalledWith('chn_1', expect.objectContaining({ agentId: 'agt_1' }));
  });

  it('asks for the project first when an outside Agent comes without consent', async () => {
    hasAgent.mockResolvedValue(false);
    await expect(service().addAgent('chn_1', { agentId: 'agt_2' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(addProjectAgent).not.toHaveBeenCalled();
    expect(addAgent).not.toHaveBeenCalled();
  });

  it('seats an outside Agent in the project first, then the Channel', async () => {
    hasAgent.mockResolvedValue(false);
    addProjectAgent.mockResolvedValue({ id: 'binding_1' });
    await service().addAgent('chn_1', { agentId: 'agt_2' }, { joinProject: true });
    expect(addProjectAgent).toHaveBeenCalledWith('pro_1', { agentId: 'agt_2' });
    expect(addAgent).toHaveBeenCalled();
    expect(addProjectAgent.mock.invocationCallOrder[0]).toBeLessThan(
      addAgent.mock.invocationCallOrder[0],
    );
  });

  it('refuses when the caller cannot manage the project’s members', async () => {
    hasAgent.mockResolvedValue(false);
    addProjectAgent.mockResolvedValue(null);
    await expect(
      service().addAgent('chn_1', { agentId: 'agt_2' }, { joinProject: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(addAgent).not.toHaveBeenCalled();

    await expect(
      service({ readOnly: true }).addAgent('chn_1', { agentId: 'agt_2' }, { joinProject: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not let a plain Channel member seat an Agent in the project', async () => {
    findAccess.mockResolvedValue({
      channel: { id: 'chn_1', projectId: 'pro_1' },
      member: { role: 'member' },
    });
    hasAgent.mockResolvedValue(false);
    await expect(
      service().addAgent('chn_1', { agentId: 'agt_2' }, { joinProject: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(addProjectAgent).not.toHaveBeenCalled();
  });

  it('seats outside Agents of a new project Channel before creating it', async () => {
    hasAgent.mockImplementation(async (_projectId: string, agentId: string) => agentId === 'agt_1');
    addProjectAgent.mockResolvedValue({ id: 'binding_2' });
    await service().create({
      agents: [{ agentId: 'agt_1' }, { agentId: 'agt_2' }],
      joinProject: true,
      projectId: 'pro_1',
      title: 'Launch',
    });
    expect(addProjectAgent).toHaveBeenCalledTimes(1);
    expect(addProjectAgent).toHaveBeenCalledWith('pro_1', { agentId: 'agt_2' });
    expect(create).toHaveBeenCalled();
  });
});
