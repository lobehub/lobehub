// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, messagePlugins, messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

const business = vi.hoisted(() => ({
  getHeteroInterventionReview: vi.fn(),
  onHeteroInterventionResolutionPublished: vi.fn(),
  resolveHeteroIntervention: vi.fn(),
  rollbackHeteroInterventionResolution: vi.fn(),
}));
vi.mock('@/business/server/agent-run/heteroInterventionReview', () => business);

const businessV2 = vi.hoisted(() => ({
  getAgentInterventionReview: vi.fn(),
  getAgentInterventionReviewBySource: vi.fn(),
  onAgentInterventionResolutionPublished: vi.fn(),
  resolveAgentIntervention: vi.fn(),
  resolveAgentInterventionBySource: vi.fn(),
  rollbackAgentInterventionResolution: vi.fn(),
}));
vi.mock('@/business/server/agent-run/agentInterventionReview', () => businessV2);

const aiAgentService = vi.hoisted(() => ({
  ensureInterventionContinuationStarted: vi.fn(),
  execAgent: vi.fn(),
  loadInterventionContinuationState: vi.fn(),
  repairInterventionContinuationTopicAnchor: vi.fn(),
  retirePendingApprovalOperation: vi.fn(),
  stopPendingApproval: vi.fn(),
}));

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Shared in-memory stream backing both procedures. The remote HITL loop only
// touches `publishStreamEvent` (browser leg) + `readEventsOnce` (exec leg), so a
// tiny store-backed stub of the factory is enough to exercise the round-trip
// without a live Redis. An unknown `lastEventId` reads from the start (mirrors
// Redis `XREAD 0`); `'$'` means from-now.
const { store } = vi.hoisted(() => ({
  store: { events: [] as any[], failPublish: false, seq: 0 },
}));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({
    async publishStreamEvent(operationId: string, event: any) {
      if (store.failPublish) throw new Error('stream publish failed');
      const id = String(++store.seq);
      store.events.push({ ...event, id, operationId });
      return id;
    },
    async readEventsOnce(operationId: string, lastEventId = '$') {
      const all = store.events.filter((e) => e.operationId === operationId);
      if (lastEventId === '$') return { events: [], lastEventId: all.at(-1)?.id ?? '0' };
      const idx = all.findIndex((e) => e.id === lastEventId);
      const events = idx >= 0 ? all.slice(idx + 1) : all.slice();
      return { events, lastEventId: events.at(-1)?.id ?? lastEventId };
    },
  }),
}));

// Services constructed by the aiAgentProcedure / heteroAgentProcedure middleware
// — stub so the test stays isolated from their real deps.
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => aiAgentService),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(() => ({})),
}));

describe('aiAgentRouter — remote Human-in-the-loop', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    store.events.length = 0;
    store.failPublish = false;
    store.seq = 0;
    business.getHeteroInterventionReview.mockResolvedValue({ status: 'unavailable' });
    business.onHeteroInterventionResolutionPublished.mockResolvedValue(undefined);
    business.resolveHeteroIntervention.mockResolvedValue({ handled: false });
    business.rollbackHeteroInterventionResolution.mockResolvedValue(undefined);
    businessV2.getAgentInterventionReview.mockResolvedValue({
      authorization: { canResolve: false, canView: false },
      contractVersion: 2,
      status: 'unavailable',
    });
    businessV2.getAgentInterventionReviewBySource.mockResolvedValue({ handled: false });
    businessV2.onAgentInterventionResolutionPublished.mockResolvedValue(undefined);
    businessV2.resolveAgentIntervention.mockResolvedValue({ handled: false });
    businessV2.resolveAgentInterventionBySource.mockResolvedValue({ handled: false });
    businessV2.rollbackAgentInterventionResolution.mockResolvedValue(undefined);
    aiAgentService.execAgent.mockResolvedValue(undefined);
    aiAgentService.ensureInterventionContinuationStarted.mockResolvedValue('scheduled');
    aiAgentService.loadInterventionContinuationState.mockResolvedValue(null);
    aiAgentService.repairInterventionContinuationTopicAnchor.mockResolvedValue(undefined);
    aiAgentService.retirePendingApprovalOperation.mockResolvedValue(undefined);
    aiAgentService.stopPendingApproval.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  // Browser leg: user JWT.
  const userCaller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);
  // Exec leg: operation-bound JWT claims produced by the server signer.
  const heteroCaller = (operationId: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId },
      oidcAuth: {
        aud: 'urn:lobehub:hetero-operation',
        capabilities: ['hetero:intervention:read'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'urn:lobehub:internal',
        jti: `jti-${operationId}`,
        operation_id: operationId,
        purpose: 'hetero-operation',
        sub: userId,
      },
      userId,
    } as any);
  // Exec leg from a token minted before operation-bound claims were deployed.
  const legacyHeteroCaller = (sub: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId: sub },
      oidcAuth: { purpose: 'hetero-operation', sub },
      userId: sub,
    } as any);
  // Exec leg via an owner OIDC token (a desktop reusing its own session): a
  // normal token whose `purpose` is NOT `hetero-operation` → heteroAuthKind
  // resolves to 'user', so the ownership guard applies.
  const ownerTokenCaller = (sub: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId: sub },
      oidcAuth: { sub },
      userId: sub,
    } as any);

  const insertOperation = async (id: string, ownerId: string) => {
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agentOperations).values({ id, status: 'running', userId: ownerId });
  };

  const insertPendingTool = async (params: {
    batchId: string;
    messageId: string;
    operationId: string;
    ownerUserId?: string;
    toolCallId: string;
  }) => {
    const ownerUserId = params.ownerUserId ?? userId;
    await serverDB.insert(messages).values({
      content: '',
      id: params.messageId,
      role: 'tool',
      userId: ownerUserId,
    });
    await serverDB.insert(messagePlugins).values({
      apiName: 'editFile',
      arguments: '{"path":"/tmp/a"}',
      id: params.messageId,
      identifier: 'lobe-local-system',
      intervention: {
        batchId: params.batchId,
        operationId: params.operationId,
        status: 'pending',
      },
      toolCallId: params.toolCallId,
      type: 'default',
      userId: ownerUserId,
    });
  };

  it('submit → wait round-trips a structured answer, filtered to the response', async () => {
    const operationId = 'op-roundtrip';
    await insertOperation(operationId, userId);
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000001';
    await expect(
      userCaller().submitHeteroIntervention({
        operationId,
        resolutionRequestId,
        result: { 'Which env?': 'prod' },
        toolCallId: 't1',
      }),
    ).resolves.toEqual({ status: 'resolving', success: true });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe('agent_intervention_response');
    expect(res.events[0].data).toMatchObject({
      result: { 'Which env?': 'prod' },
      producerAck: false,
      resolutionRequestId,
      toolCallId: 't1',
    });
    expect(res.events[0].data.cancelled).toBeUndefined();
  });

  it('looks up cold-start review by a strict 32-byte base64url token', async () => {
    const reviewToken = 'a'.repeat(43);
    business.getHeteroInterventionReview.mockResolvedValueOnce({
      review: {
        apiName: 'askUserQuestion',
        deadline: 1_900_000_000_000,
        interactionKind: 'permission',
        provider: 'cursor',
        renderArguments: '{"questions":[]}',
        summary: 'Cursor permission',
      },
      status: 'pending',
    });

    await expect(userCaller().getHeteroInterventionReview({ reviewToken })).resolves.toMatchObject({
      review: { interactionKind: 'permission', provider: 'cursor' },
      status: 'pending',
    });
    expect(business.getHeteroInterventionReview).toHaveBeenCalledWith({
      reviewToken,
      userId,
      workspaceId: undefined,
    });
    await expect(
      userCaller().getHeteroInterventionReview({ reviewToken: 'too-short' }),
    ).rejects.toThrow();
  });

  it('forwards authenticated v2 Review lookup through the POST-body business slot', async () => {
    const reviewToken = 'b'.repeat(43);
    businessV2.getAgentInterventionReview.mockResolvedValueOnce({
      authorization: { canResolve: true, canView: true },
      contractVersion: 2,
      conversationUrl: '/chat/topic-1',
      review: {
        batch: {
          allowedActions: [],
          id: 'batch-1',
          itemIds: ['item-1'],
          kind: 'single',
          version: 1,
        },
        context: { operationId: 'op-v2', topicId: 'topic-1' },
        id: 'review-1',
        items: [],
        summary: 'Review request',
        systemActionEligibility: 'review_only',
      },
      status: 'pending',
    });

    await expect(userCaller().getAgentInterventionReview({ reviewToken })).resolves.toMatchObject({
      authorization: { canResolve: true, canView: true },
      contractVersion: 2,
      status: 'pending',
    });
    expect(businessV2.getAgentInterventionReview).toHaveBeenCalledWith({
      reviewToken,
      userId,
      workspaceId: undefined,
    });
  });

  it('returns a read-only authoritative source Review before chat controls are rendered', async () => {
    businessV2.getAgentInterventionReviewBySource.mockResolvedValueOnce({
      authorization: { canResolve: false, canView: true, denialReason: 'view_only' },
      contractVersion: 2,
      handled: true,
      review: {
        batch: {
          allowedActions: [],
          id: 'batch-source-read',
          itemIds: ['item-source-read'],
          kind: 'single',
          version: 1,
        },
        context: { operationId: 'operation-source-read', topicId: 'topic-source-read' },
        id: 'review-source-read',
        items: [],
        summary: 'Review request',
        systemActionEligibility: 'review_only',
      },
      sourceItemMap: { 'message-source-read': 'item-source-read' },
      status: 'pending',
    });

    await expect(
      userCaller().getAgentInterventionReviewBySource({
        batchId: 'batch-source-read',
        operationId: 'operation-source-read',
        targets: [{ toolCallId: 'call-source-read', toolMessageId: 'message-source-read' }],
      }),
    ).resolves.toMatchObject({
      authorization: { canResolve: false, canView: true, denialReason: 'view_only' },
      contractVersion: 2,
      handled: true,
      sourceItemMap: { 'message-source-read': 'item-source-read' },
      status: 'pending',
    });
    expect(businessV2.getAgentInterventionReviewBySource).toHaveBeenCalledWith({
      actorUserId: userId,
      batchId: 'batch-source-read',
      operationId: 'operation-source-read',
      targets: [{ toolCallId: 'call-source-read', toolMessageId: 'message-source-read' }],
      workspaceId: undefined,
    });
  });

  it('publishes a claimed heterogeneous v2 response and leaves it resolving until producer ACK', async () => {
    const reviewToken = 'c'.repeat(43);
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000011';
    businessV2.resolveAgentIntervention.mockResolvedValueOnce({
      claimId: 'claim-v2',
      contractVersion: 2,
      handled: true,
      ownerUserId: 'owner-v2',
      resolutionRequestId,
      runtimeAction: {
        operationId: 'op-v2',
        response: {
          producerAck: false,
          resolutionRequestId,
          result: { 'Which env?': 'prod' },
          toolCallId: 'tool-v2',
        },
        stepIndex: 4,
        type: 'heterogeneous_response',
      },
      state: 'claimed',
      workspaceId: 'workspace-v2',
    });

    await expect(
      userCaller().resolveAgentIntervention({
        action: {
          itemId: 'item-v2',
          result: { question_1: 'prod' },
          type: 'submit_answers',
        },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-v2': { hash: 'a'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).resolves.toEqual({ contractVersion: 2, status: 'resolving', success: true });

    expect(store.events.at(-1)).toMatchObject({
      data: {
        producerAck: false,
        resolutionRequestId,
        toolCallId: 'tool-v2',
      },
      operationId: 'op-v2',
      stepIndex: 4,
      type: 'agent_intervention_response',
    });
    expect(businessV2.onAgentInterventionResolutionPublished).toHaveBeenCalledWith({
      actorUserId: userId,
      claimId: 'claim-v2',
      ownerUserId: 'owner-v2',
      resolutionRequestId,
      status: 'resolving',
      workspaceId: 'workspace-v2',
    });
    expect(businessV2.rollbackAgentInterventionResolution).not.toHaveBeenCalled();
  });

  it('routes an active Web approval through the same generic first-winner claim', async () => {
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000021';
    const execution = {
      autoStarted: true,
      messageId: 'assistant-web',
      operationId: 'operation-web-resumed',
      success: true,
    };
    await insertPendingTool({
      batchId: 'batch-web',
      messageId: 'message-web',
      operationId: 'operation-web',
      toolCallId: 'call-web',
    });
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      claimId: 'claim-web',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-web',
        appContext: { topicId: 'topic-web' },
        decisions: [
          {
            decision: 'approved',
            parentMessageId: 'message-web',
            toolCallId: 'call-web',
          },
        ],
        operationId: 'operation-web',
        parentMessageId: 'message-web',
        type: 'resume_approval',
      },
      state: 'claimed',
    });
    aiAgentService.execAgent.mockResolvedValueOnce(execution);

    await expect(
      userCaller().resolveAgentInterventionBySource({
        action: { scope: 'once', type: 'approve_tool' },
        batchId: 'batch-web',
        operationId: 'operation-web',
        resolutionRequestId,
        targets: [{ toolCallId: 'call-web', toolMessageId: 'message-web' }],
      }),
    ).resolves.toEqual({
      contractVersion: 2,
      execution,
      state: 'claimed',
      status: 'approved',
      success: true,
    });

    expect(businessV2.resolveAgentInterventionBySource).toHaveBeenCalledWith({
      action: { scope: 'once', type: 'approve_tool' },
      actorUserId: userId,
      batchId: 'batch-web',
      operationId: 'operation-web',
      resolutionRequestId,
      targets: [{ toolCallId: 'call-web', toolMessageId: 'message-web' }],
      workspaceId: undefined,
    });
    expect(aiAgentService.execAgent).toHaveBeenCalledTimes(1);
    expect(businessV2.onAgentInterventionResolutionPublished).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 'claim-web', status: 'approved' }),
    );
  });

  it('does not dispatch again when another surface already won the source claim', async () => {
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      state: 'already_resolved',
      status: 'approved',
    });

    await expect(
      userCaller().resolveAgentInterventionBySource({
        action: { scope: 'once', type: 'approve_tool' },
        batchId: 'batch-race',
        operationId: 'operation-race',
        resolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000022',
        targets: [{ toolCallId: 'call-race', toolMessageId: 'message-race' }],
      }),
    ).resolves.toEqual({
      contractVersion: 2,
      state: 'already_resolved',
      status: 'approved',
      success: true,
    });

    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
    expect(businessV2.onAgentInterventionResolutionPublished).not.toHaveBeenCalled();
  });

  it('does not synthesize a claim state when the durable source is unavailable', async () => {
    await insertPendingTool({
      batchId: 'batch-unavailable',
      messageId: 'message-unavailable',
      operationId: 'operation-unavailable',
      toolCallId: 'call-unavailable',
    });
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({ handled: false });

    await expect(
      userCaller().resolveAgentInterventionBySource({
        action: { scope: 'once', type: 'approve_tool' },
        batchId: 'batch-unavailable',
        operationId: 'operation-unavailable',
        resolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000027',
        targets: [{ toolCallId: 'call-unavailable', toolMessageId: 'message-unavailable' }],
      }),
    ).resolves.toEqual({
      contractVersion: 2,
      status: 'unavailable',
      success: false,
    });

    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
  });

  it('prevents an old direct execAgent approval from bypassing a generic race winner', async () => {
    await insertPendingTool({
      batchId: 'batch-legacy-race',
      messageId: 'message-legacy-race',
      operationId: 'operation-legacy-race',
      toolCallId: 'call-legacy-race',
    });
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      state: 'already_resolved',
      status: 'approved',
    });

    await expect(
      userCaller().execAgent({
        agentId: 'agent-legacy-race',
        parentMessageId: 'message-legacy-race',
        prompt: '',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'message-legacy-race',
          toolCallId: 'call-legacy-race',
        },
      }),
    ).rejects.toThrow(/already been resolved/i);

    expect(businessV2.resolveAgentInterventionBySource).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { scope: 'once', type: 'approve_tool' },
        actorUserId: userId,
        batchId: 'batch-legacy-race',
        operationId: 'operation-legacy-race',
        targets: [{ toolCallId: 'call-legacy-race', toolMessageId: 'message-legacy-race' }],
      }),
    );
    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
  });

  it('fails an old pre-mutated edit closed on the durable revision conflict', async () => {
    await insertPendingTool({
      batchId: 'batch-legacy-edit',
      messageId: 'message-legacy-edit',
      operationId: 'operation-legacy-edit',
      toolCallId: 'call-legacy-edit',
    });
    businessV2.resolveAgentInterventionBySource.mockRejectedValueOnce(
      new Error('Approval request changed. Refresh before approving edited arguments.'),
    );

    await expect(
      userCaller().execAgent({
        agentId: 'agent-legacy-edit',
        parentMessageId: 'message-legacy-edit',
        prompt: '',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'message-legacy-edit',
          toolCallId: 'call-legacy-edit',
        },
      }),
    ).rejects.toThrow(/refresh before approving edited arguments/i);

    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
  });

  it('dispatches an old direct execAgent approval exactly once through the generic claim', async () => {
    await insertPendingTool({
      batchId: 'batch-legacy-claim',
      messageId: 'message-legacy-claim',
      operationId: 'operation-legacy-claim',
      toolCallId: 'call-legacy-claim',
    });
    const execution = {
      autoStarted: true,
      messageId: 'assistant-resumed',
      operationId: 'operation-resumed',
      success: true,
    };
    aiAgentService.execAgent.mockResolvedValueOnce(execution);
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      claimId: 'claim-legacy',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000026',
      runtimeAction: {
        agentId: 'agent-legacy-claim',
        appContext: { topicId: '' },
        decisions: [
          {
            decision: 'approved',
            parentMessageId: 'message-legacy-claim',
            toolCallId: 'call-legacy-claim',
          },
        ],
        operationId: 'operation-legacy-claim',
        parentMessageId: 'message-legacy-claim',
        type: 'resume_approval',
      },
      state: 'claimed',
    });

    await expect(
      userCaller().execAgent({
        agentId: 'agent-legacy-claim',
        parentMessageId: 'message-legacy-claim',
        prompt: '',
        resumeApproval: {
          decision: 'approved',
          parentMessageId: 'message-legacy-claim',
          toolCallId: 'call-legacy-claim',
        },
      }),
    ).resolves.toEqual(execution);

    expect(aiAgentService.execAgent).toHaveBeenCalledTimes(1);
    expect(aiAgentService.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeApproval: expect.objectContaining({
          parentMessageId: 'message-legacy-claim',
          toolCallId: 'call-legacy-claim',
        }),
      }),
    );
    expect(businessV2.onAgentInterventionResolutionPublished).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 'claim-legacy', status: 'approved' }),
    );
  });

  it('prevents an old direct Stop from bypassing a generic race winner', async () => {
    await insertPendingTool({
      batchId: 'batch-legacy-stop',
      messageId: 'message-legacy-stop',
      operationId: 'operation-legacy-stop',
      toolCallId: 'call-legacy-stop',
    });
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      state: 'already_resolved',
      status: 'stopped',
    });

    await expect(
      userCaller().stopPendingApproval({
        batchId: 'batch-legacy-stop',
        operationId: 'operation-legacy-stop',
        toolMessageIds: ['message-legacy-stop'],
        topicId: '',
      }),
    ).rejects.toThrow(/already been resolved/i);

    expect(aiAgentService.stopPendingApproval).not.toHaveBeenCalled();
  });

  it('dispatches only the authoritative remaining pending rows for a mixed partial Stop', async () => {
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000023';
    await insertPendingTool({
      batchId: 'batch-stop',
      messageId: 'message-pending',
      operationId: 'operation-stop',
      toolCallId: 'call-pending',
    });
    businessV2.resolveAgentInterventionBySource.mockResolvedValueOnce({
      claimId: 'claim-stop',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        batchId: 'batch-stop',
        operationId: 'operation-stop',
        terminalStatus: 'stopped',
        // Cloud derived this pending subset from the full sealed snapshot; a
        // terminal sibling is intentionally absent and remains immutable.
        toolMessageIds: ['message-pending'],
        topicId: 'topic-stop',
        type: 'stop',
      },
      state: 'claimed',
    });

    await userCaller().resolveAgentInterventionBySource({
      action: { scope: 'operation', type: 'stop' },
      batchId: 'batch-stop',
      operationId: 'operation-stop',
      resolutionRequestId,
      targets: [{ toolCallId: 'call-pending', toolMessageId: 'message-pending' }],
    });

    expect(aiAgentService.stopPendingApproval).toHaveBeenCalledWith({
      approvalResolutionRequestId: resolutionRequestId,
      batchId: 'batch-stop',
      operationId: 'operation-stop',
      toolMessageIds: ['message-pending'],
      topicId: 'topic-stop',
    });
  });

  it('restores the authoritative page/task message-map context for a runtime resume', async () => {
    const reviewToken = 'd'.repeat(43);
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000012';
    await insertPendingTool({
      batchId: 'batch-runtime',
      messageId: 'assistant-runtime',
      operationId: 'operation-runtime',
      ownerUserId: userId,
      toolCallId: 'tool-runtime',
    });
    businessV2.resolveAgentIntervention.mockResolvedValueOnce({
      claimId: 'claim-runtime',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-runtime',
        appContext: {
          documentId: 'document-runtime',
          groupId: 'group-runtime',
          scope: 'task',
          taskId: 'task-runtime',
          threadId: 'thread-runtime',
          topicId: 'topic-runtime',
        },
        decisions: [
          {
            decision: 'approved',
            parentMessageId: 'assistant-runtime',
            toolCallId: 'tool-runtime',
          },
        ],
        operationId: 'operation-runtime',
        parentMessageId: 'assistant-runtime',
        type: 'resume_approval',
      },
      state: 'claimed',
    });

    await expect(
      userCaller().resolveAgentIntervention({
        action: {
          itemIds: ['item-runtime'],
          scope: 'once',
          type: 'approve_tool',
        },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-runtime': { hash: 'b'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).resolves.toEqual({ contractVersion: 2, status: 'approved', success: true });

    expect(aiAgentService.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({
          documentId: 'document-runtime',
          scope: 'task',
          taskId: 'task-runtime',
        }),
        taskId: 'task-runtime',
      }),
    );
    expect(aiAgentService.repairInterventionContinuationTopicAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceOperationId: 'operation-runtime',
        threadId: 'thread-runtime',
        topicId: 'topic-runtime',
      }),
    );
  });

  it('surfaces a durable published-hook failure after dispatch instead of reporting success', async () => {
    const reviewToken = 'e'.repeat(43);
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000013';
    await insertPendingTool({
      batchId: 'batch-hook-fail',
      messageId: 'assistant-runtime',
      operationId: 'operation-hook-fail',
      ownerUserId: userId,
      toolCallId: 'tool-runtime',
    });
    businessV2.resolveAgentIntervention.mockResolvedValueOnce({
      claimId: 'claim-hook-fail',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-runtime',
        appContext: { topicId: 'topic-runtime' },
        content: 'skipped',
        operationId: 'operation-hook-fail',
        outcome: 'skipped',
        parentMessageId: 'assistant-runtime',
        toolCallId: 'tool-runtime',
        type: 'resume_tool_result',
      },
      state: 'claimed',
    });
    businessV2.onAgentInterventionResolutionPublished.mockRejectedValueOnce(
      new Error('durable completion failed'),
    );

    await expect(
      userCaller().resolveAgentIntervention({
        action: { itemId: 'item-runtime', type: 'skip_interaction' },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-runtime': { hash: 'c'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).rejects.toThrow('durable completion failed');

    expect(aiAgentService.execAgent).toHaveBeenCalledTimes(1);
    // Runtime dispatch already happened; releasing the claim here could let a
    // second actor execute it again. The idempotent published hook is retried
    // under the same resolutionRequestId instead.
    expect(businessV2.rollbackAgentInterventionResolution).not.toHaveBeenCalled();
  });

  it('retries only the published transition after runtime dispatch already settled the source', async () => {
    const reviewToken = 'f'.repeat(43);
    const messageId = 'message-published-retry';
    const operationId = 'operation-published-retry';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000014';
    await insertPendingTool({
      batchId: 'batch-published-retry',
      messageId,
      operationId,
      toolCallId: 'call-published-retry',
    });
    const claimed = {
      claimId: 'claim-published-retry',
      contractVersion: 2 as const,
      handled: true as const,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-runtime',
        appContext: { topicId: 'topic-runtime' },
        content: 'answer',
        operationId,
        outcome: 'submitted' as const,
        parentMessageId: messageId,
        toolCallId: 'call-published-retry',
        type: 'resume_tool_result' as const,
      },
      state: 'claimed' as const,
    };
    businessV2.resolveAgentIntervention.mockResolvedValue(claimed);
    aiAgentService.execAgent.mockImplementationOnce(async (params) => {
      expect(params).toMatchObject({ approvalResolutionRequestId: resolutionRequestId });
      await serverDB
        .update(messagePlugins)
        .set({
          intervention: {
            batchId: 'batch-published-retry',
            operationId,
            resolutionRequestId,
            status: 'approved',
          },
        })
        .where(eq(messagePlugins.id, messageId));
      return { operationId: 'continued-operation' };
    });
    const continuationOperationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId,
      userId,
    });
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agents).values({ id: 'agent-runtime', userId });
    await serverDB.insert(topics).values({ id: 'topic-runtime', userId });
    await serverDB.insert(agentOperations).values({
      agentId: 'agent-runtime',
      appContext: { sourceMessageId: messageId },
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: operationId,
          sourceToolMessageIds: [messageId],
        },
        agentInterventionDispatch: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          messageId: 'qstash-message-published-retry',
          resolutionRequestId,
          scheduledAt: new Date().toISOString(),
          state: 'scheduled',
        },
      },
      status: 'running',
      topicId: 'topic-runtime',
      userId,
    });
    businessV2.onAgentInterventionResolutionPublished.mockRejectedValueOnce(
      new Error('published transition unavailable'),
    );
    const input = {
      action: {
        itemId: 'item-runtime',
        result: { question_1: 'answer' },
        type: 'submit_answers' as const,
      },
      expectedBatchVersion: 1,
      expectedRequestRevisions: {
        'item-runtime': { hash: 'd'.repeat(64), version: 1 },
      },
      resolutionRequestId,
      reviewToken,
    };

    await expect(userCaller().resolveAgentIntervention(input)).rejects.toThrow(
      'published transition unavailable',
    );
    await expect(userCaller().resolveAgentIntervention(input)).resolves.toMatchObject({
      contractVersion: 2,
      status: 'resolved',
      success: true,
    });

    expect(aiAgentService.execAgent).toHaveBeenCalledTimes(1);
    expect(aiAgentService.retirePendingApprovalOperation).toHaveBeenCalledTimes(2);
    expect(aiAgentService.retirePendingApprovalOperation).toHaveBeenCalledWith(operationId);
    expect(businessV2.onAgentInterventionResolutionPublished).toHaveBeenCalledTimes(2);
    expect(businessV2.rollbackAgentInterventionResolution).not.toHaveBeenCalled();
  });

  it('backfills a lost queue ACK from ready state without rebuilding the continuation', async () => {
    const reviewToken = 'g'.repeat(43);
    const messageId = 'message-ack-backfill';
    const operationId = 'operation-ack-backfill';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000015';
    await insertPendingTool({
      batchId: 'batch-ack-backfill',
      messageId,
      operationId,
      toolCallId: 'call-ack-backfill',
    });
    await serverDB
      .update(messagePlugins)
      .set({
        intervention: {
          batchId: 'batch-ack-backfill',
          operationId,
          resolutionRequestId,
          status: 'approved',
        },
      })
      .where(eq(messagePlugins.id, messageId));
    const claimed = {
      claimId: 'claim-ack-backfill',
      contractVersion: 2 as const,
      handled: true as const,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-ack-backfill',
        appContext: { topicId: 'topic-ack-backfill' },
        content: 'answer',
        operationId,
        outcome: 'submitted' as const,
        parentMessageId: messageId,
        toolCallId: 'call-ack-backfill',
        type: 'resume_tool_result' as const,
      },
      state: 'claimed' as const,
    };
    businessV2.resolveAgentIntervention.mockResolvedValueOnce(claimed);
    const continuationOperationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId,
      userId,
    });
    const deduplicationId = deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0);
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agents).values({ id: 'agent-ack-backfill', userId });
    await serverDB.insert(topics).values({ id: 'topic-ack-backfill', userId });
    await serverDB.insert(agentOperations).values({
      agentId: 'agent-ack-backfill',
      appContext: { sourceMessageId: messageId },
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: operationId,
          sourceToolMessageIds: [messageId],
        },
        agentInterventionPreparation: {
          deduplicationId,
          resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        },
      },
      status: 'running',
      topicId: 'topic-ack-backfill',
      userId,
    });
    aiAgentService.loadInterventionContinuationState.mockResolvedValue({
      metadata: {
        agentId: 'agent-ack-backfill',
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: operationId,
          sourceToolMessageIds: [messageId],
        },
        agentInterventionPreparation: {
          deduplicationId,
          resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        },
        sourceMessageId: messageId,
        topicId: 'topic-ack-backfill',
        userId,
      },
      operationId: continuationOperationId,
      status: 'running',
    });
    aiAgentService.ensureInterventionContinuationStarted.mockResolvedValueOnce('scheduled');

    await expect(
      userCaller().resolveAgentIntervention({
        action: {
          itemId: 'item-ack-backfill',
          result: { question_1: 'answer' },
          type: 'submit_answers',
        },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-ack-backfill': { hash: 'e'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).resolves.toMatchObject({ success: true });

    expect(aiAgentService.ensureInterventionContinuationStarted).toHaveBeenCalledWith(
      continuationOperationId,
    );
    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
    expect(aiAgentService.repairInterventionContinuationTopicAnchor).toHaveBeenCalledTimes(1);
    expect(aiAgentService.retirePendingApprovalOperation).toHaveBeenCalledWith(operationId);
    expect(businessV2.onAgentInterventionResolutionPublished).toHaveBeenCalledTimes(1);
  });

  it('fails closed when ready state disappears between probe and ACK repair', async () => {
    const reviewToken = 'h'.repeat(43);
    const messageId = 'message-ready-disappears';
    const operationId = 'operation-ready-disappears';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000016';
    await insertPendingTool({
      batchId: 'batch-ready-disappears',
      messageId,
      operationId,
      toolCallId: 'call-ready-disappears',
    });
    await serverDB
      .update(messagePlugins)
      .set({
        intervention: {
          batchId: 'batch-ready-disappears',
          operationId,
          resolutionRequestId,
          status: 'approved',
        },
      })
      .where(eq(messagePlugins.id, messageId));
    businessV2.resolveAgentIntervention.mockResolvedValueOnce({
      claimId: 'claim-ready-disappears',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-ready-disappears',
        appContext: { topicId: 'topic-ready-disappears' },
        content: 'answer',
        operationId,
        outcome: 'submitted',
        parentMessageId: messageId,
        toolCallId: 'call-ready-disappears',
        type: 'resume_tool_result',
      },
      state: 'claimed',
    });
    const continuationOperationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId,
      userId,
    });
    const deduplicationId = deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0);
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agents).values({ id: 'agent-ready-disappears', userId });
    await serverDB.insert(topics).values({ id: 'topic-ready-disappears', userId });
    await serverDB.insert(agentOperations).values({
      agentId: 'agent-ready-disappears',
      appContext: { sourceMessageId: messageId },
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: operationId,
          sourceToolMessageIds: [messageId],
        },
        agentInterventionPreparation: {
          deduplicationId,
          resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        },
      },
      status: 'running',
      topicId: 'topic-ready-disappears',
      userId,
    });
    aiAgentService.loadInterventionContinuationState
      .mockResolvedValueOnce({
        metadata: {
          agentId: 'agent-ready-disappears',
          agentInterventionContinuation: {
            resolutionRequestId,
            sourceOperationId: operationId,
            sourceToolMessageIds: [messageId],
          },
          agentInterventionPreparation: {
            deduplicationId,
            resolutionRequestId,
            state: 'ready',
            stepIndex: 0,
          },
          sourceMessageId: messageId,
          topicId: 'topic-ready-disappears',
          userId,
        },
        operationId: continuationOperationId,
        status: 'idle',
      })
      .mockResolvedValue(null);
    aiAgentService.ensureInterventionContinuationStarted.mockResolvedValueOnce('missing');

    await expect(
      userCaller().resolveAgentIntervention({
        action: {
          itemId: 'item-ready-disappears',
          result: { question_1: 'answer' },
          type: 'submit_answers',
        },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-ready-disappears': { hash: 'f'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).rejects.toThrow(/state disappeared during dispatch recovery/);

    expect(aiAgentService.ensureInterventionContinuationStarted).toHaveBeenCalledTimes(1);
    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
    expect(aiAgentService.repairInterventionContinuationTopicAnchor).not.toHaveBeenCalled();
    expect(aiAgentService.retirePendingApprovalOperation).not.toHaveBeenCalled();
    expect(businessV2.onAgentInterventionResolutionPublished).not.toHaveBeenCalled();
    expect(businessV2.rollbackAgentInterventionResolution).not.toHaveBeenCalled();
  });

  it('does not rebuild a durable ready continuation after its runtime state is gone', async () => {
    const reviewToken = 'i'.repeat(43);
    const messageId = 'message-durable-ready-missing';
    const operationId = 'operation-durable-ready-missing';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000017';
    await insertPendingTool({
      batchId: 'batch-durable-ready-missing',
      messageId,
      operationId,
      toolCallId: 'call-durable-ready-missing',
    });
    await serverDB
      .update(messagePlugins)
      .set({
        intervention: {
          batchId: 'batch-durable-ready-missing',
          operationId,
          resolutionRequestId,
          status: 'approved',
        },
      })
      .where(eq(messagePlugins.id, messageId));
    businessV2.resolveAgentIntervention.mockResolvedValueOnce({
      claimId: 'claim-durable-ready-missing',
      contractVersion: 2,
      handled: true,
      ownerUserId: userId,
      resolutionRequestId,
      runtimeAction: {
        agentId: 'agent-durable-ready-missing',
        appContext: { topicId: 'topic-durable-ready-missing' },
        content: 'answer',
        operationId,
        outcome: 'submitted',
        parentMessageId: messageId,
        toolCallId: 'call-durable-ready-missing',
        type: 'resume_tool_result',
      },
      state: 'claimed',
    });
    const continuationOperationId = deriveAgentInterventionContinuationOperationId({
      resolutionRequestId,
      userId,
    });
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agents).values({ id: 'agent-durable-ready-missing', userId });
    await serverDB.insert(topics).values({ id: 'topic-durable-ready-missing', userId });
    await serverDB.insert(agentOperations).values({
      agentId: 'agent-durable-ready-missing',
      appContext: {
        sourceMessageId: messageId,
      },
      id: continuationOperationId,
      metadata: {
        agentInterventionContinuation: {
          resolutionRequestId,
          sourceOperationId: operationId,
          sourceToolMessageIds: [messageId],
        },
        agentInterventionPreparation: {
          deduplicationId: deriveAgentInterventionQueueDeduplicationId(continuationOperationId, 0),
          resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        },
      },
      status: 'running',
      topicId: 'topic-durable-ready-missing',
      userId,
    });
    aiAgentService.loadInterventionContinuationState.mockResolvedValue(null);

    await expect(
      userCaller().resolveAgentIntervention({
        action: {
          itemId: 'item-durable-ready-missing',
          result: { question_1: 'answer' },
          type: 'submit_answers',
        },
        expectedBatchVersion: 1,
        expectedRequestRevisions: {
          'item-durable-ready-missing': { hash: 'a'.repeat(64), version: 1 },
        },
        resolutionRequestId,
        reviewToken,
      }),
    ).rejects.toThrow(/provenance conflict/);

    expect(aiAgentService.ensureInterventionContinuationStarted).not.toHaveBeenCalled();
    expect(aiAgentService.execAgent).not.toHaveBeenCalled();
    expect(businessV2.onAgentInterventionResolutionPublished).not.toHaveBeenCalled();
    expect(businessV2.rollbackAgentInterventionResolution).not.toHaveBeenCalled();
  });

  it('calls the resolving hook only after a claimed response is published', async () => {
    const operationId = 'op-claimed';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000003';
    await insertOperation(operationId, userId);
    business.resolveHeteroIntervention.mockResolvedValueOnce({
      claimId: 'claim-1',
      handled: true,
      operationId,
      resolutionRequestId,
      response: { result: { approved: true }, toolCallId: 't-claimed' },
      state: 'claimed',
      workspaceId: 'workspace-claimed',
    });

    await expect(
      userCaller().submitHeteroIntervention({
        operationId,
        resolutionRequestId,
        result: { approved: true },
        toolCallId: 't-claimed',
      }),
    ).resolves.toEqual({ status: 'resolving', success: true });

    expect(store.events[0].data).toMatchObject({
      producerAck: false,
      resolutionRequestId,
      toolCallId: 't-claimed',
    });
    expect(business.onHeteroInterventionResolutionPublished).toHaveBeenCalledWith({
      claimId: 'claim-1',
      operationId,
      resolutionRequestId,
      status: 'resolving',
      toolCallId: 't-claimed',
      userId,
      workspaceId: 'workspace-claimed',
    });
    expect(business.rollbackHeteroInterventionResolution).not.toHaveBeenCalled();
  });

  it('round-trips XADD → long-poll → bridge producer ACK with the same request id', async () => {
    const operationId = 'op-bridge-ack';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000005';
    await insertOperation(operationId, userId);
    const bridge = new AskUserBridge(operationId, { provider: 'cursor' });
    const events = bridge.events()[Symbol.asyncIterator]();
    const pending = bridge.pending({
      arguments: { questions: [] },
      interactionKind: 'permission',
      toolCallId: 't-bridge',
    });
    expect((await events.next()).value?.type).toBe('agent_intervention_request');

    await userCaller().submitHeteroIntervention({
      operationId,
      resolutionRequestId,
      result: { approved: true },
      toolCallId: 't-bridge',
    });
    const polled = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0-0',
      operationId,
    });
    bridge.resolve('t-bridge', polled.events[0].data as any);
    await expect(pending).resolves.toEqual({ result: { approved: true } });

    const producerEcho = (await events.next()).value as any;
    expect(producerEcho.data).toMatchObject({
      producerAck: true,
      resolutionRequestId,
      toolCallId: 't-bridge',
    });
    bridge.cancelAll();
  });

  it('conditionally rolls back a claimed response when publish fails', async () => {
    const operationId = 'op-publish-fail';
    const resolutionRequestId = '018fbd8e-7baf-7c6d-8000-000000000004';
    await insertOperation(operationId, userId);
    business.resolveHeteroIntervention.mockResolvedValueOnce({
      claimId: 'claim-fail',
      handled: true,
      operationId,
      resolutionRequestId,
      response: { result: { approved: true }, toolCallId: 't-fail' },
      state: 'claimed',
      workspaceId: 'workspace-fail',
    });
    store.failPublish = true;

    await expect(
      userCaller().submitHeteroIntervention({
        operationId,
        resolutionRequestId,
        result: { approved: true },
        toolCallId: 't-fail',
      }),
    ).rejects.toThrow('stream publish failed');

    expect(business.rollbackHeteroInterventionResolution).toHaveBeenCalledWith({
      claimId: 'claim-fail',
      operationId,
      resolutionRequestId,
      toolCallId: 't-fail',
      userId,
      workspaceId: 'workspace-fail',
    });
    expect(business.onHeteroInterventionResolutionPublished).not.toHaveBeenCalled();
  });

  it('cancel clears the result and defaults the reason', async () => {
    const operationId = 'op-cancel';
    await insertOperation(operationId, userId);
    await userCaller().submitHeteroIntervention({
      cancelled: true,
      operationId,
      result: { should: 'be dropped' },
      toolCallId: 't2',
    });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events[0].data).toMatchObject({
      cancelReason: 'user_cancelled',
      cancelled: true,
      toolCallId: 't2',
    });
    expect(res.events[0].data.result).toBeUndefined();
  });

  it('waitInterventionResponse ignores non-intervention events on the stream', async () => {
    const operationId = 'op-ignore-non-intervention';
    await insertOperation(operationId, userId);
    // A plain stream event lands on the op's stream but is not an answer.
    store.events.push({
      data: {},
      id: String(++store.seq),
      operationId,
      stepIndex: 0,
      type: 'stream_chunk',
    });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events).toHaveLength(0);
  });

  describe('waitInterventionResponse ownership guard', () => {
    it('lets a pre-deploy operation token read an operation owned by its subject', async () => {
      await insertOperation('op-legacy-owned', userId);
      await userCaller().submitHeteroIntervention({
        operationId: 'op-legacy-owned',
        result: { answer: 'yes' },
        toolCallId: 't-legacy-own',
      });

      const res = await legacyHeteroCaller(userId).waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-legacy-owned',
      });

      expect(res.events).toHaveLength(1);
      expect(res.events[0].data).toMatchObject({ toolCallId: 't-legacy-own' });
    });

    it("rejects a pre-deploy operation token reading another user's operation", async () => {
      const otherUserId = await createTestUser(serverDB);
      await insertOperation('op-legacy-others', otherUserId);

      await expect(
        legacyHeteroCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-legacy-others',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('lets an owner token read its own operation', async () => {
      await insertOperation('op-owned', userId);
      await userCaller().submitHeteroIntervention({
        operationId: 'op-owned',
        result: { answer: 'yes' },
        toolCallId: 't-own',
      });

      const res = await ownerTokenCaller(userId).waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-owned',
      });

      expect(res.events).toHaveLength(1);
      expect(res.events[0].data).toMatchObject({ toolCallId: 't-own' });
    });

    it("rejects an owner token reading another user's operation", async () => {
      const otherUserId = await createTestUser(serverDB);
      await insertOperation('op-others', otherUserId);
      // The victim's answer lands on the stream…
      await userCaller().submitHeteroIntervention({
        operationId: 'op-others',
        result: { secret: 'leak me' },
        toolCallId: 't-victim',
      });

      // …but a different signed-in user must not be able to long-poll it.
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-others',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('rejects an owner token for an unknown operation id', async () => {
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-missing',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a server-minted token when its durable operation row is missing', async () => {
      await expect(
        heteroCaller('op-no-row').waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-no-row',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
