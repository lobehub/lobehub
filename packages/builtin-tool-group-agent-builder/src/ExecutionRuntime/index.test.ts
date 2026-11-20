import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupAgentBuilderExecutionRuntime } from './index';

const {
  mockCreateAgentOnly,
  mockGetGroupById,
  mockGetGroupDetail,
  mockQueryAgents,
  mockRefreshGroupDetail,
} = vi.hoisted(() => ({
  mockCreateAgentOnly: vi.fn(),
  mockGetGroupById: vi.fn(),
  mockGetGroupDetail: vi.fn(),
  mockQueryAgents: vi.fn(),
  mockRefreshGroupDetail: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  agentService: { createAgentOnly: mockCreateAgentOnly, queryAgents: mockQueryAgents },
}));
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: { getGroupDetail: mockGetGroupDetail },
}));
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: vi.fn() } }));
vi.mock('@/store/agentGroup', () => ({
  getChatGroupStoreState: () => ({ refreshGroupDetail: mockRefreshGroupDetail }),
}));
vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: { getGroupById: (id: string) => () => mockGetGroupById(id) },
}));
vi.mock('@/store/groupProfile', () => ({ useGroupProfileStore: { getState: vi.fn() } }));

describe('GroupAgentBuilderExecutionRuntime.searchAgent', () => {
  beforeEach(() => {
    mockQueryAgents.mockReset();
  });

  it('shows the agent name alongside its title so a named agent is recognizable', async () => {
    mockQueryAgents.mockResolvedValue([
      { description: null, id: 'agt_dario', name: 'Dario 任务队列版', title: '美国100刀' },
      { description: 'Writes code', id: 'agt_plain', name: null, title: 'Coder' },
    ]);

    const result = await new GroupAgentBuilderExecutionRuntime().searchAgent({ query: 'dario' });

    expect(result.content).toContain('1. Dario 任务队列版 [title: 美国100刀] (ID: agt_dario)');
    expect(result.content).toContain('2. Coder (ID: agt_plain) - Writes code');
    expect(result.state.agents[0]).toMatchObject({ name: 'Dario 任务队列版', title: '美国100刀' });
  });
});

describe('GroupAgentBuilderExecutionRuntime.createAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGroupById.mockReturnValue({ agents: [], id: 'cg_1' });
  });

  // The model reads `content`, not `state`: a group-built member is virtual and
  // invisible to searchAgent, so the reply must carry the id.
  it('puts the new agent id in the model-facing content', async () => {
    mockCreateAgentOnly.mockResolvedValue({ agentId: 'agt_new' });

    const result = await new GroupAgentBuilderExecutionRuntime().createAgent('cg_1', {
      systemRole: 'x',
      title: 'Note Keeper',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('(ID: agt_new)');
    expect(result.state).toMatchObject({ agentId: 'agt_new' });
  });
});

describe('GroupAgentBuilderExecutionRuntime.listGroupMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const roster = {
    agents: [
      { description: null, id: 'agt_sup', isSupervisor: true, name: null, title: 'Host' },
      {
        description: 'Keeps the vault tidy',
        id: 'agt_notes',
        isSupervisor: false,
        name: 'Nora',
        title: 'Note Keeper',
      },
    ],
    id: 'cg_1',
  };

  it('lists members with their ids from the loaded group', async () => {
    mockGetGroupById.mockReturnValue(roster);

    const result = await new GroupAgentBuilderExecutionRuntime().listGroupMembers('cg_1');

    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ groupId: 'cg_1', total: 2 });
    expect(result.content).toContain('1. Host (ID: agt_sup, supervisor)');
    expect(result.content).toContain(
      '2. Nora [title: Note Keeper] (ID: agt_notes) - Keeps the vault tidy',
    );
  });

  it('fetches a group the store has not loaded', async () => {
    mockGetGroupById.mockReturnValue(undefined);
    mockGetGroupDetail.mockResolvedValue(roster);

    const result = await new GroupAgentBuilderExecutionRuntime().listGroupMembers('cg_1');

    expect(mockGetGroupDetail).toHaveBeenCalledWith('cg_1');
    expect(result.state).toMatchObject({ total: 2 });
  });

  it('reports a missing group', async () => {
    mockGetGroupById.mockReturnValue(undefined);
    mockGetGroupDetail.mockResolvedValue(null);

    const result = await new GroupAgentBuilderExecutionRuntime().listGroupMembers('cg_x');

    expect(result).toMatchObject({ error: { type: 'GroupNotFound' }, success: false });
  });

  it('reports a missing group context', async () => {
    const result = await new GroupAgentBuilderExecutionRuntime().listGroupMembers(undefined);

    expect(result).toMatchObject({ error: { type: 'NoGroupContext' }, success: false });
  });
});
