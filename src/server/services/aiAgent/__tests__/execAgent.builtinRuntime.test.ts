import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { SELF_FEEDBACK_INTENT_IDENTIFIER } from '@lobechat/builtin-tool-self-iteration';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerAgentToolsEngine } from '@/server/modules/Mecha';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockIsAgentSignalEnabledForUser,
  mockMessageCreate,
  mockMessageQuery,
  mockResolveTask,
  mockToolsEnv,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockIsAgentSignalEnabledForUser: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockResolveTask: vi.fn(),
  mockToolsEnv: {
    VISUAL_UNDERSTANDING_MODEL: undefined as string | undefined,
    VISUAL_UNDERSTANDING_PROVIDER: undefined as string | undefined,
  },
}));

vi.mock('@/envs/tools', () => ({
  toolsEnv: mockToolsEnv,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: mockMessageQuery,
    update: vi.fn().mockResolvedValue({}),
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

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: mockIsAgentSignalEnabledForUser,
  isLobeAiAgentSlug: (slug?: string | null) => slug === 'inbox',
  resolveAgentSelfIterationCapability: ({
    agentSelfIterationEnabled,
    isAgentSelfIterationFeatureEnabled,
    isLobeAiAgent,
  }: {
    agentSelfIterationEnabled?: boolean;
    isAgentSelfIterationFeatureEnabled: boolean;
    isLobeAiAgent: boolean;
  }) =>
    isAgentSelfIterationFeatureEnabled &&
    (isLobeAiAgent || agentSelfIterationEnabled === true),
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    resolve: mockResolveTask,
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

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: (path: string | null) => Promise.resolve(path || ''),
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockImplementation(() => ({ enabledToolIds: [], tools: [] })),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: {
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
        abilities: { functionCall: true, video: false, vision: false },
        id: 'text-only',
        providerId: 'openai',
      },
      {
        abilities: { functionCall: true, video: true, vision: true },
        id: 'gemini-3.1-flash-lite-preview',
        providerId: 'google',
      },
    ],
  };
});

describe('AiAgentService.execAgent - builtin agent runtime config', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockIsAgentSignalEnabledForUser.mockResolvedValue(true);
    mockResolveTask.mockResolvedValue(null);
    mockToolsEnv.VISUAL_UNDERSTANDING_MODEL = 'vision-model';
    mockToolsEnv.VISUAL_UNDERSTANDING_PROVIDER = 'test-provider';
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    service = new AiAgentService(mockDb, userId);
  });

  it('should merge runtime systemRole for inbox agent when DB systemRole is empty', async () => {
    // Inbox agent with no user-customized systemRole in DB
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '', // empty in DB
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    // Verify createOperation was called with agentConfig containing the runtime systemRole
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toContain('You are Lobe');
    expect(callArgs.agentConfig.systemRole).toContain('{{model}}');
  });

  it('should NOT override user-customized systemRole for inbox agent', async () => {
    const customSystemRole = 'You are a custom assistant.';
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: customSystemRole, // user has customized
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe(customSystemRole);
  });

  it('should not apply runtime config for non-builtin agents', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'my-custom-slug', // not a builtin slug
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    // Should remain empty - no runtime config applied
    expect(callArgs.agentConfig.systemRole).toBe('');
  });

  it('should not apply runtime config for agents without slug', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-no-slug',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-no-slug',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe('');
  });

  it('should inject self-feedback intent tool for Lobe AI when user gate is enabled', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeDefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe('builtin');
  });

  it('should not inject self-feedback intent tool for custom agents without agent self-iteration', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'custom-agent',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).not.toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeUndefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeUndefined();
  });

  it('should inject self-feedback intent tool for custom agents with agent self-iteration', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: { selfIteration: { enabled: true } },
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'custom-agent',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.toolSet.enabledToolIds).toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
    expect(callArgs.toolSet.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBeDefined();
    expect(callArgs.toolSet.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe('builtin');
  });

  it('should inject page-agent runtime for regular agents in page scope', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: { enableHistoryCount: true },
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: ['lobe-agent-documents'],
      provider: 'openai',
      systemRole: 'Custom role.',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: {
        documentId: 'docs-1',
        scope: 'page',
        topicId: 'topic-1',
      },
      prompt: 'Rewrite this page',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.appContext).toMatchObject({
      documentId: 'docs-1',
      scope: 'page',
    });
    expect(callArgs.agentConfig.plugins).toEqual([PageAgentIdentifier, 'lobe-agent-documents']);
    expect(callArgs.agentConfig.chatConfig.enableHistoryCount).toBe(false);
    expect(callArgs.agentConfig.systemRole).toContain('Custom role.');
    expect(callArgs.agentConfig.systemRole).toContain(
      'You are a helpful document (page) editing assistant',
    );

    expect(createServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          plugins: [PageAgentIdentifier, 'lobe-agent-documents'],
        }),
      }),
    );
  });

  it('should normalize task identifier from appContext before creating runtime operation', async () => {
    mockResolveTask.mockResolvedValue({ id: 'task-row-1', identifier: 'T-1' });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-task',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-task',
      appContext: {
        defaultTaskAssigneeAgentId: 'agt_inbox',
        scope: 'task',
        taskId: 'T-1',
        topicId: 'topic-1',
      },
      prompt: 'Show current task',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(mockResolveTask).toHaveBeenCalledWith('T-1');
    expect(callArgs.appContext).toMatchObject({
      defaultTaskAssigneeAgentId: 'agt_inbox',
      scope: 'task',
      taskId: 'task-row-1',
      topicId: 'topic-1',
    });
    expect(callArgs.initialContext.initialContext.taskManager.contextPrompt).toContain(
      'Default Lobe AI agent id: agt_inbox',
    );
  });

  it('should inject lobe-agent when history has visual media and model lacks vision', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'text-only',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
    mockMessageQuery.mockResolvedValue([
      {
        id: 'history-image',
        imageList: [{ alt: 'image.png', id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'user',
      },
    ]);

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: { topicId: 'topic-1' },
      prompt: 'What is in the previous image?',
    });

    expect(createServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          plugins: expect.arrayContaining(['lobe-agent']),
        }),
      }),
    );
  });

  it('should not inject lobe-agent when the LobeHub routed model supports visual media natively', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gemini-3.1-flash-lite-preview',
      plugins: [],
      provider: 'lobehub',
      systemRole: '',
    });
    mockMessageQuery.mockResolvedValue([
      {
        id: 'history-video',
        role: 'user',
        videoList: [{ id: 'file-video', url: 'https://example.com/video.mp4' }],
      },
    ]);

    await service.execAgent({
      agentId: 'agent-custom',
      appContext: { topicId: 'topic-1' },
      prompt: 'What is in the previous video?',
    });

    const callArgs = vi.mocked(createServerAgentToolsEngine).mock.calls[0][1];
    expect(callArgs.agentConfig.plugins).not.toContain('lobe-agent');
  });
});
