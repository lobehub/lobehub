import type { LobeChatDatabase } from '@lobechat/database';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';

import { AiAgentService } from '../index';

const hookFetch = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: hookFetch }));

const {
  mockCompleteStopHookNotification,
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
  mockCompleteStopHookNotification: vi.fn(),
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
  MessageModel: vi.fn().mockImplementation(function () {
    return {
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
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return { queryAgents: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
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
    return { query: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: mockReleaseTaskCallbackReservation,
      repairAgentInterventionContinuation: mockRepairAgentInterventionContinuation,
      tryReserveTaskCallback: mockTryReserveTaskCallback,
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
      updateMetadata: mockUpdateTopicMetadata,
    };
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

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getEmailsByIds = async (_db: unknown, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` }));
    getUserSettings = async () => undefined;
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(function () {
    return {
      getLatestPersonaDocument: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: mockCreateOperation,
      ensureInterventionContinuationStarted: mockEnsureInterventionContinuationStarted,
      interruptOperation: mockInterruptOperation,
      loadInterventionContinuationState: mockLoadInterventionContinuationState,
    };
  }),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return {
      findById: mockFindOperationById,
      recordCompletion: mockRecordCompletion,
      completeStopHookNotification: mockCompleteStopHookNotification,
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
    return { uploadFromUrl: vi.fn() };
  }),
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
    // A resumable parked operation has authoritative state, even with no hooks.
    // A missing source is covered separately and must never mean "no hooks".
    mockLoadInterventionContinuationState.mockImplementation(async (operationId: string) =>
      operationId === 'op-parked'
        ? { operationId, origin: { agentId: 'agent-1', topicId: 'topic-1' }, host: { hooks: [] } }
        : null,
    );
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

  it.each(['approved', 'rejected'] as const)(
    'does not hand off a decision already settled by the original operation: %s',
    async (status) => {
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
      mockFindMessagePlugin.mockResolvedValue({
        ...pendingToolPlugin,
        intervention: { operationId: 'op-parked', status },
      });
      try {
        await expect(
          service.execAgent({
            ...baseParams,
            approvalResolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000099',
            approvalSourceOperationId: 'op-parked',
            resumeApproval: {
              decision: status,
              parentMessageId: 'tool-msg-1',
              toolCallId: 'call_xyz',
            },
          }),
        ).rejects.toThrow();
        expect(mockResolveHumanApproval).not.toHaveBeenCalled();
        expect(mockCreateOperation).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
      } finally {
        dispatch.mockRestore();
      }
    },
  );

  it('retains source hooks and groups mixed decision notifications only on the durable continuation', async () => {
    mockFindById.mockImplementation(async (id: string) => ({
      ...pendingToolMessage,
      id,
      parentId: 'assistant-source',
    }));
    mockFindMessagePlugin.mockImplementation(async (id: string) => ({
      ...pendingToolPlugin,
      toolCallId: `call-${id}`,
      intervention: { status: 'pending', operationId: 'op-parked' },
    }));
    const hooks = [
      {
        id: 'control',
        type: 'beforeToolCall',
        webhook: { url: 'https://hooks.example/control', responseHandling: 'toolCall' },
      },
      {
        id: 'after-human',
        type: 'afterHumanIntervention',
        webhook: { url: 'https://hooks.example/after' },
      },
    ];
    mockLoadInterventionContinuationState.mockResolvedValue({
      origin: { agentId: 'agent-1', topicId: 'topic-1', userId: 'user-1' },
      principal: {
        actor: {
          shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
        },
      },
      host: { hooks },
    });
    mockFindOperationById.mockResolvedValue({ status: 'waiting_for_human' });
    await service.execAgent({
      ...baseParams,
      resumeApprovals: [
        { decision: 'approved', parentMessageId: 'tool-msg-1', toolCallId: 'call-tool-msg-1' },
        { decision: 'approved', parentMessageId: 'tool-msg-2', toolCallId: 'call-tool-msg-2' },
        {
          decision: 'rejected',
          parentMessageId: 'tool-msg-3',
          toolCallId: 'call-tool-msg-3',
          rejectionReason: 'no',
        },
        {
          decision: 'rejected_continue',
          parentMessageId: 'tool-msg-4',
          toolCallId: 'call-tool-msg-4',
          rejectionReason: 'later',
        },
      ],
    });
    const created = mockCreateOperation.mock.calls[0][0];
    expect(created.hooks).toEqual(hooks);
    expect(
      created.interventionHookEvents.every(
        (event: { userId: string }) => event.userId === 'user-1',
      ),
    ).toBe(true);
    expect(created.interventionHookEvents).toEqual([
      expect.objectContaining({
        operationId: 'op-parked',
        action: 'approve',
        toolCallIds: ['call-tool-msg-1', 'call-tool-msg-2'],
      }),
      expect.objectContaining({
        action: 'reject',
        rejectionReason: 'no',
        toolCallIds: ['call-tool-msg-3'],
      }),
      expect.objectContaining({
        action: 'rejectAndContinue',
        rejectionReason: 'later',
        toolCallIds: ['call-tool-msg-4'],
      }),
    ]);
  });

  describe.each(['missing', 'load_error'] as const)(
    'unavailable approval source: %s',
    (sourceFailure) => {
      it.each([
        { durable: false, form: 'single' },
        { durable: false, form: 'batch' },
        { durable: false, form: 'mixed' },
        { durable: false, form: 'partial' },
        { durable: true, form: 'single' },
        { durable: true, form: 'batch' },
        { durable: true, form: 'mixed' },
        { durable: true, form: 'partial' },
        { durable: true, form: 'incomplete' },
      ] as const)(
        'fails closed for $form with durable claim=$durable',
        async ({ durable, form }) => {
          const originalArgs = { path: 'A.txt', content: 'original A' };
          const effectiveArgs = { path: 'B.txt', content: 'reviewed B' };
          const preparation = {
            originalArgs,
            effectiveArgs,
            additionalContexts: [{ hookId: 'control', text: 'context B' }],
            status: 'ready',
          };
          const intervention = {
            batchId: 'batch-parked',
            operationId: 'op-parked',
            status: 'pending',
          };
          mockFindById.mockImplementation(async (id: string) =>
            id.startsWith('tool-msg-')
              ? { ...pendingToolMessage, id, parentId: 'assistant-source', content: '' }
              : undefined,
          );
          mockFindOperationById.mockResolvedValue({ id: 'op-parked', status: 'waiting_for_human' });
          mockInterruptOperation.mockResolvedValue(true);
          mockRecordCompletion.mockResolvedValue(true);
          mockFindMessagePlugin.mockImplementation(async (id: string) => ({
            ...pendingToolPlugin,
            arguments: JSON.stringify(effectiveArgs),
            toolCallId: `call-${id}`,
            intervention,
            state: { hookPreparation: preparation },
          }));
          // Missing/expired source, including an incomplete deterministic state
          // that cannot be scheduled and must not be rebuilt without its hooks.
          mockLoadInterventionContinuationState.mockImplementation(async (id: string) => {
            if (id === 'op-parked' && sourceFailure === 'load_error') {
              throw new Error('source store unavailable');
            }
            return form === 'incomplete' && id !== 'op-parked'
              ? { operationId: id, status: 'idle' }
              : null;
          });
          // A partial decision must not touch another still-pending sibling or
          // start reading/rebuilding the continuation history before source validation.
          const pendingSibling = {
            ...pendingToolMessage,
            id: 'tool-msg-2',
            parentId: 'assistant-source',
            pluginIntervention: intervention,
            tool_call_id: 'call-tool-msg-2',
          };
          if (form === 'partial') mockMessageQuery.mockResolvedValue([pendingSibling]);
          const entries = [
            {
              decision: 'approved' as const,
              parentMessageId: 'tool-msg-1',
              toolCallId: 'call-tool-msg-1',
            },
            ...(form === 'batch' || form === 'mixed'
              ? [
                  {
                    decision:
                      form === 'mixed' ? ('rejected_continue' as const) : ('approved' as const),
                    parentMessageId: 'tool-msg-2',
                    toolCallId: 'call-tool-msg-2',
                  },
                ]
              : []),
          ];
          const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
          try {
            const result = service.execAgent({
              ...baseParams,
              ...(durable
                ? {
                    approvalSourceOperationId: 'op-parked',
                    approvalResolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000092',
                  }
                : {}),
              ...(entries.length === 1
                ? { resumeApproval: entries[0] }
                : { resumeApprovals: entries }),
            });
            await expect(result).rejects.toThrow(
              sourceFailure === 'missing'
                ? 'Approval source runtime state is missing or expired: op-parked'
                : 'source store unavailable',
            );
            if (durable) {
              // The generic claim is its own retry record; do not reopen it under
              // a concurrent same-request caller that may already own a continuation.
              expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
            } else {
              expect(mockRestoreHumanApproval).toHaveBeenCalledExactlyOnceWith(
                entries.map((entry) => ({
                  claimedResolutionRequestId: expect.stringMatching(/^legacy_/),
                  id: entry.parentMessageId,
                  content: '',
                  intervention,
                  pluginState: { hookPreparation: preparation },
                  replacePluginState: true,
                })),
              );
            }
            expect(mockMessageCreate).not.toHaveBeenCalled();
            expect(mockMessageQuery).not.toHaveBeenCalled();
            expect(
              mockResolveHumanApproval.mock.calls[0][0].map(({ id }: { id: string }) => id),
            ).toEqual(entries.map(({ parentMessageId }) => parentMessageId));
            expect(mockLoadInterventionContinuationState).toHaveBeenCalledWith('op-parked');
            expect(mockCreateOperation).not.toHaveBeenCalled();
            expect(mockEnsureInterventionContinuationStarted).not.toHaveBeenCalled();
            expect(mockInterruptOperation).not.toHaveBeenCalled();
            expect(mockRecordCompletion).not.toHaveBeenCalled();
            expect(mockUpdateToolMessage).not.toHaveBeenCalled();
            expect(mockUpdateMessagePlugin).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(hookFetch).not.toHaveBeenCalled();
          } finally {
            dispatch.mockRestore();
          }
        },
      );
    },
  );

  it.each([false, true])(
    'retries a transient source read failure with durable claim=%s',
    async (durable) => {
      const requestId = '018fbd8e-7baf-7c6d-8000-000000000091';
      const reviewedArguments = '{"path":"B.txt"}';
      let claimedBy: string | undefined;
      let sourceAvailable = false;
      const hooks = [
        {
          id: 'control',
          type: 'beforeToolCall',
          webhook: { url: 'https://hooks.example/control', responseHandling: 'toolCall' },
        },
      ];
      mockFindMessagePlugin.mockImplementation(async () => ({
        ...pendingToolPlugin,
        arguments: reviewedArguments,
        intervention: {
          operationId: 'op-parked',
          status: claimedBy ? 'approved' : 'pending',
          ...(claimedBy
            ? { resolutionRequestId: claimedBy, approvedArguments: reviewedArguments }
            : {}),
        },
      }));
      mockResolveHumanApproval.mockImplementation(
        async (rows: { intervention: { resolutionRequestId: string } }[]) => {
          claimedBy = rows[0].intervention.resolutionRequestId;
          return 'applied';
        },
      );
      mockRestoreHumanApproval.mockImplementation(async () => {
        claimedBy = undefined;
      });
      mockLoadInterventionContinuationState.mockImplementation(async (id: string) => {
        if (id !== 'op-parked') return null;
        if (!sourceAvailable) throw new Error('source store unavailable');
        return {
          operationId: id,
          origin: { agentId: 'agent-1', topicId: 'topic-1' },
          host: { hooks },
        };
      });
      mockFindOperationById.mockResolvedValue({ id: 'op-parked', status: 'waiting_for_human' });
      mockInterruptOperation.mockResolvedValue(true);
      mockRecordCompletion.mockResolvedValue(true);
      const input = {
        ...baseParams,
        ...(durable
          ? { approvalSourceOperationId: 'op-parked', approvalResolutionRequestId: requestId }
          : {}),
        resumeApproval: {
          decision: 'approved' as const,
          parentMessageId: 'tool-msg-1',
          toolCallId: 'call_xyz',
        },
      };
      await expect(service.execAgent(input)).rejects.toThrow('source store unavailable');
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockMessageCreate).not.toHaveBeenCalled();
      expect(claimedBy).toBe(durable ? requestId : undefined);

      sourceAvailable = true;
      await expect(service.execAgent(input)).resolves.toMatchObject({ success: true });
      expect(mockCreateOperation).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ hooks }),
      );
      expect(mockResolveHumanApproval).toHaveBeenCalledTimes(durable ? 1 : 2);
      expect(mockRestoreHumanApproval).toHaveBeenCalledTimes(durable ? 0 : 1);
      expect(
        mockLoadInterventionContinuationState.mock.calls.filter(([id]) => id === 'op-parked'),
      ).toHaveLength(2);
      if (durable) {
        expect(mockCreateOperation).toHaveBeenCalledWith(
          expect.objectContaining({
            interventionResolution: expect.objectContaining({ resolutionRequestId: requestId }),
          }),
        );
      }
    },
  );

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
      mockCompleteStopHookNotification.mockResolvedValue(true);
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
      expect(mockCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ hooks: [] }));
      expect(mockLoadInterventionContinuationState).toHaveBeenCalledExactlyOnceWith('op-parked');
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
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
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
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();

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
      origin: {
        agentId: 'agent-1',
        continuation: {
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

  it('marks a reused ready continuation as a normal runtime without recreating notifications', async () => {
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
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
    mockLoadInterventionContinuationState.mockImplementation(async (id: string) => {
      if (id === 'op-parked') throw new Error('expired source must not be loaded for ready reuse');
      return id === continuationOperationId
        ? {
            metadata: {
              agentInterventionPreparation: {
                resolutionRequestId: approvalResolutionRequestId,
                state: 'ready',
              },
            },
            origin: {
              agentId: 'agent-1',
              continuation: provenance,
              sourceMessageId: 'tool-msg-1',
              topicId: 'topic-1',
              userId: 'user-1',
            },
            operationId: continuationOperationId,
            status: 'idle',
            host: {
              hooks: [
                {
                  id: 'control',
                  type: 'beforeToolCall',
                  webhook: { url: 'https://hooks.example/control', responseHandling: 'toolCall' },
                },
              ],
            },
          }
        : null;
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
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
    expect(mockCreateOperation).not.toHaveBeenCalled();
    expect(mockLoadInterventionContinuationState).toHaveBeenCalledExactlyOnceWith(
      continuationOperationId,
    );
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
        agentInterventionDispatch: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          resolutionRequestId,
          state: 'scheduled',
        },
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: 'op-parked',
          sourceToolMessageIds: ['tool-msg-1'],
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
        agentInterventionDispatch: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          resolutionRequestId,
          state: 'scheduled',
        },
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: 'op-parked',
          sourceToolMessageIds: ['tool-msg-1'],
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
    mockCreateOperation.mockImplementationOnce(function () {
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
    mockCreateOperation.mockImplementationOnce(function () {
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
      .mockImplementationOnce(function () {
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
      mockCompleteStopHookNotification.mockResolvedValue(true);
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
    mockCompleteStopHookNotification.mockResolvedValue(true);
    mockRecordCompletion.mockResolvedValue(true);
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

  it.each(['none', undefined] as const)(
    'retries critical stop failure without restarting business; ordinary fallback=%s is consumed',
    async (fallback) => {
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
      let stopped = false;
      let pendingStopHookBatchId: string | undefined;
      mockResolveHumanApproval.mockResolvedValue('applied');
      mockFindMessagePlugin.mockImplementation(async (id: string) => ({
        toolCallId: `native-${id}`,
        intervention: {
          operationId: 'op-parked-1',
          batchId: 'batch-1',
          status: stopped ? 'aborted' : 'pending',
          resolutionRequestId: 'stop-retry',
        },
      }));
      mockFindOperationById.mockImplementation(async () => ({
        id: 'op-parked-1',
        topicId: 'topic-1',
        status: stopped ? 'interrupted' : 'waiting_for_human',
        metadata: { pendingStopHookBatchId },
      }));
      mockRecordCompletion.mockImplementation(async (_id, params) => {
        stopped = true;
        pendingStopHookBatchId = params.pendingStopHookBatchId;
        return true;
      });
      mockCompleteStopHookNotification.mockImplementation(async () => {
        pendingStopHookBatchId = undefined;
        return true;
      });
      mockLoadInterventionContinuationState.mockResolvedValue({
        origin: { userId: 'user-1' },
        principal: {
          actor: {
            shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
          },
        },
        host: {
          hooks: [
            {
              id: 'stop-retry',
              type: 'onStopByHumanIntervention',
              webhook: { url: 'https://hooks.example/stop', fallback, body: { userId: 'user-1' } },
            },
          ],
        },
      });
      hookFetch.mockImplementation(async () => {
        expect(stopped).toBe(true);
        return new Response('', { status: 503 });
      });
      const params = {
        approvalResolutionRequestId: 'stop-retry',
        batchId: 'batch-1',
        operationId: 'op-parked-1',
        toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
        topicId: 'topic-1',
      };
      const expectForeignRequestsRejected = async () => {
        const before = {
          claims: mockResolveHumanApproval.mock.calls.length,
          completions: mockRecordCompletion.mock.calls.length,
          consumes: mockCompleteStopHookNotification.mock.calls.length,
          deliveries: hookFetch.mock.calls.length,
          pendingStopHookBatchId,
        };
        for (const override of [
          { approvalResolutionRequestId: 'another-resolution' },
          { approvalResolutionRequestId: undefined },
          { batchId: 'another-batch' },
          { toolMessageIds: ['tool-msg-1'] },
        ]) {
          await expect(service.stopPendingApproval({ ...params, ...override })).rejects.toThrow();
        }
        expect(mockResolveHumanApproval).toHaveBeenCalledTimes(before.claims);
        expect(mockRecordCompletion).toHaveBeenCalledTimes(before.completions);
        expect(mockCompleteStopHookNotification).toHaveBeenCalledTimes(before.consumes);
        expect(hookFetch).toHaveBeenCalledTimes(before.deliveries);
        expect(pendingStopHookBatchId).toBe(before.pendingStopHookBatchId);
      };
      if (fallback === 'none') {
        await expect(service.stopPendingApproval(params)).rejects.toThrow();
        expect(pendingStopHookBatchId).toBe('batch-1');
        await expectForeignRequestsRejected();
        // The same request must not report success while delivery still fails.
        await expect(service.stopPendingApproval(params)).rejects.toThrow();
        expect(mockCompleteStopHookNotification).not.toHaveBeenCalled();
        mockLoadInterventionContinuationState.mockResolvedValueOnce(null);
        await expect(service.stopPendingApproval(params)).rejects.toThrow('state is unavailable');
        expect(hookFetch).toHaveBeenCalledTimes(2);
        hookFetch.mockImplementation(async () => new Response('{}'));
        // Recreate the service to exclude an implicit in-process retry cache.
        service = new AiAgentService({} as LobeChatDatabase, 'user-1');
        // A failed completion checkpoint may redeliver, but cannot fake success.
        mockCompleteStopHookNotification.mockResolvedValueOnce(false);
        await expect(service.stopPendingApproval(params)).rejects.toThrow(
          'completion was not persisted',
        );
        await expect(service.stopPendingApproval(params)).resolves.toMatchObject({ success: true });
        expect(hookFetch).toHaveBeenCalledTimes(4);
      } else {
        await expect(service.stopPendingApproval(params)).resolves.toMatchObject({ success: true });
        expect(hookFetch).toHaveBeenCalledTimes(1);
      }
      expect(pendingStopHookBatchId).toBeUndefined();
      await expectForeignRequestsRejected();
      expect(
        hookFetch.mock.calls.every(([, init]) => {
          const payload = JSON.parse(init.body);
          return payload.userId === 'user-1' && payload.userEmail === 'user-1@example.test';
        }),
      ).toBe(true);
      expect(dispatch).toHaveBeenCalledWith(
        'op-parked-1',
        'onStopByHumanIntervention',
        expect.objectContaining({ userId: 'user-1' }),
        expect.any(Array),
        { ownerUserId: 'user-1' },
      );
      dispatch.mockRestore();
      const delivered = hookFetch.mock.calls.length;
      await service.stopPendingApproval(params);
      expect(hookFetch).toHaveBeenCalledTimes(delivered);
      expect(mockInterruptOperation).toHaveBeenCalledTimes(1);
      expect(mockRecordCompletion).toHaveBeenCalledTimes(1);
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockEnsureInterventionContinuationStarted).not.toHaveBeenCalled();
      expect(mockRestoreHumanApproval).not.toHaveBeenCalled();
    },
  );

  it('notifies the complete native stop set after persistence and skips deterministic replay', async () => {
    const resolutionRequestId = 'stop-resolution';
    let stopped = false;
    const notify = vi.fn(async (_event: unknown) => {
      expect(stopped).toBe(true);
    });
    hookDispatcher.register('op-parked-1', [
      { id: 'stop', type: 'onStopByHumanIntervention', handler: notify },
    ]);
    mockLoadInterventionContinuationState.mockResolvedValue({ origin: { agentId: 'agent-1' } });
    mockResolveHumanApproval.mockResolvedValue('applied');
    mockFindMessagePlugin.mockImplementation(async (id: string) => ({
      toolCallId: `native-${id}`,
      intervention: {
        operationId: 'op-parked-1',
        batchId: 'batch-1',
        status: stopped ? 'aborted' : 'pending',
        resolutionRequestId,
      },
    }));
    mockFindOperationById.mockImplementation(async () => ({
      id: 'op-parked-1',
      topicId: 'topic-1',
      status: stopped ? 'interrupted' : 'waiting_for_human',
    }));
    mockRecordCompletion.mockImplementation(async () => {
      stopped = true;
      return true;
    });
    const params = {
      approvalResolutionRequestId: resolutionRequestId,
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    };
    try {
      await service.stopPendingApproval(params);
      await service.stopPendingApproval(params);
      expect(notify).toHaveBeenCalledTimes(1);
      // Stop has no continuation and must deliver inline without scheduling one.
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockEnsureInterventionContinuationStarted).not.toHaveBeenCalled();
      expect(notify.mock.calls[0][0]).toMatchObject({
        toolCallIds: ['native-tool-msg-1', 'native-tool-msg-2'],
        reason: 'user_stop',
      });
    } finally {
      hookDispatcher.unregister('op-parked-1');
    }
  });

  it('does not notify a stop that the runtime failed to acknowledge', async () => {
    const notify = vi.fn();
    hookDispatcher.register('op-parked-1', [
      { id: 'stop', type: 'onStopByHumanIntervention', handler: notify },
    ]);
    mockLoadInterventionContinuationState.mockResolvedValue({ origin: {} });
    mockResolveHumanApproval.mockResolvedValue('applied');
    mockInterruptOperation.mockResolvedValue(false);
    try {
      await expect(
        service.stopPendingApproval({
          batchId: 'batch-1',
          operationId: 'op-parked-1',
          toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('not acknowledged');
      expect(notify).not.toHaveBeenCalled();
      expect(mockRecordCompletion).not.toHaveBeenCalled();
    } finally {
      hookDispatcher.unregister('op-parked-1');
    }
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
