import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentManagerRuntime } from '../AgentManagerRuntime';
import type { IAgentService, IDiscoverService } from '../types';

// Create mock services
const mockAgentService: IAgentService = {
  createAgent: vi.fn(),
  queryAgents: vi.fn(),
  removeAgent: vi.fn(),
};

const mockDiscoverService: IDiscoverService = {
  getAssistantList: vi.fn(),
  getMcpList: vi.fn(),
};

// Mock stores
const mockAgentConfig = {
  plugins: ['plugin-1'],
  systemRole: 'Previous prompt',
};

const mockAgentMeta = {
  avatar: '🤖',
  title: 'Test Agent',
};

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    appendStreamingSystemRole: vi.fn(),
    finishStreamingSystemRole: vi.fn(),
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
    startStreamingSystemRole: vi.fn(),
  })),
}));

vi.mock('@/store/agent/selectors/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: vi.fn(() => () => mockAgentConfig),
    getAgentMetaById: vi.fn(() => () => mockAgentMeta),
  },
}));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: vi.fn(() => ({
    enabledChatModelList: [
      {
        id: 'openai',
        name: 'OpenAI',
        children: [
          { id: 'gpt-4o', displayName: 'GPT-4o', abilities: { functionCall: true, vision: true } },
          { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo' },
        ],
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        children: [
          {
            id: 'claude-3-5-sonnet',
            displayName: 'Claude 3.5 Sonnet',
            abilities: { reasoning: true },
          },
        ],
      },
    ],
  })),
}));

vi.mock('@/store/tool', () => ({
  getToolStoreState: vi.fn(() => ({
    installMCPPlugin: vi.fn().mockResolvedValue(true),
    refreshPlugins: vi.fn(),
  })),
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    metaList: vi.fn(() => [{ identifier: 'lobe-web-browsing', meta: { title: 'Web Browsing' } }]),
  },
  klavisStoreSelectors: {
    getServers: vi.fn(() => []),
  },
  lobehubSkillStoreSelectors: {
    getServers: vi.fn(() => []),
  },
  pluginSelectors: {
    getInstalledPluginById: vi.fn(() => () => null),
    isPluginInstalled: vi.fn(() => () => false),
  },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: vi.fn(() => ({})),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: vi.fn(() => 'test-user-id'),
  },
}));

describe('AgentManagerRuntime', () => {
  let runtime: AgentManagerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new AgentManagerRuntime({
      agentService: mockAgentService,
      discoverService: mockDiscoverService,
    });
  });

  describe('createAgent', () => {
    it('should create an agent successfully', async () => {
      vi.mocked(mockAgentService.createAgent).mockResolvedValue({
        agentId: 'new-agent-id',
        sessionId: 'new-session-id',
      });

      const result = await runtime.createAgent({
        title: 'My New Agent',
        description: 'A test agent',
        systemRole: 'You are a helpful assistant',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully created agent');
      expect(result.content).toContain('My New Agent');
      expect(result.state).toMatchObject({
        agentId: 'new-agent-id',
        sessionId: 'new-session-id',
        success: true,
      });
    });

    it('should handle creation failure', async () => {
      vi.mocked(mockAgentService.createAgent).mockRejectedValue(new Error('Creation failed'));

      const result = await runtime.createAgent({
        title: 'My Agent',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to create agent');
      expect(result.error).toMatchObject({
        message: 'Creation failed',
        type: 'RuntimeError',
      });
    });
  });

  describe('updateAgentConfig', () => {
    it('should update agent config successfully', async () => {
      const result = await runtime.updateAgentConfig('agent-id', {
        config: { model: 'gpt-4o' },
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully updated agent');
      expect(result.state).toMatchObject({
        success: true,
        config: {
          updatedFields: ['model'],
        },
      });
    });

    it('should update agent meta successfully', async () => {
      const result = await runtime.updateAgentConfig('agent-id', {
        meta: { title: 'New Title', avatar: '🎉' },
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('meta fields: title, avatar');
    });

    it('should handle togglePlugin', async () => {
      const result = await runtime.updateAgentConfig('agent-id', {
        togglePlugin: { pluginId: 'new-plugin', enabled: true },
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('plugin new-plugin enabled');
      expect(result.state).toMatchObject({
        success: true,
        togglePlugin: {
          enabled: true,
          pluginId: 'new-plugin',
        },
      });
    });

    it('should return no fields message when nothing to update', async () => {
      const result = await runtime.updateAgentConfig('agent-id', {});

      expect(result.success).toBe(true);
      expect(result.content).toBe('No fields to update.');
    });
  });

  describe('deleteAgent', () => {
    it('should delete agent successfully', async () => {
      vi.mocked(mockAgentService.removeAgent).mockResolvedValue({} as any);

      const result = await runtime.deleteAgent('agent-to-delete');

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully deleted agent');
      expect(result.state).toMatchObject({
        agentId: 'agent-to-delete',
        success: true,
      });
    });

    it('should handle deletion failure', async () => {
      vi.mocked(mockAgentService.removeAgent).mockRejectedValue(new Error('Deletion failed'));

      const result = await runtime.deleteAgent('agent-id');

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to delete agent');
    });
  });

  describe('searchAgents', () => {
    it('should search user agents', async () => {
      vi.mocked(mockAgentService.queryAgents).mockResolvedValue([
        {
          id: 'agent-1',
          title: 'Agent One',
          description: 'First agent',
          avatar: null,
          backgroundColor: null,
        },
        {
          id: 'agent-2',
          title: 'Agent Two',
          description: 'Second agent',
          avatar: null,
          backgroundColor: null,
        },
      ] as any);

      const result = await runtime.searchAgents({
        keyword: 'test',
        source: 'user',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 2 agents');
      expect(result.state).toMatchObject({
        agents: expect.arrayContaining([
          expect.objectContaining({ id: 'agent-1', isMarket: false }),
          expect.objectContaining({ id: 'agent-2', isMarket: false }),
        ]),
        source: 'user',
        totalCount: 2,
      });
    });

    it('should search marketplace agents', async () => {
      vi.mocked(mockDiscoverService.getAssistantList).mockResolvedValue({
        items: [
          {
            identifier: 'market-agent-1',
            title: 'Market Agent',
            description: 'From market',
          } as any,
        ],
        totalCount: 1,
      } as any);

      const result = await runtime.searchAgents({
        keyword: 'market',
        source: 'market',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        agents: expect.arrayContaining([
          expect.objectContaining({ id: 'market-agent-1', isMarket: true }),
        ]),
        source: 'market',
      });
    });

    it('should search all sources by default', async () => {
      vi.mocked(mockAgentService.queryAgents).mockResolvedValue([
        {
          id: 'user-agent',
          title: 'User Agent',
          avatar: null,
          backgroundColor: null,
          description: null,
        },
      ] as any);
      vi.mocked(mockDiscoverService.getAssistantList).mockResolvedValue({
        items: [{ identifier: 'market-agent', title: 'Market Agent' } as any],
        totalCount: 1,
      } as any);

      const result = await runtime.searchAgents({ keyword: 'test' });

      expect(result.success).toBe(true);
      expect(result.state?.source).toBe('all');
      expect(result.state?.agents).toHaveLength(2);
    });

    it('should return no agents found message', async () => {
      vi.mocked(mockAgentService.queryAgents).mockResolvedValue([]);

      const result = await runtime.searchAgents({ keyword: 'nonexistent', source: 'user' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents found');
    });
  });

  describe('getAvailableModels', () => {
    it('should return all available models', async () => {
      const result = await runtime.getAvailableModels({});

      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 2 provider(s)');
      expect(result.content).toContain('3 model(s)');
      expect(result.state).toMatchObject({
        providers: expect.arrayContaining([
          expect.objectContaining({ id: 'openai' }),
          expect.objectContaining({ id: 'anthropic' }),
        ]),
      });
    });

    it('should filter by providerId', async () => {
      const result = await runtime.getAvailableModels({ providerId: 'openai' });

      expect(result.success).toBe(true);
      expect(result.state?.providers).toHaveLength(1);
      expect(result.state?.providers[0].id).toBe('openai');
    });
  });

  describe('updatePrompt', () => {
    it('should update prompt without streaming', async () => {
      const result = await runtime.updatePrompt('agent-id', {
        prompt: 'New system prompt',
        streaming: false,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully updated system prompt');
      expect(result.content).toContain('17 characters');
      expect(result.state).toMatchObject({
        newPrompt: 'New system prompt',
        previousPrompt: 'Previous prompt',
        success: true,
      });
    });

    it('should clear prompt when empty', async () => {
      const result = await runtime.updatePrompt('agent-id', {
        prompt: '',
        streaming: false,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully cleared system prompt');
    });
  });

  describe('searchMarketTools', () => {
    it('should search market tools', async () => {
      vi.mocked(mockDiscoverService.getMcpList).mockResolvedValue({
        items: [
          {
            identifier: 'tool-1',
            name: 'Tool One',
            description: 'First tool',
            author: 'Author',
          } as any,
          { identifier: 'tool-2', name: 'Tool Two', description: 'Second tool' } as any,
        ],
        totalCount: 2,
      } as any);

      const result = await runtime.searchMarketTools({ query: 'test' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Found 2 tool(s)');
      expect(result.state).toMatchObject({
        query: 'test',
        tools: expect.arrayContaining([
          expect.objectContaining({ identifier: 'tool-1' }),
          expect.objectContaining({ identifier: 'tool-2' }),
        ]),
        totalCount: 2,
      });
    });
  });

  describe('installPlugin', () => {
    it('should install builtin tool', async () => {
      const result = await runtime.installPlugin('agent-id', {
        identifier: 'lobe-web-browsing',
        source: 'official',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully enabled builtin tool');
      expect(result.state).toMatchObject({
        installed: true,
        pluginId: 'lobe-web-browsing',
        success: true,
      });
    });

    it('should return error for unknown official tool', async () => {
      const result = await runtime.installPlugin('agent-id', {
        identifier: 'unknown-tool',
        source: 'official',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
    });

    it('should install market plugin', async () => {
      const result = await runtime.installPlugin('agent-id', {
        identifier: 'market-plugin',
        source: 'market',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully installed and enabled MCP plugin');
    });
  });
});
