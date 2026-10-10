import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from '@/server/services/discover';

import { agentBuilderRuntime } from '../agentBuilder';

const {
  mockCreatePlugin,
  mockFindById,
  mockGetMcpManifest,
  mockQueryPlugins,
  mockResolveConnectors,
  mockUpdatePlugin,
  mockGetAgentConfigById,
  mockGetAiProviderList,
  mockGetAiProviderModelList,
  mockGetHiddenBuiltinModelsForUser,
  mockUpdateAgent,
  mockServiceUpdateConfig,
  mockUpdateConfig,
} = vi.hoisted(() => ({
  mockCreatePlugin: vi.fn(),
  mockFindById: vi.fn(),
  mockGetMcpManifest: vi.fn(),
  mockQueryPlugins: vi.fn(),
  mockResolveConnectors: vi.fn(),
  mockUpdatePlugin: vi.fn(),
  mockGetAgentConfigById: vi.fn(),
  mockGetAiProviderList: vi.fn(),
  mockGetAiProviderModelList: vi.fn(),
  mockGetHiddenBuiltinModelsForUser: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockServiceUpdateConfig: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: mockGetHiddenBuiltinModelsForUser,
  getModelRedirects: vi.fn(async () => ({})),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(function () {
    return { updateAgentConfig: mockServiceUpdateConfig };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return {
      getAgentConfigById: mockGetAgentConfigById,
      update: mockUpdateAgent,
      updateConfig: mockUpdateConfig,
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(function () {
    return {
      create: mockCreatePlugin,
      findById: mockFindById,
      query: mockQueryPlugins,
      update: mockUpdatePlugin,
    };
  }),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return { resolveAll: mockResolveConnectors };
  }),
}));

vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn(function () {
    return {
      getAiProviderList: mockGetAiProviderList,
      getAiProviderModelList: mockGetAiProviderModelList,
    };
  }),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(function () {
    return { getMcpManifest: mockGetMcpManifest };
  }),
}));

const createRuntime = () =>
  agentBuilderRuntime.factory({
    editingAgentId: 'agent-1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

const createWorkspaceRuntime = () =>
  agentBuilderRuntime.factory({
    editingAgentId: 'agent-1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

describe('agentBuilderRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceUpdateConfig.mockImplementation((...args) => mockUpdateConfig(...args));
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);
    mockResolveConnectors.mockResolvedValue([]);
    mockQueryPlugins.mockResolvedValue([]);
    mockFindById.mockResolvedValue(undefined);
    mockGetMcpManifest.mockRejectedValue(new Error('not in marketplace'));
  });

  it('does not persist a model change rejected by the shared-agent policy', async () => {
    mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', provider: 'lobehub' });
    mockServiceUpdateConfig.mockRejectedValueOnce(new Error('Shared agent provider is restricted'));
    const result = await createRuntime().updateConfig(
      { config: { model: 'gpt-4o', provider: 'openai' } },
      { editingAgentId: 'agent-1', toolManifestMap: {} },
    );
    expect(result.success).toBe(false);
    expect(result.content).toContain('Shared agent provider is restricted');
    expect(mockUpdateConfig).not.toHaveBeenCalled();
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
      mockFindById.mockResolvedValue({ identifier: 'plugin-b', manifest: { api: [] } });

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
      mockFindById.mockResolvedValue({ identifier: 'plugin-b', manifest: { api: [] } });

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

    // Vent msg_3TSVUmdD8G68gRPPKH: `tg_mcp` was reported enabled while the
    // user's connector is `tg-mcp`, so the agent pinned an id that loads nothing.
    it('refuses to enable an id that resolves to nothing and suggests the near match', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: ['lobe-message'] });
      mockResolveConnectors.mockResolvedValue([
        { identifier: 'tg-mcp', isEnabled: true, status: 'connected' },
      ]);

      const runtime = createRuntime();
      const result = await runtime.updateConfig(
        {
          meta: { title: 'Telegram Analyst' },
          togglePlugin: { enabled: true, pluginId: 'tg_mcp' },
        } as never,
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'PluginNotFound' });
      expect(result.content).toContain('"tg-mcp"');
      expect(mockResolveConnectors).toHaveBeenCalledWith('agent-1');
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('enables a user connector by its exact identifier', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
      mockResolveConnectors.mockResolvedValue([
        { identifier: 'tg-mcp', isEnabled: true, status: 'connected' },
      ]);

      const result = await createRuntime().updateConfig(
        { togglePlugin: { enabled: true, pluginId: 'tg-mcp' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: [{ identifier: 'tg-mcp', mode: 'pinned' }],
      });
    });

    it('refuses a connector that exists but is not connected', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
      mockResolveConnectors.mockResolvedValue([
        { identifier: 'gmail', isEnabled: true, status: 'disconnected' },
      ]);

      const result = await createRuntime().updateConfig(
        { togglePlugin: { enabled: true, pluginId: 'gmail' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'PluginNotConnected' });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('refuses an official catalog integration the user never connected', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });

      const result = await createRuntime().updateConfig(
        { togglePlugin: { enabled: true, pluginId: 'gmail' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'PluginNotConnected' });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('still disables an id that no longer resolves, so stale entries can be removed', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: ['tg_mcp'] });

      const result = await createRuntime().updateConfig(
        { togglePlugin: { enabled: false, pluginId: 'tg_mcp' } },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', { plugins: [] });
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

    it('applies metadata nested under config instead of reporting a successful no-op', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });

      const runtime = createRuntime();
      const params = {
        config: {
          meta: {
            avatar: '🤖',
            title: 'GitHub PR/Issue Manager',
          },
        },
      } as unknown as Parameters<typeof runtime.updateConfig>[0];
      const result = await runtime.updateConfig(params, {
        editingAgentId: 'agent-1',
        toolManifestMap: {},
      });

      expect(result).toMatchObject({
        state: { agentId: 'agent-1', success: true },
        success: true,
      });
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', {
        avatar: '🤖',
        title: 'GitHub PR/Issue Manager',
      });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
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

  describe('existence guard (0-row silent no-op)', () => {
    it('updatePrompt fails loudly when the editing agent no longer exists', async () => {
      mockGetAgentConfigById.mockResolvedValue(undefined);

      const result = await createRuntime().updatePrompt(
        { prompt: 'orphan prompt' },
        { editingAgentId: 'agent-missing', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('updateConfig meta-only writes fail loudly when the editing agent no longer exists', async () => {
      mockGetAgentConfigById.mockResolvedValue(undefined);

      const result = await createRuntime().updateConfig(
        { meta: { title: 'Ghost' } },
        { editingAgentId: 'agent-missing', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      expect(mockUpdateAgent).not.toHaveBeenCalled();
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

  describe('installPlugin - market resolution', () => {
    it('refuses an installed plugin whose manifest lists no tools', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
      mockFindById.mockResolvedValue({
        identifier: 'adkit',
        manifest: { identifier: 'adkit', type: 'mcp', url: 'https://mcp.adkit.so' },
        type: 'customPlugin',
      });

      const result = await createRuntime().installPlugin(
        { identifier: 'adkit', source: 'market' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'PluginHasNoTools' });
      expect(mockGetMcpManifest).not.toHaveBeenCalled();
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('writes no row and pins nothing when the marketplace has no manifest', async () => {
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });

      const result = await createRuntime().installPlugin(
        { identifier: 'adkit-ads-mcp', source: 'market' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'PluginNotFound' });
      expect(mockCreatePlugin).not.toHaveBeenCalled();
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    });

    it('installs the marketplace plugin even when a same-named connector exists', async () => {
      const manifest = { api: [{ name: 'send' }], identifier: 'gmail' };
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
      mockResolveConnectors.mockResolvedValue([
        { identifier: 'gmail', isEnabled: false, status: 'disconnected' },
      ]);
      mockGetMcpManifest.mockResolvedValue(manifest);

      const result = await createRuntime().installPlugin(
        { identifier: 'gmail', source: 'market' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(mockCreatePlugin).toHaveBeenCalledWith({
        identifier: 'gmail',
        manifest,
        type: 'plugin',
      });
    });

    it('installs a marketplace plugin with its manifest and says it loads next run', async () => {
      const manifest = { api: [{ name: 'listCampaigns' }], identifier: 'ads-mcp' };
      mockGetAgentConfigById.mockResolvedValue({ id: 'agent-1', plugins: [] });
      mockGetMcpManifest.mockResolvedValue(manifest);

      const result = await createRuntime().installPlugin(
        { identifier: 'ads-mcp', source: 'market' },
        { editingAgentId: 'agent-1', toolManifestMap: {} },
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('next run');
      expect(mockCreatePlugin).toHaveBeenCalledWith({
        identifier: 'ads-mcp',
        manifest,
        type: 'plugin',
      });
      expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: [{ identifier: 'ads-mcp', mode: 'pinned' }],
      });
    });
  });

  // Regression guard for `searchMarketTools` returning `unauthorized`: built
  // without an identity, DiscoverService signs no trusted-client token, so every
  // server-executed market search failed — which the model reports as a plain
  // tool failure and silently works around, leaving the built agent with no
  // market tool.
  describe('market identity', () => {
    it('passes the run identity to DiscoverService', () => {
      createRuntime();

      expect(DiscoverService).toHaveBeenCalledWith({
        userInfo: { userId: 'user-1', workspaceId: undefined },
      });
    });

    it('scopes the market identity to the run workspace', () => {
      createWorkspaceRuntime();

      expect(DiscoverService).toHaveBeenCalledWith({
        userInfo: { userId: 'user-1', workspaceId: 'workspace-1' },
      });
    });
  });
});

// A builder run whose tool context lost `editingAgentId` used to fall back to
// `ctx.agentId` — the builder builtin itself — and report success while the
// agent the user was editing stayed untouched.
describe('agentBuilderRuntime without an editing target', () => {
  const builderRunCtx = {
    agentId: 'agt_builder_virtual',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentConfigById.mockResolvedValue({ plugins: [] });
  });

  it('updatePrompt refuses instead of writing to the builder itself', async () => {
    const runtime = agentBuilderRuntime.factory(builderRunCtx);
    const result = await runtime.updatePrompt({ prompt: 'NEW PROMPT' }, builderRunCtx);

    expect(mockUpdateAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: { type: 'NoEditingTarget' }, success: false });
  });

  it('updateConfig refuses instead of writing to the builder itself', async () => {
    const runtime = agentBuilderRuntime.factory(builderRunCtx);
    const result = await runtime.updateConfig(
      { config: { params: { temperature: 0.8 } } } as any,
      builderRunCtx,
    );

    expect(mockServiceUpdateConfig).not.toHaveBeenCalled();
    expect(mockUpdateAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: { type: 'NoEditingTarget' }, success: false });
  });

  it('installPlugin refuses instead of writing to the builder itself', async () => {
    const runtime = agentBuilderRuntime.factory(builderRunCtx);
    const result = await runtime.installPlugin(
      { identifier: 'lobe-web-browsing', source: 'official' },
      builderRunCtx,
    );

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: { type: 'NoEditingTarget' }, success: false });
  });
});
