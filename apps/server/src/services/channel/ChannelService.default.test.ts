// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { create, getAgent, getBuiltinAgent } = vi.hoisted(() => ({
  create: vi.fn(),
  getAgent: vi.fn(),
  getBuiltinAgent: vi.fn(),
}));
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
    getBuiltinAgent = getBuiltinAgent;
  },
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

describe('the default Channel of a new workspace or project', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    create.mockResolvedValue({ channel: { id: 'chn_1' } });
    getBuiltinAgent.mockResolvedValue({ id: 'agt_lobeai', model: 'gpt-5' });
  });
  const createDefault = () =>
    new ChannelService({} as never, 'owner', 'workspace').createDefault({
      agentId: 'agt_main',
      projectId: 'pro_1',
      title: 'General',
    });

  it('seats a native main Agent next to its creator', async () => {
    getAgent.mockResolvedValue({ model: 'gpt-5' });
    await createDefault();
    expect(getBuiltinAgent).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      agents: [{ agentId: 'agt_main' }],
      projectId: 'pro_1',
      title: 'General',
    });
  });

  it.each([
    ['an external main Agent, which needs a device', { model: 'claude-code' }],
    [
      'an Agent with a heterogeneous provider',
      { agencyConfig: { heterogeneousProvider: { type: 'codex' } }, model: 'gpt-5' },
    ],
    ['a main Agent the creator cannot reach', undefined],
  ])('lets the scope LobeAI answer instead of %s', async (_, agent) => {
    getAgent.mockResolvedValue(agent);
    await createDefault();
    expect(getBuiltinAgent).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.inbox);
    expect(create).toHaveBeenCalledWith({
      agents: [{ agentId: 'agt_lobeai' }],
      projectId: 'pro_1',
      title: 'General',
    });
  });

  it('opens no Channel that nobody could answer in', async () => {
    getAgent.mockResolvedValue({ model: 'claude-code' });
    getBuiltinAgent.mockResolvedValue(null);
    await expect(createDefault()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(create).not.toHaveBeenCalled();
  });
});
