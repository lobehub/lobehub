import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCanManageResourcePermission,
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetPreference,
  mockMessageCreate,
} = vi.hoisted(() => ({
  mockCanManageResourcePermission: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetPreference: vi.fn(),
  mockMessageCreate: vi.fn(),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  canManageResourcePermission: mockCanManageResourcePermission,
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
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(null),
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
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
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
    mockCanManageResourcePermission.mockResolvedValue(false);
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

  it('uses the caller model preference when the workspace Agent allows member selection', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
      chatConfig: { enableAgentMode: true },
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

  it('ignores member overrides for the Agent author and uses the shared model and target', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: {
        executionTarget: 'sandbox',
        executionTargetSelectionPolicy: 'member',
        modelSelectionPolicy: 'member',
      },
      userId,
      chatConfig: { enableAgentMode: true },
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
      agentModeOverrides: { 'agent-1': false },
    });
    service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig).toMatchObject({
      agencyConfig: { executionTarget: 'sandbox' },
      chatConfig: { enableAgentMode: true },
      model: 'gpt-4',
      provider: 'openai',
    });
    expect(mockCanManageResourcePermission).not.toHaveBeenCalled();
  });

  it('ignores member model overrides for a Workspace admin', async () => {
    mockCanManageResourcePermission.mockResolvedValue(true);
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      agencyConfig: { modelSelectionPolicy: 'member' },
      chatConfig: { enableAgentMode: true },
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
    expect(mockCanManageResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'agent-1', userId, workspaceId: 'workspace-1' }),
    );
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
