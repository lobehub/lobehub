import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockFindOperationById,
  mockFindTopicById,
  mockIsOperationInterrupted,
  mockMergeMetadata,
  mockGetLatestNonToolMessageId,
  mockGetLatestSpineMessageId,
  mockMessageCreate,
  mockReleaseReservation,
  mockTryReserve,
} = vi.hoisted(() => ({
  mockFindOperationById: vi.fn(),
  mockFindTopicById: vi.fn(),
  mockIsOperationInterrupted: vi.fn(),
  mockMergeMetadata: vi.fn(),
  mockGetLatestNonToolMessageId: vi.fn(),
  mockGetLatestSpineMessageId: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockReleaseReservation: vi.fn(),
  mockTryReserve: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      getLatestNonToolMessageId: mockGetLatestNonToolMessageId,
      getLatestSpineMessageId: mockGetLatestSpineMessageId,
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: mockFindTopicById,
      releaseTaskCallbackReservation: mockReleaseReservation,
      tryReserveTaskCallback: mockTryReserve,
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { findById: mockFindOperationById, mergeMetadata: mockMergeMetadata };
  }),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
  }),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue(undefined),
      getGroupAgentsWithMeta: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn().mockResolvedValue({
        autoStarted: true,
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        success: true,
      }),
      isOperationInterrupted: mockIsOperationInterrupted,
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      uploadFromUrl: vi.fn(),
    };
  }),
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

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
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
    ],
  };
});

const topicWithMarker = (operationId: string) => ({
  id: 'topic-1',
  metadata: { runningOperation: { assistantMessageId: 'asst-old', operationId } },
});

/**
 * LOBE-14448: a composer send that starts a new run on a topic must retire the
 * foreground run still holding `runningOperation`. The client picks only one
 * op as `replacesOperationId`; when it picks an older, already-stopping op, the
 * live marker holder used to keep running next to the new run. Both then read
 * the same topic, interleave writes, and break each other's prompt cache.
 */
describe('AiAgentService.execAgent - supersede running foreground operation', () => {
  let service: AiAgentService;
  let interruptTask: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockImplementation(async (payload: { role: string }) => ({
      id: payload.role === 'user' ? 'user-msg-1' : 'assistant-msg-1',
    }));
    mockGetLatestSpineMessageId.mockResolvedValue('spine-head-1');
    mockGetLatestNonToolMessageId.mockResolvedValue(undefined);
    mockTryReserve.mockResolvedValue(true);
    mockReleaseReservation.mockResolvedValue(undefined);
    mockFindTopicById.mockResolvedValue(topicWithMarker('op-live'));
    mockFindOperationById.mockResolvedValue({ id: 'op-live', status: 'running', trigger: 'chat' });
    mockIsOperationInterrupted.mockResolvedValue(false);
    mockMergeMetadata.mockResolvedValue(true);

    service = new AiAgentService({} as any, 'test-user-id');
    interruptTask = vi.spyOn(service, 'interruptTask').mockResolvedValue({ success: true });
  });

  it('interrupts the live marker holder when the client replaced a different operation', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
      replacesOperationId: 'op-stopping',
    });

    expect(interruptTask).toHaveBeenCalledWith({ operationId: 'op-stopping', topicId: 'topic-1' });
    expect(interruptTask).toHaveBeenCalledWith({ operationId: 'op-live', topicId: 'topic-1' });
  });

  it('interrupts the live marker holder when the client sent no replacement', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(interruptTask).toHaveBeenCalledTimes(1);
    expect(interruptTask).toHaveBeenCalledWith({ operationId: 'op-live', topicId: 'topic-1' });
  });

  it('does not interrupt the marker holder twice when it is the replaced operation', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
      replacesOperationId: 'op-live',
    });

    expect(interruptTask).toHaveBeenCalledTimes(1);
  });

  it('interrupts a running onboarding holder, which also comes from the composer', async () => {
    mockFindOperationById.mockResolvedValue({
      id: 'op-live',
      status: 'running',
      trigger: 'onboarding',
    });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(interruptTask).toHaveBeenCalledWith({ operationId: 'op-live', topicId: 'topic-1' });
  });

  it('leaves a device-hosted heterogeneous holder to the replacement path', async () => {
    mockFindTopicById.mockResolvedValue({
      id: 'topic-1',
      metadata: {
        runningOperation: { deviceId: 'dev-1', heteroType: 'claude-code', operationId: 'op-live' },
      },
    });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(interruptTask).not.toHaveBeenCalled();
  });

  it.each([
    ['a finished marker holder', { status: 'done', trigger: 'chat' }],
    ['a parked marker holder', { status: 'waiting_for_human', trigger: 'chat' }],
    ['a cron marker holder', { status: 'running', trigger: 'cron' }],
    ['a task marker holder', { status: 'running', trigger: 'task' }],
  ])('leaves %s alone', async (_, operation) => {
    mockFindOperationById.mockResolvedValue({ id: 'op-live', ...operation });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(interruptTask).not.toHaveBeenCalled();
  });

  it('records a client_missed supersede with the client snapshot on the new run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clientRunSnapshot = {
      operations: [{ operationId: 'op-old', status: 'success' }],
      replacesOperationId: 'op-stopping',
    };

    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      clientRunSnapshot,
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(mockMergeMetadata).toHaveBeenCalledWith(result.operationId, {
      supersede: {
        client: clientRunSnapshot,
        kind: 'client_missed',
        supersededAt: expect.any(String),
        supersededOperationId: 'op-live',
      },
    });
    expect(warn).toHaveBeenCalledWith(
      '[execAgent] client missed a running foreground operation',
      expect.objectContaining({ supersededOperationId: 'op-live', topicId: 'topic-1' }),
    );
    warn.mockRestore();
  });

  it('records an already_stopping supersede without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockIsOperationInterrupted.mockResolvedValue(true);

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(mockMergeMetadata).toHaveBeenCalledWith(expect.any(String), {
      supersede: expect.objectContaining({ kind: 'already_stopping' }),
    });
    expect(warn).not.toHaveBeenCalledWith(
      '[execAgent] client missed a running foreground operation',
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('does not fail the send when recording the supersede fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockMergeMetadata.mockRejectedValue(new Error('db down'));

    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(result.success).toBe(true);
    error.mockRestore();
  });

  it('records nothing when no run was superseded', async () => {
    mockFindOperationById.mockResolvedValue({ id: 'op-live', status: 'done', trigger: 'chat' });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      interactiveStart: true,
      prompt: 'please hurry',
    });

    expect(mockMergeMetadata).not.toHaveBeenCalled();
  });

  it('keeps non-interactive starts on the existing path', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'task callback',
    });

    expect(interruptTask).not.toHaveBeenCalled();
  });
});
