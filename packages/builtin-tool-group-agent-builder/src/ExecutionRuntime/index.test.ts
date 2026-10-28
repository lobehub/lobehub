import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupAgentBuilderExecutionRuntime } from './index';

const { mockQueryAgents } = vi.hoisted(() => ({ mockQueryAgents: vi.fn() }));

vi.mock('@/services/agent', () => ({ agentService: { queryAgents: mockQueryAgents } }));
vi.mock('@/services/chatGroup', () => ({ chatGroupService: {} }));
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: vi.fn() } }));
vi.mock('@/store/agentGroup', () => ({ getChatGroupStoreState: vi.fn() }));
vi.mock('@/store/agentGroup/selectors', () => ({ agentGroupSelectors: {} }));
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
