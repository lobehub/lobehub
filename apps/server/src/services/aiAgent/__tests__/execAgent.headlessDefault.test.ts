import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetOperationStatus,
  mockMessageCreate,
  mockMessageFindById,
  mockMessageFindPlugin,
  mockMessageUpdate,
  mockMessageUpdatePlugin,
  mockTopicFindById,
  mockTopicUpdateMetadata,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetOperationStatus: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageFindById: vi.fn(),
  mockMessageFindPlugin: vi.fn(),
  mockMessageUpdate: vi.fn(),
  mockMessageUpdatePlugin: vi.fn(),
  mockTopicFindById: vi.fn(),
  mockTopicUpdateMetadata: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/services/messageQueue', () => ({
  getMessageQueueService: vi.fn().mockReturnValue(null),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    findById: mockMessageFindById,
    findMessagePlugin: mockMessageFindPlugin,
    query: vi.fn().mockResolvedValue([]),
    update: mockMessageUpdate,
    updateMessagePlugin: mockMessageUpdatePlugin,
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
    findById: mockTopicFindById,
    updateMetadata: mockTopicUpdateMetadata,
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
    getOperationStatus: mockGetOperationStatus,
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

describe('AiAgentService.execAgent - headless approval default', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageUpdate.mockResolvedValue({});
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
    service = new AiAgentService(mockDb, userId);
  });

  it('should default to headless approval mode when userInterventionConfig is not provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'headless' });
  });

  it('should respect explicit userInterventionConfig when provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      userInterventionConfig: { approvalMode: 'manual' },
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual({ approvalMode: 'manual' });
  });

  it.each(['queued', 'duplicate', 'rejected'] as const)(
    'returns the %s queue result before creating messages or an operation',
    async (decision) => {
      const claimOrEnqueue = vi.fn().mockImplementation((_context, operationId, message) => ({
        activeOperationId: decision === 'queued' ? 'op-active' : operationId,
        decision,
        queueId: message.id,
      }));
      (service as any).messageQueueService = { claimOrEnqueue, releaseOwned: vi.fn() };

      const result = await service.execAgent({
        agentId: 'agent-1',
        messageQueue: { enabled: true, requestId: `request-${decision}` },
        prompt: 'queue me',
        trigger: 'chat',
      });

      expect(result).toEqual(
        expect.objectContaining({
          queueId: `request-${decision}`,
          status: decision,
          success: decision !== 'rejected',
          topicId: 'topic-1',
        }),
      );
      expect(mockMessageCreate).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    },
  );

  it('compare-releases a proceeded queue claim when operation startup fails', async () => {
    const releaseOwned = vi.fn().mockResolvedValue(true);
    const claimOrEnqueue = vi.fn().mockImplementation((_context, operationId, message) => ({
      activeOperationId: operationId,
      decision: 'proceed',
      queueId: message.id,
    }));
    (service as any).messageQueueService = { claimOrEnqueue, releaseOwned };
    mockCreateOperation.mockRejectedValueOnce(new Error('queue scheduler unavailable'));

    const result = await service.execAgent({
      agentId: 'agent-1',
      messageQueue: { enabled: true, requestId: 'request-proceed' },
      prompt: 'start me',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(releaseOwned).toHaveBeenCalledWith(claimOrEnqueue.mock.calls[0][1], {
      dedupId: 'request-proceed',
      preserveQueue: true,
    });
  });

  it('consumes a recovered batch after its deterministic rows persist, even when startup fails', async () => {
    const commitRecoveredClaim = vi.fn().mockResolvedValue(true);
    const releaseOwned = vi.fn().mockResolvedValue(true);
    const claimOrEnqueue = vi.fn().mockImplementation((_context, operationId, message) => ({
      activeOperationId: operationId,
      decision: 'proceed',
      queueId: message.id,
      recoveredItems: [
        {
          createdAt: 1,
          id: 'queued-before-recovery',
          interruptMode: 'soft',
          prompt: 'older queued prompt',
          source: 'gateway',
        },
        message,
      ],
    }));
    (service as any).messageQueueService = {
      claimOrEnqueue,
      commitRecoveredClaim,
      releaseOwned,
    };
    mockCreateOperation.mockRejectedValueOnce(new Error('queue scheduler unavailable'));

    const result = await service.execAgent({
      agentId: 'agent-1',
      messageQueue: { enabled: true, requestId: 'recovery-kick' },
      prompt: 'new queued prompt',
      trigger: 'chat',
    });

    const operationId = claimOrEnqueue.mock.calls[0][1];
    expect(result.success).toBe(false);
    expect(commitRecoveredClaim).toHaveBeenCalledWith(operationId);
    expect(commitRecoveredClaim.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateOperation.mock.invocationCallOrder[0],
    );
    expect(releaseOwned).toHaveBeenCalledWith(operationId, {
      dedupId: 'recovery-kick',
      preserveQueue: true,
      recoveredBatchPersisted: true,
    });
  });

  it('aborts before runtime startup when a durable recovered claim cannot be finalized', async () => {
    const commitRecoveredClaim = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    const releaseOwned = vi.fn().mockResolvedValue(true);
    const claimOrEnqueue = vi.fn().mockImplementation((_context, operationId, message) => ({
      activeOperationId: operationId,
      decision: 'proceed',
      queueId: message.id,
      recoveredItems: [message],
    }));
    (service as any).messageQueueService = {
      claimOrEnqueue,
      commitRecoveredClaim,
      releaseOwned,
    };

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        messageQueue: { enabled: true, requestId: 'recovery-kick' },
        prompt: 'queued prompt',
        trigger: 'chat',
      }),
    ).rejects.toThrow('Redis unavailable');

    const operationId = claimOrEnqueue.mock.calls[0][1];
    expect(mockCreateOperation).not.toHaveBeenCalled();
    expect(mockMessageUpdate).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({ content: '', error: expect.any(Object) }),
    );
    expect(releaseOwned).toHaveBeenCalledWith(operationId, {
      dedupId: 'recovery-kick',
      preserveQueue: true,
      recoveredBatchPersisted: true,
    });
  });

  it('treats a rejected recovered-claim CAS as a startup failure', async () => {
    const commitRecoveredClaim = vi.fn().mockResolvedValue(false);
    const releaseOwned = vi.fn().mockResolvedValue(true);
    const claimOrEnqueue = vi.fn().mockImplementation((_context, operationId, message) => ({
      activeOperationId: operationId,
      decision: 'proceed',
      queueId: message.id,
      recoveredItems: [message],
    }));
    (service as any).messageQueueService = {
      claimOrEnqueue,
      commitRecoveredClaim,
      releaseOwned,
    };

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        messageQueue: { enabled: true, requestId: 'recovery-kick' },
        prompt: 'queued prompt',
        trigger: 'chat',
      }),
    ).rejects.toThrow('Failed to finalize recovered Gateway queue claim');

    expect(mockCreateOperation).not.toHaveBeenCalled();
    expect(releaseOwned).toHaveBeenCalledWith(claimOrEnqueue.mock.calls[0][1], {
      dedupId: 'recovery-kick',
      preserveQueue: true,
      recoveredBatchPersisted: true,
    });
  });

  it('adopts pending queue ownership before starting a human-approval resume operation', async () => {
    const adoptOwnership = vi.fn().mockResolvedValue(true);
    const queueService = {
      adoptOwnership,
      peek: vi.fn().mockResolvedValue({
        activeOperationId: null,
        items: [{ id: 'queued-1' }],
      }),
      releaseOwned: vi.fn(),
    };
    (service as any).messageQueueService = queueService;
    mockMessageFindById.mockResolvedValueOnce({
      id: 'tool-message',
      role: 'tool',
      topicId: 'topic-1',
    });
    mockMessageFindPlugin.mockResolvedValueOnce({ toolCallId: 'tool-call-1' });
    mockMessageUpdatePlugin.mockResolvedValue(undefined);
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      id: 'topic-1',
      metadata: { runningOperation: { operationId: 'op-parked' } },
    });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      parentMessageId: 'tool-message',
      prompt: '',
      resume: true,
      resumeApproval: {
        decision: 'approved',
        parentMessageId: 'tool-message',
        toolCallId: 'tool-call-1',
      },
      trigger: 'chat',
    });

    const resumeOperationId = mockCreateOperation.mock.calls[0][0].operationId;
    expect(adoptOwnership).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        groupId: undefined,
        scope: undefined,
        threadId: undefined,
        topicId: 'topic-1',
      },
      resumeOperationId,
      'op-parked',
    );
    expect(adoptOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateOperation.mock.invocationCallOrder[0],
    );
  });

  it('reuses a pending handoff operation receipt without executing the queued turn twice', async () => {
    const nextOperationId = 'op-queue-next';
    const queueService = {
      beginHandoff: vi.fn().mockResolvedValue({
        consumedQueueIds: ['queue-1'],
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        items: [
          {
            createdAt: 1,
            id: 'queue-1',
            interruptMode: 'soft',
            prompt: 'queued prompt',
            source: 'gateway',
          },
        ],
        nextOperationId,
        oldOperationId: 'op-old',
        status: 'pending',
      }),
      commitHandoff: vi.fn().mockResolvedValue(true),
      getHandoffReceipt: vi.fn(),
      releaseOwned: vi.fn(),
      rollbackHandoff: vi.fn(),
    };
    (service as any).messageQueueService = queueService;
    mockGetOperationStatus.mockResolvedValue({
      isActive: true,
      isCompleted: false,
      metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
      operationId: nextOperationId,
    });
    mockMessageFindById
      .mockResolvedValueOnce({ agentId: 'agent-1', role: 'user', topicId: 'topic-1' })
      .mockResolvedValueOnce({ agentId: 'agent-1', role: 'assistant', topicId: 'topic-1' });
    mockTopicUpdateMetadata.mockResolvedValue(undefined);
    const execAgentSpy = vi.spyOn(service, 'execAgent');

    const result = await service.handoffQueuedMessages({
      operationId: 'op-old',
      state: { metadata: { topicId: 'topic-1' } } as any,
    });

    expect(execAgentSpy).not.toHaveBeenCalled();
    expect(queueService.commitHandoff).toHaveBeenCalledWith(
      'op-old',
      expect.objectContaining({ operationId: nextOperationId, success: true }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        consumedQueueIds: ['queue-1'],
        nextOperation: expect.objectContaining({ operationId: nextOperationId }),
      }),
    );
  });

  it('restarts an idle pending handoff instead of committing it as recovered', async () => {
    const nextOperationId = 'op-queue-idle';
    const snapshot = {
      consumedQueueIds: ['queue-1'],
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      items: [
        {
          createdAt: 1,
          id: 'queue-1',
          interruptMode: 'soft' as const,
          prompt: 'queued prompt',
          source: 'gateway' as const,
        },
      ],
      nextOperationId,
      oldOperationId: 'op-old',
      status: 'pending' as const,
    };
    const queueService = {
      beginHandoff: vi.fn().mockResolvedValue(snapshot),
      commitHandoff: vi.fn().mockResolvedValue(true),
      getHandoffReceipt: vi.fn(),
      releaseOwned: vi.fn(),
      rollbackHandoff: vi.fn(),
    };
    (service as any).messageQueueService = queueService;
    mockGetOperationStatus.mockResolvedValue({
      currentState: { status: 'idle' },
      isActive: false,
      isCompleted: false,
      metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
      operationId: nextOperationId,
    });
    mockMessageFindById
      .mockResolvedValueOnce({ agentId: 'agent-1', role: 'user', topicId: 'topic-1' })
      .mockResolvedValueOnce({ agentId: 'agent-1', role: 'assistant', topicId: 'topic-1' });
    const restartedOperation = {
      agentId: 'agent-1',
      assistantMessageId: 'assistant-restarted',
      autoStarted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      message: 'restarted',
      operationId: nextOperationId,
      status: 'created' as const,
      success: true,
      timestamp: '2026-01-01T00:00:00.000Z',
      topicId: 'topic-1',
      userMessageId: 'user-restarted',
    };
    const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue(restartedOperation);

    const result = await service.handoffQueuedMessages({
      operationId: 'op-old',
      state: { metadata: { topicId: 'topic-1' } } as any,
    });

    expect(execAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIds: expect.objectContaining({
          assistant: expect.any(String),
          user: expect.any(String),
        }),
        operationId: nextOperationId,
        skipQueueClaim: true,
      }),
    );
    expect(queueService.commitHandoff).toHaveBeenCalledWith('op-old', restartedOperation);
    expect(result).toEqual({ consumedQueueIds: ['queue-1'], nextOperation: restartedOperation });
  });

  it('should respect explicit allow-list approval mode with allowList', async () => {
    const config = { allowList: ['tool-a', 'tool-b'], approvalMode: 'allow-list' as const };

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      userInterventionConfig: config,
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.userInterventionConfig).toEqual(config);
  });
});
