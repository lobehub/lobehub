// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { create, findProject, getAgent } = vi.hoisted(() => ({
  create: vi.fn(),
  findProject: vi.fn(),
  getAgent: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    create = create;
  },
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: class {
    findById = findProject;
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
