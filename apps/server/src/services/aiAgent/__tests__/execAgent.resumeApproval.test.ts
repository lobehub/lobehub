import type { LobeChatDatabase } from '@lobechat/database';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockFindById,
  mockFindMessagePlugin,
  mockMessageCreate,
  mockMessageQuery,
  mockListMessagePluginsByTopic,
  mockResolveHumanApproval,
  mockRestoreHumanApproval,
  mockUpdateMessagePlugin,
  mockUpdateTopicMetadata,
  mockUpdateToolMessage,
  mockFindOperationById,
  mockRecordCompletion,
  mockRepairAgentInterventionContinuation,
  mockInterruptOperation,
  mockEnsureInterventionContinuationStarted,
  mockLoadInterventionContinuationState,
  mockReleaseTaskCallbackReservation,
  mockTryReserveTaskCallback,
} = vi.hoisted(() => ({
  mockEnsureInterventionContinuationStarted: vi.fn(),
  mockFindOperationById: vi.fn(),
  mockRecordCompletion: vi.fn(),
  mockRepairAgentInterventionContinuation: vi.fn(),
  mockInterruptOperation: vi.fn(),
  mockLoadInterventionContinuationState: vi.fn(),
  mockReleaseTaskCallbackReservation: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockFindById: vi.fn(),
  mockFindMessagePlugin: vi.fn(),
  mockListMessagePluginsByTopic: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockResolveHumanApproval: vi.fn(),
  mockRestoreHumanApproval: vi.fn(),
  mockUpdateMessagePlugin: vi.fn(),
  mockUpdateTopicMetadata: vi.fn(),
  mockUpdateToolMessage: vi.fn(),
  mockTryReserveTaskCallback: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  HumanApprovalAlreadyResolvedError: class HumanApprovalAlreadyResolvedError extends Error {},
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    findById: mockFindById,
    findMessagePlugin: mockFindMessagePlugin,
    listMessagePluginsByTopic: mockListMessagePluginsByTopic,
    query: mockMessageQuery,
    resolveHumanApproval: mockResolveHumanApproval,
    restoreHumanApproval: mockRestoreHumanApproval,
    update: vi.fn().mockResolvedValue({}),
    updateMessagePlugin: mockUpdateMessagePlugin,
    updateToolMessage: mockUpdateToolMessage,
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({ queryAgents: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({ query: vi.fn().mockResolvedValue([]) })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    releaseTaskCallbackReservation: mockReleaseTaskCallbackReservation,
    repairAgentInterventionContinuation: mockRepairAgentInterventionContinuation,
    tryReserveTaskCallback: mockTryReserveTaskCallback,
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(null),
    updateMetadata: mockUpdateTopicMetadata,
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
    ensureInterventionContinuationStarted: mockEnsureInterventionContinuationStarted,
    interruptOperation: mockInterruptOperation,
    loadInterventionContinuationState: mockLoadInterventionContinuationState,
  })),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(() => ({
    findById: mockFindOperationById,
    recordCompletion: mockRecordCompletion,
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
  FileService: vi.fn().mockImplementation(() => ({ uploadFromUrl: vi.fn() })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
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
        abilities: { functionCall: true, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - resumeApproval', () => {
  let service: AiAgentService;

  // `messages` row — `findById` returns this. Note plugin metadata (apiName,
  // identifier, etc.) lives in a separate `message_plugins` table.
  const pendingToolMessage = {
    // Non-null in the schema; the batch resume sorts approved rows by it.
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    id: 'tool-msg-1',
    role: 'tool',
    sessionId: 'session-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  };
  // `message_plugins` row — fetched via `db.query.messagePlugins.findFirst`.
  const pendingToolPlugin = {
    apiName: 'runCommand',
    arguments: '{"command":"echo"}',
    identifier: 'lobe-local-system',
    intervention: { status: 'pending' },
    toolCallId: 'call_xyz',
    type: 'builtin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockFindById.mockImplementation(async (id: string) =>
      id === pendingToolMessage.id ? pendingToolMessage : undefined,
    );
    mockFindMessagePlugin.mockResolvedValue(pendingToolPlugin);
    mockMessageQuery.mockResolvedValue([{ content: 'hi', id: 'history-1', role: 'user' }]);
    mockMessageCreate.mockResolvedValue({ id: 'assistant-msg-new' });
    mockResolveHumanApproval.mockResolvedValue('applied');
    mockLoadInterventionContinuationState.mockResolvedValue(null);
    mockEnsureInterventionContinuationStarted.mockResolvedValue('scheduled');
    mockReleaseTaskCallbackReservation.mockResolvedValue('released');
    mockRepairAgentInterventionContinuation.mockResolvedValue('repaired');
    mockTryReserveTaskCallback.mockResolvedValue(true);
    mockRestoreHumanApproval.mockResolvedValue(undefined);
    mockUpdateMessagePlugin.mockResolvedValue(undefined);
    mockUpdateTopicMetadata.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue(undefined);
    // `MessageModel` is fully mocked above, so the service never touches the
    // raw `db` arg — cast an empty stub through `unknown` to satisfy the
    // `LobeChatDatabase` parameter type without dragging the real schema.
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  const baseParams = {
    agentId: 'agent-1',
    appContext: { sessionId: 'session-1', threadId: 'thread-1', topicId: 'topic-1' },
    parentMessageId: 'tool-msg-1',
    prompt: '',
  };

  describe('decision=approved', () => {
    it('persists intervention=approved and seeds initialContext for human_approved_tool', async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockResolveHumanApproval).toHaveBeenCalledWith([
        {
          id: 'tool-msg-1',
          intervention: {
            resolutionRequestId: expect.stringMatching(/^legacy_/),
            status: 'approved',
          },
        },
      ]);
      // `approved` decision never writes tool content — the content arrives
      // when the approved tool actually executes.
      expect(mockUpdateToolMessage).not.toHaveBeenCalled();

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              approvedToolCall: expect.objectContaining({
                apiName: 'runCommand',
                arguments: '{"command":"echo"}',
                id: 'call_xyz',
                identifier: 'lobe-local-system',
              }),
              parentMessageId: 'tool-msg-1',
              skipCreateToolMessage: true,
            }),
            phase: 'human_approved_tool',
          }),
        }),
      );
    });

    it('stamps the server-authored generic resolution id for retry detection', async () => {
      const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000099';

      await service.execAgent({
        ...baseParams,
        approvalResolutionRequestId,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockResolveHumanApproval).toHaveBeenCalledWith([
        {
          id: 'tool-msg-1',
          intervention: { resolutionRequestId: approvalResolutionRequestId, status: 'approved' },
        },
      ]);
      expect(mockUpdateTopicMetadata).not.toHaveBeenCalled();
    });

    it('retires the authoritative parked operation only after scheduling its continuation', async () => {
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        intervention: {
          batchId: 'batch-parked',
          operationId: 'op-parked',
          status: 'pending',
        },
      });
      mockFindOperationById.mockResolvedValue({
        id: 'op-parked',
        status: 'waiting_for_human',
      });
      mockInterruptOperation.mockResolvedValue(true);
      mockRecordCompletion.mockResolvedValue(true);

      await service.execAgent({
        ...baseParams,
        approvalSourceOperationId: 'op-parked',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockCreateOperation.mock.invocationCallOrder[0]).toBeLessThan(
        mockInterruptOperation.mock.invocationCallOrder[0],
      );
      expect(mockInterruptOperation).toHaveBeenCalledWith('op-parked');
      expect(mockRecordCompletion).toHaveBeenCalledWith('op-parked', {
        completedAt: expect.any(Date),
        completionReason: 'done',
        status: 'done',
      });
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    });

    it('defers generic old-operation retirement to the shared dispatch boundary', async () => {
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        intervention: {
          batchId: 'batch-parked',
          operationId: 'op-parked',
          status: 'pending',
        },
      });

      const result = await service.execAgent({
        ...baseParams,
        approvalResolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000098',
        approvalSourceOperationId: 'op-parked',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(result.success).toBe(true);
      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      expect(mockInterruptOperation).not.toHaveBeenCalled();
      expect(mockRecordCompletion).not.toHaveBeenCalled();
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    });

    it('does not restore an executed claim when old-operation retirement must be retried', async () => {
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        intervention: { operationId: 'op-parked', status: 'pending' },
      });
      mockFindOperationById.mockResolvedValue({
        id: 'op-parked',
        status: 'waiting_for_human',
      });
      mockInterruptOperation.mockResolvedValue(true);
      mockRecordCompletion.mockResolvedValue(false);

      const result = await service.execAgent({
        ...baseParams,
        approvalSourceOperationId: 'op-parked',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        error: 'retirePendingApprovalOperation: failed to settle op-parked',
        success: false,
      });
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    });
  });

  // Both rejection variants persist a tool result and enter the pending-sibling
  // barrier. The final decision continues the LLM; a partial one re-parks.
  describe.each([
    ['rejected' as const, 'not appropriate', 'with reason: not appropriate'],
    ['rejected_continue' as const, 'too risky', 'with reason: too risky'],
  ])('decision=%s', (decision, rejectionReason, expectedSuffix) => {
    it(`persists rejection + resumes through the tool-result sibling barrier`, async () => {
      await service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision,
          parentMessageId: 'tool-msg-1',
          rejectionReason,
          toolCallId: 'call_xyz',
        },
      });

      expect(mockResolveHumanApproval).toHaveBeenCalledWith([
        {
          content: `User reject this tool calling ${expectedSuffix}`,
          id: 'tool-msg-1',
          intervention: {
            rejectedReason: rejectionReason,
            resolutionRequestId: expect.stringMatching(/^legacy_/),
            status: 'rejected',
          },
        },
      ]);

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              parentMessageId: 'tool-msg-1',
            }),
            phase: 'tool_result',
          }),
        }),
      );
    });
  });

  it('falls back to the no-reason rejection string when rejectionReason is omitted', async () => {
    await service.execAgent({
      ...baseParams,
      resumeApproval: {
        decision: 'rejected',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    });

    expect(mockResolveHumanApproval).toHaveBeenCalledWith([
      {
        content: 'User reject this tool calling without reason',
        id: 'tool-msg-1',
        intervention: {
          rejectedReason: undefined,
          resolutionRequestId: expect.stringMatching(/^legacy_/),
          status: 'rejected',
        },
      },
    ]);
  });

  it('restores the claimed rows when preparation fails before the continuation starts', async () => {
    mockMessageQuery.mockRejectedValueOnce(new Error('history unavailable'));

    await expect(
      service.execAgent({
        ...baseParams,
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      }),
    ).rejects.toThrow('history unavailable');

    const claimedResolutionRequestId = mockResolveHumanApproval.mock.calls[0][0][0].intervention
      .resolutionRequestId as string;
    expect(mockRestoreHumanApproval).toHaveBeenCalledWith([
      {
        claimedResolutionRequestId,
        id: 'tool-msg-1',
        intervention: { status: 'pending' },
        pluginState: null,
        replacePluginState: true,
      },
    ]);
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rebuilds an incomplete idle continuation instead of scheduling it without hooks', async () => {
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000097';
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });
    mockLoadInterventionContinuationState.mockImplementation(async (operationId: string) => ({
      metadata: {
        agentId: 'agent-1',
        agentInterventionContinuation: {
          resolutionRequestId: approvalResolutionRequestId,
          sourceOperationId: 'op-parked',
          sourceToolMessageIds: ['tool-msg-1'],
        },
        sourceMessageId: 'tool-msg-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      operationId,
      status: 'idle',
    }));

    await service.execAgent({
      ...baseParams,
      approvalResolutionRequestId,
      approvalSourceOperationId: 'op-parked',
      resumeApproval: {
        decision: 'approved',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    });

    expect(mockEnsureInterventionContinuationStarted).not.toHaveBeenCalled();
    expect(mockCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        interventionResolution: expect.objectContaining({
          resolutionRequestId: approvalResolutionRequestId,
        }),
        operationId: expect.stringMatching(/^op_intervention_/),
      }),
    );
  });

  it('marks a reused ready continuation as a normal runtime', async () => {
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000099';
    const identity = { resolutionRequestId: approvalResolutionRequestId, userId: 'user-1' };
    const continuationOperationId = deriveAgentInterventionContinuationOperationId(identity);
    const assistantMessageId = deriveAgentInterventionContinuationMessageId(identity);
    const provenance = {
      resolutionRequestId: approvalResolutionRequestId,
      sourceOperationId: 'op-parked',
      sourceToolMessageIds: ['tool-msg-1'],
    };
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });
    mockLoadInterventionContinuationState.mockResolvedValue({
      metadata: {
        agentId: 'agent-1',
        agentInterventionContinuation: provenance,
        agentInterventionPreparation: {
          resolutionRequestId: approvalResolutionRequestId,
          state: 'ready',
        },
        sourceMessageId: 'tool-msg-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      operationId: continuationOperationId,
      status: 'idle',
    });
    mockFindOperationById.mockResolvedValue({
      agentId: 'agent-1',
      appContext: { sourceMessageId: 'tool-msg-1' },
      metadata: { agentInterventionContinuation: provenance },
      topicId: 'topic-1',
    });
    mockFindById.mockImplementation(async (id: string) =>
      id === assistantMessageId
        ? { id, role: 'assistant', topicId: 'topic-1' }
        : id === pendingToolMessage.id
          ? pendingToolMessage
          : undefined,
    );

    await expect(
      service.execAgent({
        ...baseParams,
        approvalResolutionRequestId,
        approvalSourceOperationId: 'op-parked',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      }),
    ).resolves.toMatchObject({
      heteroType: null,
      operationId: continuationOperationId,
      success: true,
    });

    expect(mockEnsureInterventionContinuationStarted).toHaveBeenCalledWith(continuationOperationId);
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('uses a non-reentrant short fence for a thread continuation without replacing the main anchor', async () => {
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000095';
    const reservationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId: approvalResolutionRequestId,
      userId: 'user-1',
    });
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });

    await service.execAgent({
      ...baseParams,
      approvalResolutionRequestId,
      approvalSourceOperationId: 'op-parked',
      resumeApproval: {
        decision: 'approved',
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
      topicStartReservationId: reservationId,
    });

    expect(mockTryReserveTaskCallback).toHaveBeenCalledWith('topic-1', reservationId, {
      allowRunningOperationId: undefined,
      allowSameReservationReentry: false,
      ignoreRunningOperation: true,
      replacesOperationId: undefined,
    });
    expect(mockReleaseTaskCallbackReservation).toHaveBeenCalledWith('topic-1', reservationId);
    expect(mockUpdateTopicMetadata).not.toHaveBeenCalled();
  });

  it('validates a thread continuation ACK and releases only its exact fence', async () => {
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000092';
    const identity = { resolutionRequestId, userId: 'user-1' };
    const continuationOperationId = deriveAgentInterventionContinuationOperationId(identity);
    const assistantMessageId = deriveAgentInterventionContinuationMessageId(identity);
    mockFindOperationById.mockResolvedValue({
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: 'op-parked',
          sourceToolMessageIds: ['tool-msg-1'],
        },
        agentInterventionDispatch: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          resolutionRequestId,
          state: 'scheduled',
        },
      },
      startedAt: new Date('2026-08-26T00:00:00.000Z'),
      status: 'running',
      topicId: 'topic-1',
    });
    mockFindById.mockImplementation(async (id: string) =>
      id === assistantMessageId
        ? { id, role: 'assistant', topicId: 'topic-1' }
        : id === pendingToolMessage.id
          ? pendingToolMessage
          : undefined,
    );

    await service.repairInterventionContinuationTopicAnchor({
      assistantMessageId,
      continuationOperationId,
      resolutionRequestId,
      sourceOperationId: 'op-parked',
      sourceToolMessageIds: ['tool-msg-1'],
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    expect(mockReleaseTaskCallbackReservation).toHaveBeenCalledWith(
      'topic-1',
      continuationOperationId,
    );
    expect(mockRepairAgentInterventionContinuation).not.toHaveBeenCalled();
    expect(mockUpdateTopicMetadata).not.toHaveBeenCalled();
  });

  it('fails closed when a thread continuation sees a foreign live fence', async () => {
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000091';
    const identity = { resolutionRequestId, userId: 'user-1' };
    const continuationOperationId = deriveAgentInterventionContinuationOperationId(identity);
    const assistantMessageId = deriveAgentInterventionContinuationMessageId(identity);
    mockFindOperationById.mockResolvedValue({
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: 'op-parked',
          sourceToolMessageIds: ['tool-msg-1'],
        },
        agentInterventionDispatch: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          resolutionRequestId,
          state: 'scheduled',
        },
      },
      status: 'running',
      topicId: 'topic-1',
    });
    mockFindById.mockImplementation(async (id: string) =>
      id === assistantMessageId
        ? { id, role: 'assistant', topicId: 'topic-1' }
        : pendingToolMessage,
    );
    mockReleaseTaskCallbackReservation.mockResolvedValueOnce('foreign');

    await expect(
      service.repairInterventionContinuationTopicAnchor({
        assistantMessageId,
        continuationOperationId,
        resolutionRequestId,
        sourceOperationId: 'op-parked',
        sourceToolMessageIds: ['tool-msg-1'],
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    ).rejects.toThrow(/foreign reservation/);

    expect(mockRepairAgentInterventionContinuation).not.toHaveBeenCalled();
  });

  it('keeps a concurrent same-request thread initializer out of createOperation', async () => {
    vi.useFakeTimers();
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000094';
    const reservationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId: approvalResolutionRequestId,
      userId: 'user-1',
    });
    let finishInitializer!: (result: {
      autoStarted: boolean;
      operationId: string;
      success: boolean;
    }) => void;
    let markInitializerStarted!: () => void;
    const initializerStarted = new Promise<void>((resolve) => {
      markInitializerStarted = resolve;
    });
    mockCreateOperation.mockImplementationOnce(() => {
      markInitializerStarted();
      return new Promise((resolve) => {
        finishInitializer = resolve;
      });
    });
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });
    mockTryReserveTaskCallback.mockResolvedValueOnce(true).mockResolvedValue(false);
    const input = {
      ...baseParams,
      approvalResolutionRequestId,
      approvalSourceOperationId: 'op-parked',
      resumeApproval: {
        decision: 'approved' as const,
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
      topicStartReservationId: reservationId,
    };

    const initializer = service.execAgent(input);
    let initializerFinished = false;
    try {
      await initializerStarted;
      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      const concurrentRetry = service.execAgent(input);
      const retryExpectation = expect(concurrentRetry).rejects.toThrow(/remained busy/);
      await vi.runAllTimersAsync();
      await retryExpectation;
      finishInitializer({ autoStarted: true, operationId: 'op-continuation', success: true });
      initializerFinished = true;
      await expect(initializer).resolves.toMatchObject({ success: true });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    } finally {
      if (!initializerFinished && finishInitializer) {
        finishInitializer({ autoStarted: true, operationId: 'op-continuation', success: true });
        await initializer.catch(() => undefined);
      }
      vi.useRealTimers();
    }
  });

  it('keeps a concurrent same-request main initializer out of createOperation', async () => {
    vi.useFakeTimers();
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000093';
    let finishInitializer!: (result: {
      autoStarted: boolean;
      operationId: string;
      success: boolean;
    }) => void;
    let markInitializerStarted!: () => void;
    const initializerStarted = new Promise<void>((resolve) => {
      markInitializerStarted = resolve;
    });
    mockCreateOperation.mockImplementationOnce(() => {
      markInitializerStarted();
      return new Promise((resolve) => {
        finishInitializer = resolve;
      });
    });
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });
    mockFindById.mockImplementation(async (id: string) =>
      id === pendingToolMessage.id ? { ...pendingToolMessage, threadId: null } : undefined,
    );
    mockTryReserveTaskCallback.mockResolvedValueOnce(true).mockResolvedValue(false);
    const input = {
      ...baseParams,
      appContext: { sessionId: 'session-1', topicId: 'topic-1' },
      approvalResolutionRequestId,
      approvalSourceOperationId: 'op-parked',
      resumeApproval: {
        decision: 'approved' as const,
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    };

    const initializer = service.execAgent(input);
    let initializerFinished = false;
    try {
      await initializerStarted;
      const concurrentRetry = service.execAgent(input);
      const retryExpectation = expect(concurrentRetry).rejects.toThrow(/remained busy/);
      await vi.runAllTimersAsync();
      await retryExpectation;
      finishInitializer({ autoStarted: true, operationId: 'op-continuation', success: true });
      initializerFinished = true;
      await expect(initializer).resolves.toMatchObject({ success: true });

      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    } finally {
      if (!initializerFinished && finishInitializer) {
        finishInitializer({ autoStarted: true, operationId: 'op-continuation', success: true });
        await initializer.catch(() => undefined);
      }
      vi.useRealTimers();
    }
  });

  it('keeps a generic claim through a busy concurrent retry and rebuilds after release', async () => {
    vi.useFakeTimers();
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000096';
    mockFindMessagePlugin.mockResolvedValue({
      ...pendingToolPlugin,
      intervention: { operationId: 'op-parked', status: 'pending' },
    });
    let rejectFirstHistory!: (error: Error) => void;
    let markFirstHistoryStarted!: () => void;
    const firstHistoryStarted = new Promise<void>((resolve) => {
      markFirstHistoryStarted = resolve;
    });
    const firstHistory = new Promise<never>((_, reject) => {
      rejectFirstHistory = reject;
    });
    mockResolveHumanApproval.mockResolvedValueOnce('applied').mockResolvedValueOnce('idempotent');
    mockTryReserveTaskCallback.mockResolvedValueOnce(true).mockResolvedValue(false);
    mockMessageQuery
      .mockImplementationOnce(() => {
        markFirstHistoryStarted();
        return firstHistory;
      })
      .mockResolvedValueOnce([{ content: 'hi', id: 'history-1', role: 'user' }]);
    const input = {
      ...baseParams,
      approvalResolutionRequestId,
      approvalSourceOperationId: 'op-parked',
      resumeApproval: {
        decision: 'approved' as const,
        parentMessageId: 'tool-msg-1',
        toolCallId: 'call_xyz',
      },
    };

    const appliedAttempt = service.execAgent(input);
    let firstSettled = false;
    try {
      await firstHistoryStarted;
      const busyRetry = service.execAgent(input);
      const busyExpectation = expect(busyRetry).rejects.toThrow(/remained busy/);
      await vi.runAllTimersAsync();
      await busyExpectation;

      rejectFirstHistory(new Error('first attempt crashed before ready'));
      await expect(appliedAttempt).rejects.toThrow('first attempt crashed before ready');
      firstSettled = true;
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();

      mockTryReserveTaskCallback.mockResolvedValue(true);
      await expect(service.execAgent(input)).resolves.toMatchObject({ success: true });
      expect(mockCreateOperation).toHaveBeenCalledTimes(1);
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    } finally {
      if (!firstSettled) {
        rejectFirstHistory(new Error('test cleanup'));
        await appliedAttempt.catch(() => undefined);
      }
      vi.useRealTimers();
    }
  });

  describe('validation guards', () => {
    it('throws when the parent message is not role=tool', async () => {
      mockFindById.mockResolvedValue({ ...pendingToolMessage, role: 'user' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/role='tool'/);
    });

    it('throws when the stored tool_call_id does not match the resume request', async () => {
      // toolCallId lives on the plugin row — mutate the plugin mock, not the
      // message. This is exactly the class of bug that the separate-table
      // fetch guards against.
      mockFindMessagePlugin.mockResolvedValue({ ...pendingToolPlugin, toolCallId: 'call_other' });

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/toolCallId mismatch/);
    });

    it('throws when no plugin row exists for the target message', async () => {
      mockFindMessagePlugin.mockResolvedValue(undefined);

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: 'tool-msg-1',
            toolCallId: 'call_xyz',
          },
        }),
      ).rejects.toThrow(/no plugin row/);
    });

    it('rejects a batch whose targets belong to different assistant turns', async () => {
      // A batch resume runs every approved tool as ONE `call_tools_batch` under
      // ONE assistant anchor and continues the model once. Mixing an abandoned
      // approval from an earlier turn would execute an unrelated tool and fold
      // its result into this turn. Anchoring on whichever entry came first is
      // silent corruption, so refuse instead.
      mockFindById.mockImplementation(async (id: string) =>
        id === 'tool-msg-old'
          ? { ...pendingToolMessage, id: 'tool-msg-old', parentId: 'assistant-old' }
          : { ...pendingToolMessage, parentId: 'assistant-new' },
      );

      await expect(
        service.execAgent({
          ...baseParams,
          resumeApprovals: [
            { decision: 'approved', parentMessageId: 'tool-msg-1', toolCallId: 'call_xyz' },
            { decision: 'approved', parentMessageId: 'tool-msg-old', toolCallId: 'call_xyz' },
          ],
        }),
      ).rejects.toThrow(/must resolve one assistant turn/);

      // Nothing may be persisted: validation runs before any write, so a
      // refused batch cannot leave half its tools marked approved with no run
      // to execute them.
      expect(mockUpdateMessagePlugin).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('accepts a batch whose targets share one assistant turn', async () => {
      mockFindById.mockImplementation(async (id: string) => ({
        ...pendingToolMessage,
        id,
        parentId: 'assistant-new',
      }));
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        intervention: {
          batchId: 'batch-parked',
          operationId: 'op-parked',
          status: 'pending',
        },
      });
      mockFindOperationById.mockResolvedValue({ id: 'op-parked', status: 'waiting_for_human' });
      mockInterruptOperation.mockResolvedValue(true);
      mockRecordCompletion.mockResolvedValue(true);

      await service.execAgent({
        ...baseParams,
        approvalSourceOperationId: 'op-parked',
        resumeApprovals: [
          { decision: 'approved', parentMessageId: 'tool-msg-1', toolCallId: 'call_xyz' },
          { decision: 'approved', parentMessageId: 'tool-msg-2', toolCallId: 'call_xyz' },
        ],
      });

      expect(mockResolveHumanApproval).toHaveBeenCalledWith([
        {
          id: 'tool-msg-1',
          intervention: {
            resolutionRequestId: expect.stringMatching(/^legacy_/),
            status: 'approved',
          },
        },
        {
          id: 'tool-msg-2',
          intervention: {
            resolutionRequestId: expect.stringMatching(/^legacy_/),
            status: 'approved',
          },
        },
      ]);
      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({ parentMessageId: 'assistant-new' }),
            phase: 'human_approved_tool',
          }),
        }),
      );
      expect(mockInterruptOperation).toHaveBeenCalledWith('op-parked');
      expect(mockRecordCompletion).toHaveBeenCalledWith(
        'op-parked',
        expect.objectContaining({ completionReason: 'done', status: 'done' }),
      );
    });
  });
});

describe('AiAgentService.stopPendingApproval', () => {
  let service: AiAgentService;

  const pendingToolMessage = {
    createdAt: new Date('2026-08-03T00:00:00.000Z'),
    id: 'tool-msg-1',
    role: 'tool',
    topicId: 'topic-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockImplementation(async (id: string) => ({ ...pendingToolMessage, id }));
    mockFindMessagePlugin.mockResolvedValue({
      intervention: {
        batchId: 'batch-1',
        operationId: 'op-parked-1',
        status: 'pending',
      },
    });
    mockListMessagePluginsByTopic.mockResolvedValue(
      ['tool-msg-1', 'tool-msg-2'].map((id) => ({
        id,
        intervention: {
          batchId: 'batch-1',
          operationId: 'op-parked-1',
          status: 'pending',
        },
      })),
    );
    mockResolveHumanApproval.mockResolvedValue([]);
    mockUpdateMessagePlugin.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue(undefined);
    mockFindOperationById.mockResolvedValue({
      id: 'op-parked-1',
      status: 'waiting_for_human',
      topicId: 'topic-1',
    });
    mockRecordCompletion.mockResolvedValue(undefined);
    mockInterruptOperation.mockResolvedValue(true);
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  it('settles every pending row in place and retires the parked operation', async () => {
    const result = await service.stopPendingApproval({
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    });

    // In place: the approval pause already wrote these rows. Inserting fresh
    // aborted rows would duplicate every tool AND leave the originals pending,
    // which is what keeps the approval cards on screen after a stop.
    expect(mockResolveHumanApproval).toHaveBeenCalledWith([
      {
        content: 'Tool execution was aborted by user.',
        id: 'tool-msg-1',
        intervention: { status: 'aborted' },
      },
      {
        content: 'Tool execution was aborted by user.',
        id: 'tool-msg-2',
        intervention: { status: 'aborted' },
      },
    ]);

    // The exact parked operation and sealed batch identity are validated; a
    // newer operation in the same topic can never be guessed and interrupted.
    expect(mockInterruptOperation).toHaveBeenCalledWith('op-parked-1');
    expect(mockRecordCompletion).toHaveBeenCalledWith(
      'op-parked-1',
      expect.objectContaining({ completionReason: 'interrupted', status: 'interrupted' }),
    );
    expect(result.settledToolMessageIds).toEqual(['tool-msg-1', 'tool-msg-2']);
  });

  it('stamps the generic resolution id on every stopped row', async () => {
    const approvalResolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000098';

    await service.stopPendingApproval({
      approvalResolutionRequestId,
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    });

    expect(mockResolveHumanApproval).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          intervention: { resolutionRequestId: approvalResolutionRequestId, status: 'aborted' },
        }),
      ]),
    );
  });

  it('nothing runs and the model is not continued', async () => {
    mockListMessagePluginsByTopic.mockResolvedValue([
      {
        id: 'tool-msg-1',
        intervention: {
          batchId: 'batch-1',
          operationId: 'op-parked-1',
          status: 'pending',
        },
      },
    ]);
    await service.stopPendingApproval({
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1'],
      topicId: 'topic-1',
    });

    // A stop is not a rejection: a rejection resumes the model so it can
    // respond, a stop ends the turn outright.
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a target from another topic before writing anything', async () => {
    mockFindById.mockImplementation(async (id: string) => ({
      ...pendingToolMessage,
      id,
      topicId: id === 'tool-msg-2' ? 'other-topic' : 'topic-1',
    }));

    await expect(
      service.stopPendingApproval({
        batchId: 'batch-1',
        operationId: 'op-parked-1',
        toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
        topicId: 'topic-1',
      }),
    ).rejects.toThrow(/topicId does not match/);

    // Validation runs before any write, so a refused stop cannot half-clear the
    // batch and strand the rest against a run that is already gone.
    expect(mockResolveHumanApproval).not.toHaveBeenCalled();
    expect(mockInterruptOperation).not.toHaveBeenCalled();
  });
});
