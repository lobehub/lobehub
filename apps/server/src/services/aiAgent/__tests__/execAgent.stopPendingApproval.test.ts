import type { LobeChatDatabase } from '@lobechat/database';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCompleteGroupActionMember,
  mockLoadGroupMemberBridge,
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
  mockCompleteGroupActionMember: vi.fn(),
  mockLoadGroupMemberBridge: vi.fn(),
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
  UserModel: vi.fn().mockImplementation(function () {
    return {
      getUserSettings: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

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
      acceptsArtboardWorks: vi.fn().mockResolvedValue(false),
      acceptsFileWorks: vi.fn().mockResolvedValue(false),
      acceptsMemberRuntimeEnd: vi.fn().mockResolvedValue(false),
      getLlmExecutor: vi.fn().mockResolvedValue(undefined),
      getOperationEditingGroupId: vi.fn().mockResolvedValue(undefined),
      completeGroupActionMember: mockCompleteGroupActionMember,
      createOperation: mockCreateOperation,
      ensureInterventionContinuationStarted: mockEnsureInterventionContinuationStarted,
      interruptOperation: mockInterruptOperation,
      loadGroupMemberBridge: mockLoadGroupMemberBridge,
      loadInterventionContinuationState: mockLoadInterventionContinuationState,
    };
  }),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return {
      findById: mockFindOperationById,
      recordCompletion: mockRecordCompletion,
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
    mockLoadGroupMemberBridge.mockResolvedValue(undefined);
    mockCompleteGroupActionMember.mockResolvedValue(true);
    service = new AiAgentService({} as unknown as LobeChatDatabase, 'user-1');
  });

  it("reports a stopped group member through its bridge so the supervisor isn't stranded", async () => {
    const bridge = {
      anchorMessageId: 'msg-speak',
      expectedMembers: 1,
      groupToolMessageId: 'msg-speak',
      mode: 'in_group',
      onComplete: 'resume',
      parentOperationId: 'op-supervisor',
    };
    mockLoadGroupMemberBridge.mockResolvedValue({ agentId: 'agt-carol', bridge });

    await service.stopPendingApproval({
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    });

    expect(mockCompleteGroupActionMember).toHaveBeenCalledWith({
      ...bridge,
      operationId: 'op-parked-1',
      reason: 'interrupted',
    });
  });

  it('does not touch any bridge when the stopped run is not a group member', async () => {
    await service.stopPendingApproval({
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    });

    expect(mockCompleteGroupActionMember).not.toHaveBeenCalled();
  });

  it('settles every pending row in place and retires the parked operation', async () => {
    const result = await service.stopPendingApproval({
      batchId: 'batch-1',
      operationId: 'op-parked-1',
      toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
      topicId: 'topic-1',
    });

    expect(mockResolveHumanApproval).toHaveBeenCalledWith(
      [
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
      ],
      { publishResult: true },
    );

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
      { publishResult: true },
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

    expect(mockResolveHumanApproval).not.toHaveBeenCalled();
    expect(mockInterruptOperation).not.toHaveBeenCalled();
  });
});
