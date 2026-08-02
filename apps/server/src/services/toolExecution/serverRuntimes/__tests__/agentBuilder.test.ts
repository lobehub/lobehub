import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentBuilderRuntime } from '../agentBuilder';

const {
  mockCreatePlugin,
  mockFindById,
  mockGetAgentConfigById,
  mockGetAiProviderList,
  mockGetAiProviderModelList,
  mockGetHiddenBuiltinModelsForUser,
  mockUpdateAgent,
  mockUpdateConfig,
} = vi.hoisted(() => ({
  mockCreatePlugin: vi.fn(),
  mockFindById: vi.fn(),
  mockGetAgentConfigById: vi.fn(),
  mockGetAiProviderList: vi.fn(),
  mockGetAiProviderModelList: vi.fn(),
  mockGetHiddenBuiltinModelsForUser: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: mockGetHiddenBuiltinModelsForUser,
  getModelRedirects: vi.fn(async () => ({})),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentConfigById: mockGetAgentConfigById,
    update: mockUpdateAgent,
    updateConfig: mockUpdateConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(() => ({
    create: mockCreatePlugin,
    findById: mockFindById,
  })),
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn(() => ({
    getAiProviderList: mockGetAiProviderList,
    getAiProviderModelList: mockGetAiProviderModelList,
  })),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(() => ({})),
}));

const createRuntime = () =>
  agentBuilderRuntime.factory({
    editingAgentId: 'agent-1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

describe('agentBuilderRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);
  });

  describe('getAvailableModels', () => {
    it('does not query or expose models when access cannot be resolved', async () => {
      mockGetAiProviderList.mockResolvedValue([{ enabled: true, id: 'lobehub', name: 'LobeHub' }]);

      const result = await createRuntime().getAvailableModels({});

      expect(result).toMatchObject({
        state: { providers: [] },
        success: true,
      });
      expect(mockGetAiProviderModelList).not.toHaveBeenCalled();
    });

    it('does not expose models hidden for the current user', async () => {
      mockGetAiProviderList.mockResolvedValue([{ enabled: true, id: 'lobehub', name: 'LobeHub' }]);
      mockGetAiProviderModelList.mockResolvedValue([
        { displayName: 'Hidden Chat', id: 'hidden-chat' },
        { displayName: 'Visible Chat', id: 'visible-chat' },
      ]);
      mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
        { id: 'hidden-chat', providerId: 'lobehub' },
      ]);

      const result = await createRuntime().getAvailableModels({});

      expect(result).toMatchObject({
        state: {
          providers: [
            {
              id: 'lobehub',
              models: [{ id: 'visible-chat', name: 'Visible Chat' }],
            },
          ],
        },
        success: true,
      });
    });
  });

  describe('updateConfig - togglePlugin', () => {
    it('appends a new pinned entry when enabling an absent identifier', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: ['plugin-a'] });

      const runtime = createRuntime();
      const result = await runtime.updateConfig(
        { togglePlugin: { enabled: true, pluginId: 'plugin-b' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }],
      });
    });

    it('flips an existing disabled object entry back to pinned in place, without duplicating it', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'disabled' }],
      });

      const runtime = createRuntime();
      const result = await runtime.updateConfig(
        { togglePlugin: { enabled: true, pluginId: 'plugin-b' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }],
      });
    });

    it('disabling (enabled: false) reverts the entry to auto, removing it from the array', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: ['plugin-a', 'plugin-b'],
      });

      const runtime = createRuntime();
      const result = await runtime.updateConfig(
        { togglePlugin: { enabled: false, pluginId: 'plugin-b' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', { plugins: ['plugin-a'] });
    });

    it('returns the invocation target for a successful no-op', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });

      const runtime = createRuntime();
      const result = await runtime.updateConfig(
        {},
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result).toMatchObject({
        state: { agentId: 'agent-1', success: true },
        success: true,
      });
    });
  });

  describe('updatePrompt', () => {
    it('writes and returns the editing agent captured by the invocation', async () => {
      const runtime = createRuntime();
      const result = await runtime.updatePrompt(
        { prompt: 'run-scoped prompt' },
        {
          agentId: 'builder-agent',
          editingAgentId: 'target-agent',
          toolManifestMap: {},
        },
      );

      expect(mockUpdateAgent).toHaveBeenCalledWith('target-agent', {
        editorData: null,
        systemRole: 'run-scoped prompt',
      });
      expect(result).toMatchObject({
        state: {
          agentId: 'target-agent',
          newPrompt: 'run-scoped prompt',
          success: true,
        },
        success: true,
      });
    });
  });

  describe('installPlugin', () => {
    it('flips an existing disabled builtin-tool entry back to pinned, without duplicating it', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: [{ identifier: 'lobe-web-browsing', mode: 'disabled' }],
      });

      const runtime = createRuntime();
      const result = await runtime.installPlugin(
        { identifier: 'lobe-web-browsing', source: 'official' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: [{ identifier: 'lobe-web-browsing', mode: 'pinned' }],
      });
    });

    it('is a no-op write when the builtin-tool identifier is already pinned', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: ['lobe-web-browsing'],
      });

      const runtime = createRuntime();
      const result = await runtime.installPlugin(
        { identifier: 'lobe-web-browsing', source: 'official' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('flips an existing disabled market-plugin entry back to pinned, without duplicating it', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        id: 'agent-1',
        plugins: [{ identifier: 'market-plugin', mode: 'disabled' }],
      });
      mockFindById.mockResolvedValue({ identifier: 'market-plugin', manifest: { api: [] } });

      const runtime = createRuntime();
      const result = await runtime.installPlugin(
        { identifier: 'market-plugin', source: 'market' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ agentId: 'agent-1' });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: [{ identifier: 'market-plugin', mode: 'pinned' }],
      });
    });
  });
});
