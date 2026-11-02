import type { LobeToolManifest } from '@lobechat/context-engine';
import { buildOnDemandBootstrapToolSet } from '@lobechat/context-engine/onDemand';
import { ON_DEMAND_BOOTSTRAP_IDENTIFIERS } from '@lobechat/types';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockIsResourceAuthorOrAdmin,
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetPreference,
  mockGenerateToolsDetailed,
  mockGetEnabledPluginManifests,
  mockMessageCreate,
  mockPluginQuery,
  mockConnectorResolveAll,
  mockConnectorToolQueryAll,
  mockTopicFindById,
} = vi.hoisted(() => ({
  mockIsResourceAuthorOrAdmin: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetPreference: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetEnabledPluginManifests: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn(),
  mockConnectorResolveAll: vi.fn(),
  mockConnectorToolQueryAll: vi.fn(),
  mockTopicFindById: vi.fn(),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  isResourceAuthorOrAdmin: mockIsResourceAuthorOrAdmin,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn().mockImplementation(() => ({
    getPreference: mockGetPreference,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: mockPluginQuery,
  })),
}));

// Builtin agents inject their own tools, so a run under a builtin slug reaches
// connector resolution that the plain-agent cases never do.
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    queryByIdentifiers: vi.fn().mockResolvedValue([]),
    resolveAll: mockConnectorResolveAll,
    resolveByIdentifiers: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryAllByConnectorIds: mockConnectorToolQueryAll,
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: mockTopicFindById,
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: mockGenerateToolsDetailed,
    getEnabledPluginManifests: mockGetEnabledPluginManifests,
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
    ],
  };
});

describe('AiAgentService.execAgent - model/provider override', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  const defaultAgentConfig = {
    chatConfig: {},
    id: 'agent-1',
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
    slug: 'my-agent',
    systemRole: 'You are a helpful assistant.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetPreference.mockResolvedValue({});
    mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
    mockGetEnabledPluginManifests.mockReturnValue(new Map());
    mockPluginQuery.mockResolvedValue([]);
    mockConnectorResolveAll.mockResolvedValue([]);
    mockConnectorToolQueryAll.mockResolvedValue([]);
    mockIsResourceAuthorOrAdmin.mockResolvedValue(false);
    mockTopicFindById.mockResolvedValue(null);
    service = new AiAgentService(mockDb, userId);
  });

  it('should use agent default model/provider when no override is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4');
    expect(callArgs.agentConfig.provider).toBe('openai');
  });

  it('should override model when model param is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('openai'); // provider unchanged
  });

  it('should override provider when provider param is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      provider: 'anthropic',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4'); // model unchanged
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });

  it('should override both model and provider when both params are provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
      provider: 'anthropic',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });

  it('keeps an explicit model override over the topic model', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });
    mockTopicFindById.mockResolvedValue({ model: 'gpt-5.6-terra', provider: 'openai' });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      model: 'step-3.7-flash',
      prompt: 'Hello',
      provider: 'stepfun',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('step-3.7-flash');
    expect(callArgs.agentConfig.provider).toBe('stepfun');
    expect(callArgs.modelRuntimeConfig).toEqual({ model: 'step-3.7-flash', provider: 'stepfun' });
  });

  it('keeps the topic provider when only the model is overridden', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });
    mockTopicFindById.mockResolvedValue({ model: 'gpt-5.6-terra', provider: 'stepfun' });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      model: 'step-3.7-flash',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.modelRuntimeConfig).toEqual({ model: 'step-3.7-flash', provider: 'stepfun' });
  });

  it('uses the caller model preference when the workspace Agent allows member selection', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
      chatConfig: { contextMode: 'default', enableAgentMode: true },
      visibility: 'public',
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
      agentModeOverrides: { 'agent-1': false },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(false);
  });

  it('uses the caller context-mode preference for a shared Workspace Agent', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { contextMode: 'default', enableAgentMode: true },
      visibility: 'public',
    });
    mockGetPreference.mockResolvedValue({
      agentContextModeOverrides: { 'agent-1': 'on-demand' },
      agentModeOverrides: { 'agent-1': true },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig.contextMode).toBe('on-demand');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
  });

  it('ignores member overrides for the Agent author and uses the shared model and target', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: {
        executionTarget: 'sandbox',
        executionTargetSelectionPolicy: 'member',
        modelSelectionPolicy: 'member',
      },
      userId,
      chatConfig: { contextMode: 'default', enableAgentMode: true },
      visibility: 'public',
      workspaceId: 'workspace-1',
    });
    mockGetPreference.mockResolvedValue({
      agentDeviceOverrides: {
        'agent-1': { boundDeviceId: 'member-device', executionTarget: 'local' },
      },
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
      agentContextModeOverrides: { 'agent-1': 'on-demand' },
      agentModeOverrides: { 'agent-1': false },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig).toMatchObject({
      agencyConfig: { executionTarget: 'sandbox' },
      chatConfig: { contextMode: 'default', enableAgentMode: true },
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(mockIsResourceAuthorOrAdmin).not.toHaveBeenCalled();
  });

  it('ignores member model overrides for a Workspace admin', async () => {
    mockIsResourceAuthorOrAdmin.mockResolvedValue(true);
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
      chatConfig: { contextMode: 'default', enableAgentMode: true },
      userId: 'agent-author',
      visibility: 'public',
      workspaceId: 'workspace-1',
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
      agentModeOverrides: { 'agent-1': false },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4');
    expect(callArgs.agentConfig.provider).toBe('openai');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
    expect(mockIsResourceAuthorOrAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId, workspaceId: 'workspace-1' }),
    );
  });

  it('uses the caller model preference on a collaborative builtin the caller created', async () => {
    // The Agent Builder row is provisioned by whichever member opened the panel
    // first; being that member (or an admin) must not pin everyone to their
    // model, so the run reads this caller's own override. Chat/Agent mode keeps
    // the ordinary author rule and stays shared.
    mockIsResourceAuthorOrAdmin.mockResolvedValue(true);
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { enableAgentMode: true },
      slug: 'group-agent-builder',
      userId,
      virtual: true,
      visibility: 'public',
      workspaceId: 'workspace-1',
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
      agentModeOverrides: { 'agent-1': false },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
  });

  it('ignores the caller model preference when the workspace Agent is private', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
      visibility: 'private',
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4');
    expect(callArgs.agentConfig.provider).toBe('openai');
  });

  it('ignores member device policy and overrides while the workspace Agent is private', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: {
        boundDeviceId: 'owner-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      visibility: 'private',
    });
    mockGetPreference.mockResolvedValue({
      agentDeviceOverrides: {
        'agent-1': { boundDeviceId: 'stale-member-device', executionTarget: 'local' },
      },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.agencyConfig).toEqual({
      boundDeviceId: 'owner-device',
      executionTarget: 'device',
    });
  });

  it('uses a retained caller preference when a legacy workspace model policy is missing', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig, visibility: 'public' });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });

  it('ignores a retained caller preference when the workspace model policy is fixed', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'fixed' },
      visibility: 'public',
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4');
    expect(callArgs.agentConfig.provider).toBe('openai');
  });

  it('keeps an explicit per-run model/provider above the caller workspace preference', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
    });
    mockGetPreference.mockResolvedValue({
      agentModelOverrides: {
        'agent-1': { model: 'gpt-4', provider: 'openai' },
      },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
      provider: 'anthropic',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });
});

describe('AiAgentService.execAgent - toolModeOverride (/mode command)', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  const defaultAgentConfig = {
    chatConfig: {},
    id: 'agent-1',
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
    slug: 'my-agent',
    systemRole: 'You are a helpful assistant.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetPreference.mockResolvedValue({});
    mockIsResourceAuthorOrAdmin.mockResolvedValue(false);
    mockTopicFindById.mockResolvedValue(null);
    service = new AiAgentService(mockDb, userId);
  });

  it('/mode chat on an agent-mode agent also disables enableAgentMode for context injection', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { enableAgentMode: true },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'chat' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig.toolMode).toBe('chat');
    // The context engine gates agentic-only injectors on enableAgentMode, so
    // the override must flip it too — not just toolMode.
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(false);
  });

  it('/mode agent on a chat-default agent enables agent mode and its context', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { enableAgentMode: false },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'agent' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig.toolMode).toBe('agent');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
  });

  it('/mode agent preserves a custom toolMode (hand-picked toolset stays)', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { toolMode: 'custom' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'agent' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    // `custom` is agent-side; widening it to `agent` would silently grant
    // tools the agent deliberately excluded.
    expect(callArgs.agentConfig.chatConfig.toolMode).toBe('custom');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
  });

  it('/mode chat still disables tools on a custom-toolMode agent', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { toolMode: 'custom' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'chat' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig.toolMode).toBe('chat');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(false);
  });

  it('wins over the workspace member-mode override', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { enableAgentMode: true },
      visibility: 'public',
    });
    mockGetPreference.mockResolvedValue({ agentModeOverrides: { 'agent-1': false } });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'agent' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig.toolMode).toBe('agent');
    expect(callArgs.agentConfig.chatConfig.enableAgentMode).toBe(true);
  });

  it('/mode always leaves the explicit on-demand context strategy', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { contextMode: 'on-demand', enableAgentMode: true },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', toolModeOverride: 'agent' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.chatConfig).toMatchObject({
      contextMode: 'default',
      enableAgentMode: true,
    });
  });

  it('sends exactly the bootstrap payload while keeping a cold tool discoverable', async () => {
    const bootstrap = buildOnDemandBootstrapToolSet();
    const coldManifest: LobeToolManifest = {
      api: [
        {
          description: 'Deploy the current release',
          name: 'deploy',
          parameters: {
            properties: { version: { type: 'string' } },
            required: ['version'],
            type: 'object',
          },
        },
      ],
      identifier: 'cold-release-tool',
      meta: { description: 'Cold release capability', title: 'Cold Release' },
      systemRole: 'Never inject this manual until activation.',
      type: 'default',
    };

    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { contextMode: 'on-demand', enableAgentMode: true },
      plugins: ['cold-release-tool'],
    });
    mockGenerateToolsDetailed.mockImplementation((input: { toolIds: string[] }) => {
      expect(input.toolIds).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
      return {
        enabledToolIds: bootstrap.enabledToolIds,
        tools: bootstrap.tools,
      };
    });
    mockGetEnabledPluginManifests.mockReturnValue(
      new Map([...Object.entries(bootstrap.manifestMap), ['cold-release-tool', coldManifest]]),
    );

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Deploy release 42',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
    expect(callArgs.toolSet.tools.map((tool: any) => tool.function.name)).toEqual(
      bootstrap.tools.map((tool) => tool.function.name),
    );
    expect(
      callArgs.toolSet.tools.every((tool: any) => !tool.function.name.includes('invoke')),
    ).toBe(true);
    expect(callArgs.toolSet.discoveryPool.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identifier: 'cold-release-tool',
          name: 'Cold Release',
        }),
      ]),
    );
    expect(
      callArgs.toolSet.discoveryPool.cards.some((card: any) =>
        ON_DEMAND_BOOTSTRAP_IDENTIFIERS.includes(card.identifier),
      ),
    ).toBe(false);
    expect(callArgs.toolSet.discoveryPool.bundles['cold-release-tool'].manual.content).toContain(
      'Never inject this manual until activation.',
    );
  });

  it('discovers installed but unpinned plugins and connectors without adding them to tools', async () => {
    const bootstrap = buildOnDemandBootstrapToolSet();
    const coldPlugin = {
      customParams: {},
      identifier: 'cold-unpinned-plugin',
      manifest: {
        api: [
          {
            description: 'Read an unpinned plugin resource',
            name: 'readResource',
            parameters: { properties: {}, type: 'object' },
          },
        ],
        executors: ['client'],
        identifier: 'cold-unpinned-plugin',
        meta: { description: 'Unpinned plugin capability', title: 'Cold Plugin' },
        type: 'default',
      },
      runtimeType: 'default',
      type: 'plugin',
    };
    const coldConnector = {
      credentials: null,
      id: 'connector-cold',
      identifier: 'cold-connector',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://example.com/mcp',
      metadata: {},
      name: 'Cold Connector',
    };

    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      chatConfig: { contextMode: 'on-demand', enableAgentMode: true },
      plugins: [],
    });
    mockPluginQuery.mockResolvedValue([coldPlugin]);
    mockConnectorResolveAll.mockResolvedValue([coldConnector]);
    mockConnectorToolQueryAll.mockResolvedValue([
      {
        description: 'Search the cold connector',
        id: 'connector-tool-cold',
        inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
        permission: 'auto',
        toolName: 'search',
        userConnectorId: coldConnector.id,
      },
    ]);
    mockGenerateToolsDetailed.mockImplementation((input: { toolIds: string[] }) => {
      expect(input.toolIds).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
      return {
        enabledToolIds: bootstrap.enabledToolIds,
        tools: bootstrap.tools,
      };
    });
    mockGetEnabledPluginManifests.mockReturnValue(new Map(Object.entries(bootstrap.manifestMap)));

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Use installed capabilities',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.tools.map((tool: any) => tool.function.name)).toEqual(
      bootstrap.tools.map((tool) => tool.function.name),
    );
    expect(callArgs.toolSet.discoveryPool.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'cold-unpinned-plugin', source: 'plugin' }),
        expect.objectContaining({ identifier: 'cold-connector', source: 'mcp' }),
      ]),
    );
    expect(callArgs.toolSet.discoveryPool.bundles['cold-unpinned-plugin'].manifest).toMatchObject({
      identifier: 'cold-unpinned-plugin',
    });
    expect(callArgs.toolSet.discoveryPool.bundles['cold-connector'].manifest).toMatchObject({
      api: [expect.objectContaining({ name: 'search' })],
      identifier: 'cold-connector',
    });
  });
});
