import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { PluginModel } from '@/database/models/plugin';

import { agentManagementRuntime } from '../agentManagement';

const {
  mockCountAgents,
  mockGetAssistantList,
  mockQueryAgents,
  mockGetAgentConfigById,
  mockUpdateConfig,
  mockFindById,
  mockCreatePlugin,
} = vi.hoisted(() => ({
  mockCountAgents: vi.fn(),
  mockCreatePlugin: vi.fn(),
  mockFindById: vi.fn(),
  mockGetAgentConfigById: vi.fn(),
  mockGetAssistantList: vi.fn(),
  mockQueryAgents: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    countAgents: mockCountAgents,
    getAgentConfigById: mockGetAgentConfigById,
    queryAgents: mockQueryAgents,
    updateConfig: mockUpdateConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(() => ({
    create: mockCreatePlugin,
    findById: mockFindById,
  })),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(() => ({
    getAssistantList: mockGetAssistantList,
  })),
}));

const createRuntime = () =>
  agentManagementRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

const createWorkspaceRuntime = () =>
  agentManagementRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

const makeAgents = (count: number, startIndex = 0) =>
  Array.from({ length: count }, (_, i) => ({
    avatar: null,
    backgroundColor: null,
    description: null,
    id: `agent-${startIndex + i}`,
    title: `Agent ${startIndex + i}`,
  }));

describe('agentManagementRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the agent management runtime identifier', () => {
    expect(agentManagementRuntime.identifier).toBe('lobe-agent-management');
  });

  it('throws if required server context is missing', () => {
    expect(() => agentManagementRuntime.factory({ toolManifestMap: {} })).toThrow(
      'userId and serverDB are required for Agent Management execution',
    );
  });

  it('scopes agent and plugin models to workspace context', () => {
    createWorkspaceRuntime();

    expect(AgentModel).toHaveBeenCalledWith(expect.anything(), 'user-1', 'workspace-1');
    expect(PluginModel).toHaveBeenCalledWith(expect.anything(), 'user-1', 'workspace-1');
  });

  describe('callAgent', () => {
    it('fails when the server sub-agent runner is unavailable', async () => {
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
        },
        { toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'AGENT_CALL_UNAVAILABLE' });
    });

    it('returns a deferred tool result and forks the target agent through the sub-agent runner', async () => {
      const run = vi.fn().mockResolvedValue({
        started: true,
        subOperationId: 'op-child',
        threadId: 'thread-child',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
          taskTitle: 'Delegated task',
          timeout: 1234,
        },
        {
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(run).toHaveBeenCalledWith({
        agentId: 'agent-target',
        description: 'Delegated task',
        instruction: 'Do delegated work',
        timeout: 1234,
      });
      expect(result).toMatchObject({
        content: '',
        deferred: true,
        success: true,
      });
      expect(result.state).toMatchObject({
        status: 'pending',
        subOperationId: 'op-child',
        targetAgentId: 'agent-target',
        threadId: 'thread-child',
      });
    });

    it('returns a non-deferred failure when the target agent cannot start', async () => {
      const run = vi.fn().mockResolvedValue({
        started: false,
        threadId: '',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
          runAsTask: true,
        },
        {
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'AGENT_CALL_START_FAILED',
      });
      expect(result.deferred).toBeUndefined();
    });

    it('surfaces the underlying start error so the failure is diagnosable', async () => {
      const run = vi.fn().mockResolvedValue({
        error: 'Agent not found: agent-target',
        started: false,
        threadId: '',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        { agentId: 'agent-target', instruction: 'Do delegated work' },
        { subAgent: { run }, toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe(
        'Agent "agent-target" failed to start: Agent not found: agent-target',
      );
      expect(result.error).toMatchObject({
        code: 'AGENT_CALL_START_FAILED',
        message: 'Agent "agent-target" failed to start: Agent not found: agent-target',
      });
    });

    it('rejects nested server callAgent execution', async () => {
      const run = vi.fn();
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        {
          agentId: 'agent-target',
          instruction: 'Do delegated work',
        },
        {
          isSubAgent: true,
          subAgent: { run },
          toolManifestMap: {},
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: 'NESTED_AGENT_CALL_NOT_ALLOWED' });
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('searchAgent', () => {
    it('reports the real total and a pagination hint when more agents exist', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(20));
      mockCountAgents.mockResolvedValue(137);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 20, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 0 });
      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 137 agents in your workspace, showing 1-20');
      expect(result.content).toContain('call searchAgent with offset=20');
      expect(result.state).toMatchObject({ hasMore: true, offset: 0, totalCount: 137 });
    });

    it('passes offset through and computes the next page hint from it', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(20, 20));
      mockCountAgents.mockResolvedValue(50);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 20, offset: 20, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 20 });
      expect(result.content).toContain('Found 50 agents in your workspace, showing 21-40');
      expect(result.content).toContain('call searchAgent with offset=40');
      expect(result.state).toMatchObject({ hasMore: true, offset: 20, totalCount: 50 });
    });

    it('notes when the requested limit is capped', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(1));
      mockCountAgents.mockResolvedValue(1);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ limit: 50, source: 'user' });

      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: undefined, limit: 20, offset: 0 });
      expect(result.content).toContain(
        'Requested limit 50 exceeds the maximum of 20; results were capped at 20 per call.',
      );
      expect(result.state).toMatchObject({ hasMore: false });
    });

    it('returns no agents found when nothing matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(0);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'nonexistent', source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents matched');
    });

    it('explains an out-of-range offset instead of claiming no matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(37);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ offset: 200, source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents at offset 200; only 37 match');
    });

    it('surfaces heteroType for heterogeneous workspace agents', async () => {
      mockQueryAgents.mockResolvedValue([
        {
          avatar: null,
          backgroundColor: null,
          description: null,
          heteroType: 'claude-code',
          id: 'agent-cc',
          title: 'CC 2号机',
        },
      ]);
      mockCountAgents.mockResolvedValue(1);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('heteroType="claude-code"');
      expect(result.content).toContain('heterogeneous agents');
      expect(result.state).toMatchObject({
        agents: [expect.objectContaining({ id: 'agent-cc', heteroType: 'claude-code' })],
      });
    });

    it('searches the marketplace without counting workspace agents', async () => {
      mockGetAssistantList.mockResolvedValue({
        items: [{ identifier: 'market-agent-1', title: 'Market Agent' }],
        totalCount: 42,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'market', source: 'market' });

      expect(mockCountAgents).not.toHaveBeenCalled();
      expect(result.content).toContain('Found 42 agents in the marketplace, showing the first 1');
      expect(result.state).toMatchObject({
        agents: [expect.objectContaining({ id: 'market-agent-1', isMarket: true })],
        totalCount: 42,
      });
    });

    it('combines workspace and marketplace totals for source "all"', async () => {
      mockQueryAgents.mockResolvedValue(makeAgents(1));
      mockCountAgents.mockResolvedValue(30);
      mockGetAssistantList.mockResolvedValue({
        items: [{ identifier: 'market-agent-1', title: 'Market Agent' }],
        totalCount: 12,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'test' });

      expect(result.content).toContain(
        'Found 30 agents in your workspace and 12 in the marketplace, showing 2',
      );
      // next-page hint should direct the model back to workspace-only pagination
      expect(result.content).toContain('call searchAgent with offset=1 and source="user"');
      expect(result.state).toMatchObject({ hasMore: true, totalCount: 42 });
    });

    it('falls back to item count when marketplace omits totalCount', async () => {
      mockGetAssistantList.mockResolvedValue({
        items: [
          { identifier: 'market-agent-1', title: 'Market Agent' },
          { identifier: 'market-agent-2', title: 'Another Agent' },
        ],
        totalCount: undefined,
      });

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ source: 'market' });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ totalCount: 2 });
    });

    it('handles search failure', async () => {
      mockQueryAgents.mockRejectedValue(new Error('DB unavailable'));
      mockCountAgents.mockResolvedValue(0);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ source: 'user' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to search agents');
    });
  });

  describe('installPlugin', () => {
    it('appends a new pinned entry when the identifier is absent', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: ['plugin-a'] });
      mockFindById.mockResolvedValue(undefined);

      const runtime = createRuntime();
      const result = await runtime.installPlugin({ agentId: 'agent-1', identifier: 'plugin-b' });

      expect(result.success).toBe(true);
      expect(mockCreatePlugin).toHaveBeenCalledWith({ identifier: 'plugin-b', type: 'plugin' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }],
      });
    });

    it('flips an existing disabled object entry back to pinned in place, without duplicating it', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'disabled' }],
      });
      mockFindById.mockResolvedValue({ identifier: 'plugin-b' });

      const runtime = createRuntime();
      const result = await runtime.installPlugin({ agentId: 'agent-1', identifier: 'plugin-b' });

      expect(result.success).toBe(true);
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }],
      });
    });

    it('is a no-op write when the identifier is already pinned', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: ['plugin-a', 'plugin-b'],
      });
      mockFindById.mockResolvedValue({ identifier: 'plugin-b' });

      const runtime = createRuntime();
      const result = await runtime.installPlugin({ agentId: 'agent-1', identifier: 'plugin-b' });

      expect(result.success).toBe(true);
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });
  });
});
