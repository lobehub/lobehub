import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { PluginModel } from '@/database/models/plugin';

import { agentManagementRuntime } from '../agentManagement';

const { mockCountAgents, mockGetAssistantList, mockQueryAgents } = vi.hoisted(() => ({
  mockCountAgents: vi.fn(),
  mockGetAssistantList: vi.fn(),
  mockQueryAgents: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    countAgents: mockCountAgents,
    queryAgents: mockQueryAgents,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(() => ({})),
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
        'requested limit 50 exceeds the maximum of 20, so results were capped at 20',
      );
      expect(result.state).toMatchObject({ hasMore: false });
    });

    it('returns no agents found when nothing matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(0);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ keyword: 'nonexistent', source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents found matching your search criteria.');
    });

    it('explains an out-of-range offset instead of claiming no matches', async () => {
      mockQueryAgents.mockResolvedValue([]);
      mockCountAgents.mockResolvedValue(37);

      const runtime = createRuntime();
      const result = await runtime.searchAgent({ offset: 200, source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents at offset 200; only 37 agents match');
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
});
