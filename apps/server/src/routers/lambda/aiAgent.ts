import { randomUUID } from 'node:crypto';

import { type AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { LOADING_FLAT } from '@lobechat/const';
import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { parse } from '@lobechat/conversation-flow';
import type { ExecAgentResult, TaskCurrentActivity, TaskStatusResult } from '@lobechat/types';
import {
  CreateThreadWithMessageSchema,
  entityIdPattern,
  LocalHeterogeneousAgentTypeSchema,
  RequestTrigger,
  ThreadStatus,
  ThreadType,
  UserInterventionConfigSchema,
  workingDirConfigSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import {
  type AgentInterventionReviewStatus,
  type AgentInterventionRuntimeAction,
  type AgentInterventionSourceAction,
  getAgentInterventionReview,
  getAgentInterventionReviewBySource,
  onAgentInterventionResolutionPublished,
  resolveAgentIntervention,
  resolveAgentInterventionBySource,
  type ResolveAgentInterventionResult,
  rollbackAgentInterventionResolution,
} from '@/business/server/agent-run/agentInterventionReview';
import { executeAgentMarketplaceIntervention } from '@/business/server/agent-run/executeCustomIntervention';
import {
  getHeteroInterventionReview,
  onHeteroInterventionResolutionPublished,
  resolveHeteroIntervention,
  rollbackHeteroInterventionResolution,
} from '@/business/server/agent-run/heteroInterventionReview';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { HumanApprovalAlreadyResolvedError, MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { agentOperations, topics, workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signHeteroOperationJWT, signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { unwrapPgError } from '@/server/modules/AgentRuntime/pgError';
import {
  getServerDefaultHeterogeneousModels,
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES,
} from '@/server/modules/ModelRuntime';
import {
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
  assertCanViewMessageTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import {
  GetAgentInterventionReviewBySourceSchema,
  GetAgentInterventionReviewSchema,
  ResolveAgentInterventionBySourceSchema,
  ResolveAgentInterventionSchema,
} from '@/server/routers/lambda/_schema/agentIntervention';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { AiChatService } from '@/server/services/aiChat';
import { getFileProxyUrl } from '@/server/services/file';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

const log = debug('lobe-server:ai-agent-router');

type ClaimedAgentInterventionResolution = Extract<
  ResolveAgentInterventionResult,
  { state: 'claimed' }
>;

interface AgentInterventionDispatchContext {
  aiAgentService: AiAgentService;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

const publishedStatusForRuntimeAction = (
  runtimeAction: AgentInterventionRuntimeAction,
): AgentInterventionReviewStatus => {
  switch (runtimeAction.type) {
    case 'execute_custom_interaction': {
      return runtimeAction.input.action.type === 'cancelled'
        ? 'cancelled'
        : runtimeAction.input.action.type === 'skipped'
          ? 'skipped'
          : 'resolved';
    }
    case 'heterogeneous_response': {
      return 'resolving';
    }
    case 'resume_approval': {
      return runtimeAction.decisions.every(({ decision }) => decision === 'approved')
        ? 'approved'
        : runtimeAction.decisions.every(({ decision }) => decision === 'rejected_continue')
          ? 'rejected'
          : 'mixed';
    }
    case 'resume_tool_result': {
      return runtimeAction.outcome === 'skipped' ? 'skipped' : 'resolved';
    }
    case 'stop': {
      return runtimeAction.terminalStatus;
    }
  }
};

type RuntimeActionDispatchProbe =
  | { state: 'conflict' }
  | { state: 'dispatched' }
  | { retry: 'rebuild' | 'schedule' | 'stop'; state: 'prepared' }
  | { state: 'unclaimed' };

const sameNullable = (left: unknown, right: unknown): boolean => (left ?? null) === (right ?? null);

const sameStringSet = (left: string[], right: string[]): boolean => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const continuationRuntimeAction = (
  runtimeAction: AgentInterventionRuntimeAction,
): Extract<
  AgentInterventionRuntimeAction,
  { type: 'execute_custom_interaction' | 'resume_approval' | 'resume_tool_result' }
> | null => {
  if (runtimeAction.type === 'resume_approval' || runtimeAction.type === 'resume_tool_result') {
    return runtimeAction;
  }
  if (
    runtimeAction.type === 'execute_custom_interaction' &&
    runtimeAction.input.action.type !== 'cancelled'
  ) {
    return runtimeAction;
  }
  return null;
};

/**
 * Probe a retry against both the source-message claim and the deterministic
 * continuation operation. A message marker alone only proves the request was
 * prepared; a matching owner-scoped operation plus runtime state proves it was
 * dispatched. This closes the crash window between message CAS and scheduling.
 */
const probeRuntimeActionDispatch = async (
  resolution: ClaimedAgentInterventionResolution,
  ctx: AgentInterventionDispatchContext,
): Promise<RuntimeActionDispatchProbe> => {
  const { runtimeAction } = resolution;
  const expected: Array<{ messageId: string; skipped?: true; status: string }> = [];

  switch (runtimeAction.type) {
    case 'execute_custom_interaction': {
      if (runtimeAction.input.action.type === 'cancelled') {
        expected.push(
          ...runtimeAction.toolMessageIds.map((messageId) => ({ messageId, status: 'aborted' })),
        );
      } else {
        expected.push({
          messageId: runtimeAction.parentMessageId,
          ...(runtimeAction.input.action.type === 'skipped' && { skipped: true as const }),
          status: runtimeAction.input.action.type === 'skipped' ? 'rejected' : 'approved',
        });
      }
      break;
    }
    case 'heterogeneous_response': {
      // The producer de-duplicates the stable resolutionRequestId. There is no
      // runtime message claim that can prove whether XADD happened before a
      // crash, so a resolving retry republishes the same idempotency key.
      return { state: 'unclaimed' };
    }
    case 'resume_approval': {
      expected.push(
        ...runtimeAction.decisions.map((decision) => ({
          messageId: decision.parentMessageId,
          status: decision.decision === 'approved' ? 'approved' : 'rejected',
        })),
      );
      break;
    }
    case 'resume_tool_result': {
      expected.push({
        messageId: runtimeAction.parentMessageId,
        ...(runtimeAction.outcome === 'skipped' && { skipped: true as const }),
        status: runtimeAction.outcome === 'skipped' ? 'rejected' : 'approved',
      });
      break;
    }
    case 'stop': {
      expected.push(
        ...runtimeAction.toolMessageIds.map((messageId) => ({ messageId, status: 'aborted' })),
      );
      break;
    }
  }

  if (expected.length === 0) return { state: 'unclaimed' };
  const messageModel = new MessageModel(
    ctx.serverDB,
    resolution.ownerUserId,
    resolution.workspaceId ?? ctx.workspaceId ?? undefined,
  );
  const plugins = await Promise.all(
    expected.map(({ messageId }) => messageModel.findMessagePlugin(messageId)),
  );

  if (plugins.every((plugin) => plugin?.intervention?.status === 'pending')) {
    return { state: 'unclaimed' };
  }

  const sourceClaimMatches = plugins.every((plugin, index) => {
    const expectedIntervention = expected[index];
    return (
      plugin?.intervention?.resolutionRequestId === resolution.resolutionRequestId &&
      plugin.intervention.status === expectedIntervention.status &&
      (!expectedIntervention.skipped || plugin.intervention.skipped === true)
    );
  });
  if (!sourceClaimMatches) return { state: 'conflict' };

  // Stop and current custom-cancel semantics settle the parked operation
  // itself. The message claim is only complete when that exact operation is
  // durably interrupted; a crash between the two is retryable preparation.
  if (
    runtimeAction.type === 'stop' ||
    (runtimeAction.type === 'execute_custom_interaction' &&
      runtimeAction.input.action.type === 'cancelled')
  ) {
    const operationModel = new AgentOperationModel(
      ctx.serverDB,
      resolution.ownerUserId,
      resolution.workspaceId ?? ctx.workspaceId ?? undefined,
    );
    const operation = await operationModel.findById(runtimeAction.operationId);
    const topicId =
      runtimeAction.type === 'stop' ? runtimeAction.topicId : runtimeAction.appContext.topicId;
    if (!operation || operation.topicId !== topicId) return { state: 'conflict' };
    if (operation.status === 'interrupted') return { state: 'dispatched' };
    return operation.status === 'waiting_for_human'
      ? { retry: 'stop', state: 'prepared' }
      : { state: 'conflict' };
  }

  const continuation = continuationRuntimeAction(runtimeAction);
  if (!continuation) return { state: 'conflict' };
  const continuationOperationId = deriveAgentInterventionContinuationOperationId({
    resolutionRequestId: resolution.resolutionRequestId,
    userId: resolution.ownerUserId,
    workspaceId: resolution.workspaceId ?? ctx.workspaceId,
  });
  const operationModel = new AgentOperationModel(
    ctx.serverDB,
    resolution.ownerUserId,
    resolution.workspaceId ?? ctx.workspaceId ?? undefined,
  );
  const operation = await operationModel.findById(continuationOperationId);
  if (!operation) return { retry: 'rebuild', state: 'prepared' };

  const sourceToolMessageIds =
    continuation.type === 'resume_approval'
      ? continuation.decisions.map(({ parentMessageId }) => parentMessageId)
      : [continuation.parentMessageId];
  const provenance = operation.metadata?.agentInterventionContinuation as
    | {
        resolutionRequestId?: unknown;
        sourceOperationId?: unknown;
        sourceToolMessageIds?: unknown;
      }
    | undefined;
  const rowContextMatches =
    operation.agentId === continuation.agentId &&
    operation.topicId === continuation.appContext.topicId &&
    sameNullable(operation.threadId, continuation.appContext.threadId) &&
    sameNullable(operation.taskId, continuation.appContext.taskId) &&
    sameNullable(operation.chatGroupId, continuation.appContext.groupId) &&
    sameNullable(operation.appContext?.documentId, continuation.appContext.documentId) &&
    sameNullable(operation.appContext?.groupId, continuation.appContext.groupId) &&
    sameNullable(operation.appContext?.scope, continuation.appContext.scope) &&
    sameNullable(operation.appContext?.sessionId, continuation.appContext.sessionId) &&
    operation.appContext?.sourceMessageId === continuation.parentMessageId &&
    provenance?.resolutionRequestId === resolution.resolutionRequestId &&
    provenance.sourceOperationId === continuation.operationId &&
    Array.isArray(provenance.sourceToolMessageIds) &&
    provenance.sourceToolMessageIds.every((id) => typeof id === 'string') &&
    sameStringSet(provenance.sourceToolMessageIds as string[], sourceToolMessageIds);
  if (!rowContextMatches) return { state: 'conflict' };

  const expectedDeduplicationId = deriveAgentInterventionQueueDeduplicationId(
    continuationOperationId,
    0,
  );
  const dispatchMarker = operation.metadata?.agentInterventionDispatch as
    | {
        deduplicationId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
      }
    | undefined;
  if (dispatchMarker) {
    return dispatchMarker.state === 'scheduled' &&
      dispatchMarker.resolutionRequestId === resolution.resolutionRequestId &&
      dispatchMarker.deduplicationId === expectedDeduplicationId
      ? { state: 'dispatched' }
      : { state: 'conflict' };
  }

  const durablePreparation = operation.metadata?.agentInterventionPreparation as
    | {
        deduplicationId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
        stepIndex?: unknown;
      }
    | undefined;
  const durablePreparationMatches =
    durablePreparation?.state === 'ready' &&
    durablePreparation.resolutionRequestId === resolution.resolutionRequestId &&
    durablePreparation.stepIndex === 0 &&
    durablePreparation.deduplicationId === expectedDeduplicationId;
  if (durablePreparation && !durablePreparationMatches) return { state: 'conflict' };

  const state = await ctx.aiAgentService.loadInterventionContinuationState(continuationOperationId);
  if (!state) {
    // A row alone is never dispatch proof: recordStart precedes state + queue,
    // and even `abandoned` can be watchdog settlement of that bare row. Only a
    // provider ACK marker or an owner/context-matching live state can advance
    // lifecycle completion. Unknown terminal/no-state combinations fail closed.
    return !durablePreparation && operation.status === 'running'
      ? { retry: 'rebuild', state: 'prepared' }
      : { state: 'conflict' };
  }

  const stateProvenance = state.metadata?.agentInterventionContinuation as
    typeof provenance | undefined;
  const statePreparation = state.metadata?.agentInterventionPreparation as
    | {
        deduplicationId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
        stepIndex?: unknown;
      }
    | undefined;
  const stateContextMatches =
    state.operationId === continuationOperationId &&
    state.metadata?.userId === resolution.ownerUserId &&
    sameNullable(
      state.metadata?.workspaceId,
      resolution.workspaceId ?? ctx.workspaceId ?? undefined,
    ) &&
    state.metadata?.agentId === continuation.agentId &&
    state.metadata?.topicId === continuation.appContext.topicId &&
    sameNullable(state.metadata?.threadId, continuation.appContext.threadId) &&
    sameNullable(state.metadata?.taskId, continuation.appContext.taskId) &&
    sameNullable(state.metadata?.groupId, continuation.appContext.groupId) &&
    sameNullable(state.metadata?.documentId, continuation.appContext.documentId) &&
    sameNullable(state.metadata?.scope, continuation.appContext.scope) &&
    sameNullable(state.metadata?.sessionId, continuation.appContext.sessionId) &&
    state.metadata?.sourceMessageId === continuation.parentMessageId &&
    stateProvenance?.resolutionRequestId === resolution.resolutionRequestId &&
    stateProvenance.sourceOperationId === continuation.operationId &&
    Array.isArray(stateProvenance.sourceToolMessageIds) &&
    stateProvenance.sourceToolMessageIds.every((id) => typeof id === 'string') &&
    sameStringSet(stateProvenance.sourceToolMessageIds as string[], sourceToolMessageIds);
  if (!stateContextMatches) return { state: 'conflict' };

  if (
    statePreparation?.state !== 'ready' ||
    statePreparation.resolutionRequestId !== resolution.resolutionRequestId ||
    statePreparation.stepIndex !== 0 ||
    statePreparation.deduplicationId !== expectedDeduplicationId
  ) {
    return !durablePreparation && state.status === 'idle'
      ? { retry: 'rebuild', state: 'prepared' }
      : { state: 'conflict' };
  }

  // Ready state without the durable provider-ACK marker is still preparation,
  // even if a fast worker already advanced it to running/terminal. Re-enqueue
  // with the same dedupe key to recover the ACK before topic repair/publish.
  return { retry: 'schedule', state: 'prepared' };
};

const retireRuntimeActionSourceOperation = async (
  runtimeAction: AgentInterventionRuntimeAction,
  ctx: AgentInterventionDispatchContext,
): Promise<void> => {
  switch (runtimeAction.type) {
    case 'execute_custom_interaction': {
      if (runtimeAction.input.action.type !== 'cancelled') {
        await ctx.aiAgentService.retirePendingApprovalOperation(runtimeAction.operationId);
      }
      return;
    }
    case 'resume_approval':
    case 'resume_tool_result': {
      await ctx.aiAgentService.retirePendingApprovalOperation(runtimeAction.operationId);
      return;
    }
    case 'heterogeneous_response':
    case 'stop': {
      return;
    }
  }
};

const repairRuntimeActionContinuationAnchor = async (
  resolution: ClaimedAgentInterventionResolution,
  ctx: AgentInterventionDispatchContext,
): Promise<void> => {
  const continuation = continuationRuntimeAction(resolution.runtimeAction);
  if (!continuation) return;
  const identity = {
    resolutionRequestId: resolution.resolutionRequestId,
    userId: resolution.ownerUserId,
    workspaceId: resolution.workspaceId ?? ctx.workspaceId,
  };
  await ctx.aiAgentService.repairInterventionContinuationTopicAnchor({
    assistantMessageId: deriveAgentInterventionContinuationMessageId(identity),
    continuationOperationId: deriveAgentInterventionContinuationOperationId(identity),
    resolutionRequestId: resolution.resolutionRequestId,
    scope: continuation.appContext.scope,
    sourceOperationId: continuation.operationId,
    sourceToolMessageIds:
      continuation.type === 'resume_approval'
        ? continuation.decisions.map(({ parentMessageId }) => parentMessageId)
        : [continuation.parentMessageId],
    threadId: continuation.appContext.threadId,
    topicId: continuation.appContext.topicId,
  });
};

/**
 * One dispatch boundary shared by token Review and the active Web source
 * bridge. Both paths arrive here only after Cloud has won the same durable
 * first-winner claim.
 */
const dispatchClaimedAgentIntervention = async (
  resolution: ClaimedAgentInterventionResolution,
  ctx: AgentInterventionDispatchContext,
): Promise<{ execution?: ExecAgentResult; status: AgentInterventionReviewStatus }> => {
  const { runtimeAction } = resolution;
  let execution: ExecAgentResult | undefined;
  let durableCustomSideEffect = false;
  const publishedStatus = publishedStatusForRuntimeAction(runtimeAction);
  const dispatchProbe = await probeRuntimeActionDispatch(resolution, ctx);
  const deterministicContinuationOperationId = continuationRuntimeAction(runtimeAction)
    ? deriveAgentInterventionContinuationOperationId({
        resolutionRequestId: resolution.resolutionRequestId,
        userId: resolution.ownerUserId,
        workspaceId: resolution.workspaceId ?? ctx.workspaceId,
      })
    : undefined;

  try {
    if (dispatchProbe.state === 'conflict') {
      throw new Error('Agent intervention continuation provenance conflict');
    }

    let shouldDispatchRuntimeAction =
      dispatchProbe.state === 'unclaimed' ||
      (dispatchProbe.state === 'prepared' && dispatchProbe.retry !== 'schedule');

    if (dispatchProbe.state === 'prepared' && dispatchProbe.retry === 'schedule') {
      const continuationOperationId = deriveAgentInterventionContinuationOperationId({
        resolutionRequestId: resolution.resolutionRequestId,
        userId: resolution.ownerUserId,
        workspaceId: resolution.workspaceId ?? ctx.workspaceId,
      });
      const start =
        await ctx.aiAgentService.ensureInterventionContinuationStarted(continuationOperationId);
      if (start === 'missing') {
        // The first probe observed a complete ready state. If it disappears
        // before the enqueue repair, rebuilding cannot distinguish a TTL from
        // a worker that already ran after a lost provider ACK. Keep the durable
        // claim and fail closed; a later retry must recover from authoritative
        // operation evidence rather than replaying the continuation.
        throw new Error(
          `Intervention continuation state disappeared during dispatch recovery: ${continuationOperationId}`,
        );
      }
      shouldDispatchRuntimeAction = false;
    }

    if (dispatchProbe.state !== 'dispatched' && shouldDispatchRuntimeAction) {
      switch (runtimeAction.type) {
        case 'execute_custom_interaction': {
          const customAction = runtimeAction.input.action;
          const customResult = await executeAgentMarketplaceIntervention({
            action: customAction,
            actorUserId: ctx.userId,
            categoryHints: runtimeAction.input.categoryHints,
            requestId: runtimeAction.input.requestId,
            resolutionRequestId: resolution.resolutionRequestId,
            topicId: runtimeAction.appContext.topicId,
            userId: resolution.ownerUserId,
            workspaceId: resolution.workspaceId ?? ctx.workspaceId ?? undefined,
          });
          durableCustomSideEffect = true;
          if (customAction.type === 'cancelled') {
            await ctx.aiAgentService.stopPendingApproval({
              approvalResolutionRequestId: resolution.resolutionRequestId,
              batchId: runtimeAction.batchId,
              operationId: runtimeAction.operationId,
              toolMessageIds: runtimeAction.toolMessageIds,
              topicId: runtimeAction.appContext.topicId,
            });
          } else {
            const skipped = customAction.type === 'skipped';
            execution = await ctx.aiAgentService.execAgent({
              agentId: runtimeAction.agentId,
              approvalResolutionRequestId: resolution.resolutionRequestId,
              approvalSourceOperationId: runtimeAction.operationId,
              appContext: runtimeAction.appContext,
              parentMessageId: runtimeAction.parentMessageId,
              prompt: '',
              replacesOperationId: runtimeAction.operationId,
              resume: true,
              taskId: runtimeAction.appContext.taskId ?? undefined,
              resumeToolResult: {
                content: customResult.content,
                outcome: skipped ? 'skipped' : 'submitted',
                parentMessageId: runtimeAction.parentMessageId,
                pluginState: customResult.pluginState,
                toolCallId: runtimeAction.toolCallId,
              },
              topicStartReservationId: deterministicContinuationOperationId,
            });
          }
          break;
        }
        case 'heterogeneous_response': {
          await createStreamEventManager().publishStreamEvent(runtimeAction.operationId, {
            data: runtimeAction.response,
            stepIndex: runtimeAction.stepIndex ?? 0,
            type: 'agent_intervention_response',
          });
          break;
        }
        case 'resume_approval': {
          const [singleDecision] = runtimeAction.decisions;
          execution = await ctx.aiAgentService.execAgent({
            agentId: runtimeAction.agentId,
            approvalResolutionRequestId: resolution.resolutionRequestId,
            approvalSourceOperationId: runtimeAction.operationId,
            appContext: runtimeAction.appContext,
            parentMessageId: runtimeAction.parentMessageId,
            prompt: '',
            replacesOperationId: runtimeAction.operationId,
            resume: true,
            taskId: runtimeAction.appContext.taskId ?? undefined,
            ...(runtimeAction.decisions.length === 1
              ? { resumeApproval: singleDecision }
              : { resumeApprovals: runtimeAction.decisions }),
            topicStartReservationId: deterministicContinuationOperationId,
          });
          break;
        }
        case 'resume_tool_result': {
          execution = await ctx.aiAgentService.execAgent({
            agentId: runtimeAction.agentId,
            approvalResolutionRequestId: resolution.resolutionRequestId,
            approvalSourceOperationId: runtimeAction.operationId,
            appContext: runtimeAction.appContext,
            parentMessageId: runtimeAction.parentMessageId,
            prompt: '',
            replacesOperationId: runtimeAction.operationId,
            resume: true,
            taskId: runtimeAction.appContext.taskId ?? undefined,
            resumeToolResult: {
              content: runtimeAction.content,
              outcome: runtimeAction.outcome,
              parentMessageId: runtimeAction.parentMessageId,
              pluginState: runtimeAction.pluginState,
              rejectionReason: runtimeAction.rejectionReason,
              toolCallId: runtimeAction.toolCallId,
            },
            topicStartReservationId: deterministicContinuationOperationId,
          });
          break;
        }
        case 'stop': {
          await ctx.aiAgentService.stopPendingApproval({
            approvalResolutionRequestId: resolution.resolutionRequestId,
            batchId: runtimeAction.batchId,
            operationId: runtimeAction.operationId,
            toolMessageIds: runtimeAction.toolMessageIds,
            topicId: runtimeAction.topicId,
          });
          break;
        }
      }
    }

    if (execution?.success === false || execution?.autoStarted === false) {
      throw new Error('Agent intervention continuation was not scheduled');
    }
    await repairRuntimeActionContinuationAnchor(resolution, ctx);
    await retireRuntimeActionSourceOperation(runtimeAction, ctx);
  } catch (error) {
    const retryProbe = await probeRuntimeActionDispatch(resolution, ctx);
    if (retryProbe.state === 'dispatched') {
      log(
        'v2 intervention retry observed prior dispatch operation claim=%s request=%s',
        resolution.claimId,
        resolution.resolutionRequestId,
      );
      // The prior call may have scheduled the replacement operation and failed
      // while retiring its parked predecessor. Retry that lifecycle transition
      // under the same source identity; never roll back a generic claim after
      // the tool/result side effect is authoritatively visible.
      await repairRuntimeActionContinuationAnchor(resolution, ctx);
      await retireRuntimeActionSourceOperation(runtimeAction, ctx);
    } else if (retryProbe.state === 'unclaimed' && !durableCustomSideEffect) {
      await rollbackAgentInterventionResolution({
        actorUserId: ctx.userId,
        claimId: resolution.claimId,
        ownerUserId: resolution.ownerUserId,
        resolutionRequestId: resolution.resolutionRequestId,
        workspaceId: resolution.workspaceId ?? ctx.workspaceId ?? undefined,
      }).catch((rollbackError) => {
        log(
          'conditional v2 intervention rollback failed claim=%s: %O',
          resolution.claimId,
          rollbackError,
        );
      });
      throw error;
    } else {
      // `prepared` means this exact request owns the source rows but has not
      // reached a provably started continuation yet. Keep the generic claim so
      // the same id can rebuild/requeue it; rolling back here would let a second
      // actor win against already-settled source messages. `conflict` is also
      // fail-closed and must never reopen the claim.
      throw error;
    }
  }

  // Runtime dispatch is authoritative. The durable published/completion
  // transition is part of the mutation's success boundary: swallowing a hook
  // failure would leave the row permanently resolving while telling clients
  // the action completed. Cloud makes this idempotent by request id.
  await onAgentInterventionResolutionPublished({
    actorUserId: ctx.userId,
    claimId: resolution.claimId,
    ownerUserId: resolution.ownerUserId,
    resolutionRequestId: resolution.resolutionRequestId,
    status: publishedStatus,
    workspaceId: resolution.workspaceId ?? ctx.workspaceId ?? undefined,
  });

  return { execution, status: publishedStatus };
};

const resolveHeteroTopicWorkspace = async (params: {
  db: LobeChatDatabase;
  requestedWorkspaceId?: string | null;
  topicId: string;
  userId: string;
}) => {
  const { db, requestedWorkspaceId, topicId, userId } = params;
  const [topic] = await db
    .select({ userId: topics.userId, workspaceId: topics.workspaceId })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);

  if (!topic || (requestedWorkspaceId != null && requestedWorkspaceId !== topic.workspaceId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
  }

  if (!topic.workspaceId) {
    if (topic.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
    }
    return undefined;
  }

  const [membership] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, topic.workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Topic is outside the caller scope' });
  }

  return topic.workspaceId;
};

/**
 * Workspace `use` guard for operation-keyed endpoints: resolve the operation
 * row to its agent and run the same `use` guard. Operations without an agent
 * (detached / legacy rows) fall through — there is no resource to guard.
 * No-op in personal mode (no workspaceId).
 */
const assertCanUseOperationAgent = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, operationId, userId, workspaceId } = params;
  if (!workspaceId) return;

  const [row] = await db
    .select({ agentId: agentOperations.agentId })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (!row?.agentId) return;

  await assertCanUseWorkspaceAgent({
    agentId: row.agentId,
    db,
    userId,
    workspaceId,
  });
};

/**
 * Resolve client-supplied conversation ids before an agent run writes through
 * AiAgentService. Checking only the requested agent/group is insufficient: an
 * existing topic or parent message can belong to a different, view-only
 * workspace resource.
 */
const assertCanUseAgentRunConversation = async (params: {
  db: LobeChatDatabase;
  messageIds?: Array<string | null | undefined>;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, messageIds = [], topicId, userId, workspaceId } = params;
  if (!workspaceId) return;

  const uniqueMessageIds = [...new Set(messageIds.filter(Boolean) as string[])];
  await Promise.all([
    assertCanUseTopicTargets({ db, userId, workspaceId }, topicId ? [topicId] : []),
    assertCanUseMessageTargets({ db, userId, workspaceId }, uniqueMessageIds),
  ]);
};

const createUiMessageFileUrlResolver = () => {
  return async (path: string | null, file: { fileType: string; id?: string | null }) =>
    file.id ? getFileProxyUrl(file.id) : (path ?? '');
};

const extractTaskErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const taskError = error as Record<string, any>;
  const candidates = [
    taskError.body?.error?.message,
    taskError.body?.message,
    taskError.error?.error?.message,
    taskError.error?.message,
    taskError.message,
    taskError.type,
    taskError.errorType,
    taskError.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '[object Object]' && candidate !== 'error') {
      return candidate;
    }
  }

  return undefined;
};

const formatTaskError = (error: unknown): Record<string, unknown> | undefined => {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error !== 'object') {
    return { message: String(error) };
  }

  const taskError = error as Record<string, unknown>;
  const message = extractTaskErrorMessage(error);

  return message ? { ...taskError, message } : taskError;
};

const GetOperationStatusSchema = z.object({
  historyLimit: z.number().optional().default(10),
  includeHistory: z.boolean().optional().default(false),
  operationId: z.string(),
});

const ProcessHumanInterventionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reject_continue', 'input', 'select']),
  data: z
    .object({
      approvedToolCall: z.any().optional(),
      input: z.any().optional(),
      selection: z.any().optional(),
    })
    .optional(),
  operationId: z.string(),
  reason: z.string().optional(),
  stepIndex: z.number().optional().default(0),
  /**
   * ID of the pending `role='tool'` message targeted by this intervention.
   * Required for approve / reject / reject_continue so the server can update
   * the message's intervention status, content, and — on approve — hand the
   * id to the `call_tool` short-circuit via `skipCreateToolMessage`.
   */
  toolMessageId: z.string().optional(),
});

const GetPendingInterventionsSchema = z
  .object({
    operationId: z.string().optional(),
    userId: z.string().optional(),
  })
  .refine((data) => data.operationId || data.userId, {
    message: 'Either operationId or userId must be provided',
  });

const StartExecutionSchema = z.object({
  context: z.any().optional(),
  delay: z.number().optional().default(1000),
  operationId: z.string(),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
});

/**
 * Schema for execAgent - execute a single Agent
 */
const ExecAgentSchema = z
  .object({
    /** The agent ID to run (either agentId or slug is required) */
    agentId: z.string().optional(),
    /** Application context for message storage */
    appContext: z
      .object({
        conversationAgentId: z.string().optional(),
        defaultTaskAssigneeAgentId: z.string().optional(),
        documentId: z.string().nullish(),
        /** The agent being edited when scope is 'agent_builder' (not the builder builtin itself). */
        editingAgentId: z.string().optional(),
        /** The group being edited when scope is 'group_agent_builder' (not a group chat turn). */
        editingGroupId: z.string().optional(),
        groupId: z.string().nullish(),
        initialTopicMetadata: z
          .object({
            repos: z.array(z.string()).optional(),
            workingDirectory: z.string().optional(),
            workingDirectoryConfig: workingDirConfigSchema.optional(),
          })
          .optional(),
        /**
         * Branch this run into a new thread (subtopic) under the resolved topic.
         * The gateway path never calls `aiChat.sendMessageInServer`, so this is
         * the only way the composer's "start a new subtopic" intent reaches the
         * server — without it the turn lands on the topic's main spine.
         */
        newThread: CreateThreadWithMessageSchema.optional(),
        /**
         * Group orchestration role of the run, stamped onto the assistant
         * message's `metadata.orchestrationRole` so the supervisor/member
         * identity survives the gateway step_start snapshot / refetch.
         */
        orchestrationRole: z.enum(['supervisor', 'member']).optional(),
        scope: z.string().nullish(),
        sessionId: z.string().optional(),
        taskId: z.string().nullish(),
        threadId: z.string().nullish(),
        topicId: z.string().nullish(),
      })
      .optional(),
    /** Whether to auto-start execution after creating operation */
    autoStart: z.boolean().optional().default(true),
    /**
     * Client-minted ids for the rows this run creates, honoured verbatim —
     * the gateway counterpart of `sendMessageInServer`'s `newTopic.id` /
     * `newUserMessage.id` / `newAssistantMessage.id`. Validated per namespace:
     * an unvalidated client primary key would let a caller submit look-alike
     * ids, wrong namespaces, or strings that leak into logs and URLs.
     */
    clientIds: z
      .object({
        assistantMessageId: z.string().regex(entityIdPattern('messages')).optional(),
        topicId: z.string().regex(entityIdPattern('topics')).optional(),
        userMessageId: z.string().regex(entityIdPattern('messages')).optional(),
      })
      .optional(),
    /** Explicit device ID to bind to the topic and activate for this run */
    deviceId: z.string().optional(),
    /** Current desktop device hint, honored only for an effective local target */
    localDeviceId: z.string().optional(),
    /** Optional existing message IDs to include in context */
    existingMessageIds: z.array(z.string()).optional().default([]),
    /** File IDs of already-uploaded attachments to attach to the new user message */
    fileIds: z.array(z.string()).optional(),
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId: z.string().optional(),
    /** Existing gateway operation this fresh turn atomically supersedes. */
    replacesOperationId: z.string().optional(),
    /** The user input/prompt */
    prompt: z.string(),
    /**
     * Resume a previous op paused on `human_approve_required`. When set, the
     * new op writes the decision to the target tool message and either runs
     * the approved tool (`approved`), halts with reason=`human_rejected`
     * (`rejected`), or surfaces the rejection as user feedback so the LLM
     * can continue (`rejected_continue`).
     */
    resumeApproval: z
      .object({
        decision: z.enum(['approved', 'rejected', 'rejected_continue']),
        /** ID of the pending `role='tool'` message this decision targets. */
        parentMessageId: z.string(),
        /** Optional user-supplied rejection reason (only meaningful for rejected variants). */
        rejectionReason: z.string().optional(),
        /** tool_call_id of the pending tool call being approved/rejected. */
        toolCallId: z.string(),
      })
      .optional(),
    /**
     * Batch form of `resumeApproval` — one entry per pending tool the user
     * resolved in a single action ("approve all" on a parallel tool batch).
     * The op applies every decision, then runs all approved tools in ONE
     * `call_tools_batch` and continues the LLM once with the full result set.
     *
     * Prefer this over firing N `resumeApproval` ops for a parallel batch: each
     * of those continues the LLM while the not-yet-approved tools are still
     * empty rows, which forks the parent chain and shows the model blank
     * results. Mutually exclusive with `resumeApproval`.
     */
    resumeApprovals: z
      .array(
        z.object({
          decision: z.enum(['approved', 'rejected', 'rejected_continue']),
          /** ID of the pending `role='tool'` message this decision targets. */
          parentMessageId: z.string(),
          /** Optional user-supplied rejection reason (only meaningful for rejected variants). */
          rejectionReason: z.string().optional(),
          /** tool_call_id of the pending tool call being approved/rejected. */
          toolCallId: z.string(),
        }),
      )
      .min(1)
      .optional(),
    /**
     * Resume a previous op paused on a `humanIntervention: 'always'` tool (e.g.
     * lobe-agent `askUserQuestion`). When set, the new op writes the
     * human-provided answer as the target tool message's result and resumes from
     * `phase: 'tool_result'` — the tool is NOT re-executed, so the runtime never
     * overwrites the answer with a fresh "pending" placeholder. Mutually
     * exclusive with `resumeApproval`.
     */
    resumeToolResult: z
      .object({
        /** The human-provided tool result (the answer text). */
        content: z.string(),
        /** ID of the pending `role='tool'` message this result targets. */
        parentMessageId: z.string(),
        /** Optional plugin state to persist on the tool message. */
        pluginState: z.record(z.string(), z.unknown()).optional(),
        /** Whether the form was submitted or explicitly skipped. */
        outcome: z.enum(['submitted', 'skipped']).optional().default('submitted'),
        /** Optional skip reason, persisted only when outcome is skipped. */
        rejectionReason: z.string().optional(),
        /** tool_call_id of the pending tool call being answered. */
        toolCallId: z.string(),
      })
      .optional(),
    /**
     * Tool identifiers the user @-mentioned in this message. Enabled for this
     * run in addition to the agent's pinned plugins, so a mentioned tool that
     * isn't pinned to the agent (e.g. a custom MCP connector picked from the @
     * list) is callable. Scoped to the caller's own installed tools/connectors
     * by the user-scoped lookups downstream, so it can't enable others' tools.
     */
    selectedToolIds: z.array(z.string()).optional(),
    /**
     * Agents the user @-mentioned in this message (multi-mention). When present
     * (and non-group), the run enables the callAgent tool and injects the
     * mentioned-agents delegation context so the supervisor delegates to them
     * instead of answering itself. Mirrors the client runtime's
     * `initialContext.mentionedAgents` + injected callAgent manifest.
     */
    mentionedAgents: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
    /**
     * What initiated this operation, persisted to `agent_operations.trigger`.
     * Defaults to `'chat'` when omitted — first-party SPA / desktop user
     * messages are the dominant caller. Pass a more specific value (`'cli'`,
     * `'openapi'`, `'eval'`, …) to override.
     */
    trigger: z.string().optional(),
    /**
     * User intervention configuration for tool approvals.
     * Pass `{ approvalMode: 'headless' }` from headless clients (CLI, cron, bots)
     * so tool calls auto-execute without waiting for human approval.
     */
    userInterventionConfig: UserInterventionConfigSchema.optional(),
  })
  .refine((data) => data.agentId || data.slug, {
    message: 'Either agentId or slug must be provided',
  })
  .superRefine((data, ctx) => {
    const resumePayloadCount = [
      data.resumeApproval,
      data.resumeApprovals,
      data.resumeToolResult,
    ].filter(Boolean).length;
    if (resumePayloadCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only one of resumeApproval, resumeApprovals, or resumeToolResult is allowed',
        path: ['resumeApproval'],
      });
    }

    if (resumePayloadCount > 0 && !data.parentMessageId) {
      ctx.addIssue({
        code: 'custom',
        message: 'parentMessageId is required for an intervention resume',
        path: ['parentMessageId'],
      });
    }

    if (
      data.resumeApproval &&
      data.parentMessageId &&
      data.resumeApproval.parentMessageId !== data.parentMessageId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'resumeApproval must target parentMessageId',
        path: ['resumeApproval', 'parentMessageId'],
      });
    }
    if (
      data.resumeToolResult &&
      data.parentMessageId &&
      data.resumeToolResult.parentMessageId !== data.parentMessageId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'resumeToolResult must target parentMessageId',
        path: ['resumeToolResult', 'parentMessageId'],
      });
    }

    if (data.resumeApprovals) {
      const messageIds = data.resumeApprovals.map(({ parentMessageId }) => parentMessageId);
      const toolCallIds = data.resumeApprovals.map(({ toolCallId }) => toolCallId);
      if (
        new Set(messageIds).size !== messageIds.length ||
        new Set(toolCallIds).size !== toolCallIds.length
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'resumeApprovals cannot contain duplicate targets',
          path: ['resumeApprovals'],
        });
      }
      if (data.parentMessageId && !messageIds.includes(data.parentMessageId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'parentMessageId must be one of the resumeApprovals targets',
          path: ['parentMessageId'],
        });
      }
    }
  });

/**
 * Schema for execGroupAgent - execute Supervisor Agent in Group chat
 */
const ExecGroupAgentSchema = z.object({
  /** The Supervisor agent ID */
  agentId: z.string(),
  /** File IDs attached to the message */
  files: z.array(z.string()).optional(),
  /** The Group ID */
  groupId: z.string(),
  /** User message content */
  message: z.string(),
  /** Optional: Create a new topic */
  newTopic: z
    .object({
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
    })
    .optional(),
  /** Existing topic ID */
  topicId: z.string().nullish(),
});

/**
 * Schema for execAgents - batch execution of multiple agents
 */
const ExecAgentsSchema = z.object({
  /** Whether to execute tasks in parallel (default: true) */
  parallel: z.boolean().optional().default(true),
  /** Array of agent tasks to execute */
  tasks: z.array(ExecAgentSchema).min(1),
});

/**
 * Schema for scheduleAgentRun - defer an agent run to a future time
 */
const ScheduleAgentRunSchema = z
  .object({
    /** The agent ID to run (either agentId or slug is required) */
    agentId: z.string().optional(),
    /** File IDs of already-uploaded attachments to attach when the run fires */
    fileIds: z.array(z.string()).optional(),
    /** Group to file the topic under, when scheduling from a group conversation */
    groupId: z.string().nullish(),
    /** Override the agent's default model */
    model: z.string().optional(),
    /** The user input/prompt, replayed verbatim when the run comes due */
    prompt: z.string().min(1),
    /** Override the agent's default provider */
    provider: z.string().optional(),
    /**
     * When to run. UTC ISO-8601 (`…Z`) — the dispatcher's due query compares it
     * as text, so a zoned offset would break the ordering.
     */
    runAt: z.string().datetime(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
  })
  .refine((data) => data.agentId || data.slug, {
    message: 'Either agentId or slug must be provided',
  });

/**
 * Schema for execSubAgentTask - execute SubAgent task
 * Supports both Group mode (with groupId) and Single Agent mode (without groupId)
 */
const ExecSubAgentTaskSchema = z.object({
  /** The SubAgent ID to execute the task */
  agentId: z.string(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Task instruction/prompt for the SubAgent */
  instruction: z.string(),
  /** The parent message ID (Supervisor's tool call message or task message) */
  parentMessageId: z.string(),
  /** Parent operation ID for dispatching callAgent hooks */
  parentOperationId: z.string().optional(),
  /** Timeout in milliseconds (optional) */
  timeout: z.number().optional(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for createClientTaskThread - create Thread for client-side task execution
 * This is used when runInClient=true on desktop client (single agent mode)
 */
const CreateClientTaskThreadSchema = z.object({
  /** The Agent ID to execute the task */
  agentId: z.string(),
  /** Optional assistant placeholder for transports that stream into an existing row. */
  assistantMessage: z.object({ provider: z.string() }).optional(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for createClientGroupAgentTaskThread - create Thread for client-side task execution in Group mode
 * This is specifically for Group Chat where messages may have different agentIds
 */
const CreateClientGroupAgentTaskThreadSchema = z.object({
  /** The Group ID (required for Group mode) */
  groupId: z.string(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** The Sub-Agent ID that will execute the task (worker agent in group) */
  subAgentId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for updateClientTaskThreadStatus - update Thread status after client-side execution
 */
const UpdateClientTaskThreadStatusSchema = z.object({
  /** Completion reason */
  completionReason: z.enum(['done', 'error', 'interrupted']),
  /** Error message if failed */
  error: z.string().optional(),
  /** Thread metadata to update */
  metadata: z
    .object({
      totalCost: z.number().optional(),
      totalMessages: z.number().optional(),
      totalSteps: z.number().optional(),
      totalTokens: z.number().optional(),
      totalToolCalls: z.number().optional(),
    })
    .optional(),
  /** Result content (last assistant message) */
  resultContent: z.string().optional(),
  /** The Thread ID */
  threadId: z.string(),
});

/**
 * Schema for interruptTask - interrupt a running task
 */
const InterruptTaskSchema = z
  .object({
    /** Operation ID */
    operationId: z.string().optional(),
    /** Thread ID */
    threadId: z.string().optional(),
    /**
     * Topic ID — used to cancel device-backed heterogeneous agent tasks.
     * When provided and the topic's runningOperation has a deviceId, the server
     * will dispatch a cancelHeteroTask tool call to kill the device process.
     */
    topicId: z.string().optional(),
  })
  .refine((data) => data.threadId || data.operationId, {
    message: 'Either threadId or operationId must be provided',
  });

/**
 * Wire shape of an `AgentStreamEvent` produced by `lh hetero exec`. Mirrors
 * `AgentStreamEvent` in `@lobechat/agent-gateway-client` (kept here as a Zod
 * schema for tRPC input validation; tRPC's type inference takes care of the
 * client-side typing). Republished verbatim through `StreamEventManager` so
 * gateway WS subscribers see the same shape regardless of producer.
 */
const AgentStreamEventSchema = z.object({
  data: z.any(),
  operationId: z.string(),
  stepIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  type: z.enum([
    'agent_runtime_init',
    'agent_runtime_end',
    'stream_start',
    'stream_chunk',
    'stream_end',
    'visible_output_end',
    'stream_retry',
    'tool_start',
    'tool_end',
    'tool_execute',
    'tool_result',
    'agent_intervention_request',
    'agent_intervention_response',
    'step_start',
    'step_complete',
    'notify_update',
    'error',
  ]),
});

/**
 * Schema for `aiAgent.heteroIngest` — accepts a batch of producer-side
 * `AgentStreamEvent`s from `lh hetero exec`. `topicId` is required (operationId
 * → topic reverse-lookup is unreliable per design decision).
 */
const HeteroIngestSchema = z.object({
  agentType: LocalHeterogeneousAgentTypeSchema,
  /** Initial assistant placeholder message id forwarded from the sandbox env var.
   * When present, `loadOrCreateState` uses it directly and skips the DB read of
   * topic.metadata.runningOperation, eliminating the replica-lag race condition. */
  assistantMessageId: z.string().min(1).optional(),
  events: z.array(AgentStreamEventSchema).min(1),
  operationId: z.string().min(1),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.heteroFinish` — terminal call, mirrors the CLI process
 * exit. `result` is the high-level outcome; `error` carries CLI-classified
 * details when `result === 'error'`. `sessionId` is the native CLI session
 * (CC's per-cwd id), kept here so the server can resume next time.
 */
const HeteroFinishSchema = z.object({
  agentType: LocalHeterogeneousAgentTypeSchema,
  /** Initial assistant placeholder forwarded by the producer. Unlike the live
   * ingest path, finish may arrive after gateway session completion has already
   * cleared topic.metadata.runningOperation, so this is the durable fallback
   * anchor for projecting a terminal error onto the assistant turn. */
  assistantMessageId: z.string().min(1).optional(),
  error: z
    .object({
      /**
       * Structured status-guide error for process-level failures (CLI not
       * installed, auth required) — the CLI's `classifyHeteroProcessFailure`
       * output. Persisted verbatim as the `ChatMessageError.body` so the
       * client renders the dedicated guide.
       */
      body: z.record(z.string(), z.unknown()).optional(),
      message: z.string(),
      type: z.string(),
    })
    .optional(),
  operationId: z.string().min(1),
  result: z.enum(['success', 'error', 'cancelled']),
  sessionId: z.string().optional(),
  topicId: z.string().min(1),
});

/**
 * Schema for `aiAgent.waitInterventionResponse` — the exec-side long-poll. The
 * `lh hetero exec` producer calls this in a loop while an `AskUserBridge`
 * pending is in flight, draining `agent_intervention_response` events off the
 * op's Redis stream (which the sandbox can't read directly). `lastEventId`
 * threads the cursor forward across polls; `'$'` on the first call means
 * "only events published from now on".
 */
const WaitInterventionResponseSchema = z.object({
  blockMs: z.number().int().positive().max(30_000).default(25_000),
  lastEventId: z.string().default('$'),
  operationId: z.string().min(1),
});

/**
 * Schema for `aiAgent.submitHeteroIntervention` — the browser leg of remote
 * Human-in-the-loop. The user's answer to an `agent_intervention_request` is
 * published back onto the op's Redis stream as an `agent_intervention_response`,
 * where both the renderer (card → resolved) and the exec long-poll converge on
 * it by `toolCallId`. Mutually exclusive: `result` on submit, `cancelled` on
 * skip/cancel.
 */
const SubmitHeteroInterventionSchema = z.object({
  cancelReason: z.enum(['timeout', 'user_cancelled', 'session_ended']).optional(),
  cancelled: z.boolean().optional(),
  operationId: z.string().min(1),
  /** Optional only for backward compatibility with pre-contract Web clients. */
  resolutionRequestId: z.string().uuid().optional(),
  result: z.unknown().optional(),
  /** Producer step index; harmless placeholder — correlation is by toolCallId. */
  stepIndex: z.number().int().nonnegative().default(0),
  toolCallId: z.string().min(1),
});

const HeteroInterventionReviewTokenSchema = z.object({
  /** 32 random bytes encoded as base64url without padding. */
  reviewToken: z.string().regex(/^[\w-]{43}$/),
});

const ResolveHeteroInterventionReviewSchema = z.object({
  action: z.enum(['submit', 'skip']),
  resolutionRequestId: z.string().uuid(),
  result: z.unknown().optional(),
  reviewToken: z.string().regex(/^[\w-]{43}$/),
});

const publishClaimedHeteroIntervention = async (params: {
  claim: Extract<
    Awaited<ReturnType<typeof resolveHeteroIntervention>>,
    { handled: true; state: 'claimed' }
  >;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { claim, userId, workspaceId } = params;
  const resolvedWorkspaceId = claim.workspaceId ?? workspaceId ?? undefined;
  const streamEventManager = createStreamEventManager();

  try {
    await streamEventManager.publishStreamEvent(claim.operationId, {
      data: {
        ...claim.response,
        producerAck: false,
        resolutionRequestId: claim.resolutionRequestId,
      },
      stepIndex: claim.stepIndex ?? 0,
      type: 'agent_intervention_response',
    });
  } catch (error) {
    await rollbackHeteroInterventionResolution({
      claimId: claim.claimId,
      operationId: claim.operationId,
      resolutionRequestId: claim.resolutionRequestId,
      toolCallId: claim.response.toolCallId,
      userId,
      workspaceId: resolvedWorkspaceId,
    }).catch((rollbackError) => {
      log(
        'conditional intervention rollback failed claim=%s op=%s: %O',
        claim.claimId,
        claim.operationId,
        rollbackError,
      );
    });
    throw error;
  }

  // Notification surfaces may switch to `resolving` only after XADD has
  // succeeded. This best-effort side effect must not roll back a response the
  // producer can already consume from the stream.
  await onHeteroInterventionResolutionPublished({
    claimId: claim.claimId,
    operationId: claim.operationId,
    resolutionRequestId: claim.resolutionRequestId,
    status: 'resolving',
    toolCallId: claim.response.toolCallId,
    userId,
    workspaceId: resolvedWorkspaceId,
  }).catch((notificationError) => {
    log(
      'intervention published hook failed claim=%s op=%s: %O',
      claim.claimId,
      claim.operationId,
      notificationError,
    );
  });

  return {
    // XADD only acknowledges transport acceptance. The producer's echoed
    // response is the authoritative terminal transition persisted by the
    // intervention reducer; until then the durable row remains resolving.
    status: 'resolving' as const,
    success: true as const,
  };
};

const aiAgentBaseProcedure = wsCompatProcedure.use(serverDatabase);

const aiAgentProcedure = aiAgentBaseProcedure.use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  // Read market accessToken from user_settings.market so server-side agent runtime
  // can authenticate with the Market API for creds operations.
  let marketAccessToken: string | undefined;
  try {
    const userModel = new UserModel(ctx.serverDB!, ctx.userId);
    const settings = await userModel.getUserSettings();
    marketAccessToken = (settings?.market as any)?.accessToken;
  } catch {
    // non-fatal — MarketService will fall back to trustedClientToken
  }

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, {
        marketAccessToken,
        withholdGatewayToken:
          ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes),
        workspaceId: wsId,
      }),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId, wsId),
      heterogeneousAgentService: new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Dedicated procedure for hetero-agent callbacks. Narrow operation tokens are
// re-authorized against durable operation state; pre-deploy operation tokens and
// normal user OIDC tokens go through the legacy ownership guards.
const heteroAgentProcedure = heteroAuthedProcedure.use(serverDatabase);
const aiAgentWriteProcedure = aiAgentProcedure.use(withScopedPermission('message:create'));

const authorizeOperationCallback = async (
  ctx: {
    heteroAuthKind: string;
    heteroOperation?: NonNullable<
      Parameters<typeof resolveActiveHeteroOperationPrincipal>[0]['claims']
    > | null;
    serverDB: LobeChatDatabase;
  },
  operationId: string,
  capability: 'hetero:finish' | 'hetero:ingest' | 'hetero:intervention:read',
) => {
  if (ctx.heteroAuthKind !== 'operation') return;
  if (!ctx.heteroOperation) throw new TRPCError({ code: 'UNAUTHORIZED' });
  try {
    await resolveActiveHeteroOperationPrincipal({
      capability,
      claims: ctx.heteroOperation,
      db: ctx.serverDB,
      operationId,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
};

const assertServerDefaultControlAuth = (oidcAuth: Record<string, unknown> | null | undefined) => {
  if (!oidcAuth || oidcAuth.purpose) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Server-default operations require Desktop OIDC authentication',
    });
  }
};

export const resolveServerDefaultHeterogeneousCapability = async () => {
  const base = {
    model: 'lobehub-default' as const,
  };
  if (process.env.ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT === '0') {
    return { ...base, agents: [], enabled: false as const, reason: 'disabled' as const };
  }

  try {
    const models = await getServerDefaultHeterogeneousModels();
    const agents = SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES.filter(
      (agentType) => models[agentType].length > 0,
    );
    if (agents.length === 0) {
      return {
        ...base,
        agents,
        enabled: false as const,
        models,
        reason: 'invalidConfiguration' as const,
      };
    }
    return { ...base, agents, enabled: true as const, models };
  } catch (error) {
    log('Server-default heterogeneous capability is unavailable: %O', error);
    return {
      ...base,
      agents: [],
      enabled: false as const,
      reason: 'invalidConfiguration' as const,
    };
  }
};

const resolveServerDefaultControlOperation = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
}) => {
  const [operation] = await params.db
    .select({
      metadata: agentOperations.metadata,
      model: agentOperations.model,
      provider: agentOperations.provider,
      status: agentOperations.status,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(
      and(eq(agentOperations.id, params.operationId), eq(agentOperations.userId, params.userId)),
    )
    .limit(1);

  if (!operation || operation.metadata?.serverDefaultHeterogeneous !== true) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Operation is outside the caller scope' });
  }

  if (operation.workspaceId) {
    const [membership] = await params.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, operation.workspaceId),
          eq(workspaceMembers.userId, params.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Operation is outside the caller scope' });
    }
  }

  return {
    model: new AgentOperationModel(params.db, params.userId, operation.workspaceId ?? undefined),
    operation,
  };
};

const settleServerDefaultControlOperation = async (params: {
  currentStatus: string;
  model: AgentOperationModel;
  operationId: string;
  targetStatus: 'done' | 'error' | 'interrupted';
}) => {
  if (params.currentStatus === params.targetStatus) return;
  if (params.currentStatus !== 'running') {
    throw new TRPCError({ code: 'CONFLICT', message: 'Operation has already ended' });
  }

  if (await params.model.settleRunning(params.operationId, params.targetStatus)) return;

  // Another terminal request won the CAS after the scope read. Treat an
  // identical terminal result as idempotent and reject a conflicting result.
  const current = await params.model.findById(params.operationId);
  if (current?.status !== params.targetStatus) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Operation has already ended' });
  }
};

export const aiAgentRouter = router({
  getServerDefaultHeterogeneousCapability: aiAgentBaseProcedure.query(() =>
    resolveServerDefaultHeterogeneousCapability(),
  ),

  beginServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(
      z.object({
        agentType: z.enum(SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES),
        agentId: z.string().optional(),
        model: z.string().min(1),
        operationId: z.string().min(1),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const workspaceId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId: input.topicId,
        userId: ctx.userId,
      });
      if (workspaceId && input.agentId) {
        await assertCanUseWorkspaceAgent({
          agentId: input.agentId,
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId,
        });
      }
      const capability = await resolveServerDefaultHeterogeneousCapability();
      if (!capability.enabled) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            capability.reason === 'disabled'
              ? 'Server-default agents are disabled'
              : 'No server model is available',
        });
      }
      const selection = await resolveServerDefaultHeterogeneousModel(
        input.agentType,
        input.model,
      ).catch((error) => {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: 'The selected server model is not available for this heterogeneous agent',
        });
      });
      await initModelRuntimeFromServerConfig({
        actorUserId: ctx.userId,
        workspaceId,
      }).catch((error) => {
        log('Selected server model runtime is unavailable: %O', error);
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message: 'The selected server model runtime is unavailable',
        });
      });

      const model = new AgentOperationModel(ctx.serverDB, ctx.userId, workspaceId);
      await model.recordStart({
        agentId: input.agentId,
        metadata: { agentType: input.agentType, serverDefaultHeterogeneous: true },
        model: selection.model,
        operationId: input.operationId,
        provider: selection.provider,
        topicId: input.topicId,
        trigger: RequestTrigger.Chat,
      });
      const operation = await model.findById(input.operationId);
      if (
        !operation ||
        operation.userId !== ctx.userId ||
        operation.workspaceId !== (workspaceId ?? null) ||
        operation.status !== 'running' ||
        operation.topicId !== input.topicId ||
        operation.agentId !== (input.agentId ?? null) ||
        operation.model !== selection.model ||
        operation.provider !== selection.provider ||
        operation.metadata?.agentType !== input.agentType
      ) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Operation id is already in use' });
      }

      return {
        model: 'lobehub-default' as const,
        token: await signHeteroOperationJWT({
          capabilities: ['model:invoke'],
          model: selection.model,
          operationId: input.operationId,
          providerId: selection.provider,
          userId: ctx.userId,
          workspaceId,
        }),
      };
    }),

  finishServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(z.object({ operationId: z.string().min(1), result: z.enum(['done', 'error']) }))
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const { model, operation } = await resolveServerDefaultControlOperation({
        db: ctx.serverDB,
        operationId: input.operationId,
        userId: ctx.userId,
      });
      await settleServerDefaultControlOperation({
        currentStatus: operation.status,
        model,
        operationId: input.operationId,
        targetStatus: input.result,
      });
      return { success: true as const };
    }),

  cancelServerDefaultHeterogeneousOperation: aiAgentBaseProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      assertServerDefaultControlAuth(ctx.oidcAuth);
      const { model, operation } = await resolveServerDefaultControlOperation({
        db: ctx.serverDB,
        operationId: input.operationId,
        userId: ctx.userId,
      });
      await settleServerDefaultControlOperation({
        currentStatus: operation.status,
        model,
        operationId: input.operationId,
        targetStatus: 'interrupted',
      });
      return { success: true as const };
    }),

  /**
   * Create Thread for client-side task execution in Group mode
   *
   * This endpoint is specifically designed for Group Chat scenarios where:
   * - Messages in the thread may have different agentIds (supervisor, workers)
   * - The subAgentId is the worker agent that executes the task
   * - Thread messages query should not filter by agentId to include all parent messages
   */
  createClientGroupAgentTaskThread: aiAgentWriteProcedure
    .input(CreateClientGroupAgentTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { groupId, instruction, parentMessageId, subAgentId, title, topicId } = input;

      log('createClientGroupAgentTaskThread: subAgentId=%s, groupId=%s', subAgentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId: subAgentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // 1. Create Thread for isolated task execution
        // Use subAgentId as the thread's agentId (the executing agent)
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId: subAgentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientGroupAgentTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        // Use subAgentId as the message's agentId
        const userMessage = await ctx.messageModel.create({
          agentId: subAgentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientGroupAgentTaskThread: created user message %s', userMessage.id);

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          // DON'T pass agentId - thread query fetches parent messages via sourceMessageId
          // which may have different agentIds (supervisor vs worker in group chat)
          ctx.messageModel.query({ threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId)
          // Only filter by groupId + topicId (not agentId) to include all agents' messages
          ctx.messageModel.query({ groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientGroupAgentTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientGroupAgentTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client group agent task thread: ${error.message}`,
        });
      }
    }),

  /**
   * Create Thread for client-side task execution
   *
   * This endpoint is called by desktop client when runInClient=true.
   * It creates the Thread but does NOT execute the task - execution happens on client side.
   */
  createClientTaskThread: aiAgentWriteProcedure
    .input(CreateClientTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, assistantMessage, groupId, instruction, parentMessageId, title, topicId } =
        input;

      log('createClientTaskThread: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // 1. Create Thread for isolated task execution
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        const userMessage = await ctx.messageModel.create({
          agentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientTaskThread: created user message %s', userMessage.id);

        const assistantMessageRecord = assistantMessage
          ? await ctx.messageModel.create({
              agentId,
              content: LOADING_FLAT,
              groupId,
              parentId: userMessage.id,
              provider: assistantMessage.provider,
              role: 'assistant',
              threadId: thread.id,
              topicId,
            })
          : undefined;

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          ctx.messageModel.query({ agentId, threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId, includes updated taskDetail)
          // Pass both agentId and groupId - query() prioritizes groupId when present
          ctx.messageModel.query({ agentId, groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          assistantMessageId: assistantMessageRecord?.id,
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client task thread: ${error.message}`,
        });
      }
    }),

  execAgent: aiAgentWriteProcedure.input(ExecAgentSchema).mutation(async ({ input, ctx }) => {
    const {
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      deviceId,
      localDeviceId,
      existingMessageIds = [],
      fileIds,
      mentionedAgents,
      parentMessageId,
      resumeApproval,
      resumeApprovals,
      resumeToolResult,
      selectedToolIds,
      trigger,
      userInterventionConfig,
    } = input;

    log('execAgent: identifier=%s, prompt=%s', agentId || slug, prompt.slice(0, 50));

    try {
      await assertCanUseWorkspaceAgent({
        agentId,
        db: ctx.serverDB,
        groupId: appContext?.groupId,
        slug,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: [
          ...existingMessageIds,
          parentMessageId,
          // A new subtopic branches off an existing message — authorize that
          // anchor too, or a caller could fork a thread off someone else's turn.
          appContext?.newThread?.sourceMessageId,
          resumeApproval?.parentMessageId,
          // Every batch target is authorized too — a caller must not be able to
          // slip a message it doesn't own into the list behind an owned anchor.
          ...(resumeApprovals ?? []).map((decision) => decision.parentMessageId),
          resumeToolResult?.parentMessageId,
        ],
        topicId: appContext?.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Cross-version bridge: older Web clients call execAgent directly with
      // resume payloads and know nothing about the v2 source endpoint. Recover
      // the authoritative operation/batch from the tool rows and claim the
      // same generic intervention before the legacy message CAS can run.
      const legacyResumeTargets = [
        ...(resumeApprovals ?? []),
        ...(resumeApproval ? [resumeApproval] : []),
        ...(resumeToolResult
          ? [
              {
                decision: 'approved' as const,
                parentMessageId: resumeToolResult.parentMessageId,
                toolCallId: resumeToolResult.toolCallId,
              },
            ]
          : []),
      ];
      if (legacyResumeTargets.length > 0) {
        const plugins = await Promise.all(
          legacyResumeTargets.map(({ parentMessageId }) =>
            ctx.messageModel.findMessagePlugin(parentMessageId),
          ),
        );
        const firstIntervention = plugins[0]?.intervention;
        const hasGenericSource = Boolean(
          firstIntervention?.operationId &&
          firstIntervention.batchId &&
          plugins.every(
            (plugin) =>
              plugin?.intervention?.operationId === firstIntervention.operationId &&
              plugin?.intervention?.batchId === firstIntervention.batchId,
          ),
        );

        if (hasGenericSource) {
          let sourceAction: AgentInterventionSourceAction | undefined;
          if (resumeToolResult) {
            if (resumeToolResult.outcome === 'skipped') {
              sourceAction = { type: 'skip_interaction' };
            } else {
              const pluginState = resumeToolResult.pluginState as
                | {
                    askUserAnswers?: Record<string, unknown>;
                    selectedAgentIds?: unknown;
                  }
                | undefined;
              const answers = pluginState?.askUserAnswers;
              if (
                answers &&
                Object.keys(answers).length > 0 &&
                Object.values(answers).every(
                  (answer) =>
                    typeof answer === 'string' ||
                    (Array.isArray(answer) && answer.every((item) => typeof item === 'string')),
                )
              ) {
                sourceAction = {
                  result: answers as Record<string, string | string[]>,
                  type: 'submit_answers',
                };
              } else if (
                plugins[0]?.identifier === 'lobe-web-onboarding' &&
                plugins[0]?.apiName === 'showAgentMarketplace' &&
                Array.isArray(pluginState?.selectedAgentIds) &&
                pluginState.selectedAgentIds.every((id) => typeof id === 'string')
              ) {
                sourceAction = {
                  result: {
                    kind: 'agent_marketplace',
                    selectedTemplateIds: pluginState.selectedAgentIds as string[],
                  },
                  type: 'submit_custom',
                };
              }
            }
          } else if (legacyResumeTargets.every(({ decision }) => decision === 'approved')) {
            // The legacy resume envelope has neither staged edits nor remember
            // intent. Cloud therefore compares the durable revision with the
            // authoritative message arguments and rejects a pre-mutated old
            // edit as stale with a refresh-required conflict; it must never
            // reinterpret already-written client state as an atomic edit.
            // Old clients may also have changed their personal allow-list
            // before this call, which remains a rollout-only non-atomic edge.
            // Current Web sends both edits and remember through the source
            // endpoint before any side effect.
            sourceAction = { scope: 'once', type: 'approve_tool' };
          } else if (
            legacyResumeTargets.every(
              ({ decision }) => decision === 'rejected' || decision === 'rejected_continue',
            )
          ) {
            const reasons = [
              ...new Set(
                legacyResumeTargets
                  .map(({ rejectionReason }) => rejectionReason)
                  .filter((reason): reason is string => Boolean(reason)),
              ),
            ];
            sourceAction = {
              ...(reasons.length === 1 && { reason: reasons[0] }),
              type: 'reject_continue',
            };
          }

          if (!sourceAction) {
            throw new Error('Unsupported legacy intervention payload for a durable generic row');
          }

          const sourceResolution = await resolveAgentInterventionBySource({
            action: sourceAction,
            actorUserId: ctx.userId,
            batchId: firstIntervention!.batchId!,
            operationId: firstIntervention!.operationId!,
            resolutionRequestId: randomUUID(),
            targets: legacyResumeTargets.map(({ parentMessageId, toolCallId }) => ({
              toolCallId,
              toolMessageId: parentMessageId,
            })),
            workspaceId: ctx.workspaceId ?? undefined,
          });
          if (sourceResolution.handled) {
            if (sourceResolution.state === 'already_resolved') {
              throw new HumanApprovalAlreadyResolvedError(parentMessageId ?? 'intervention');
            }
            const dispatch = await dispatchClaimedAgentIntervention(sourceResolution, ctx);
            if (!dispatch.execution) {
              throw new Error('Durable intervention resume did not create an operation');
            }
            return dispatch.execution;
          }
        }
      }

      return await ctx.aiAgentService.execAgent({
        agentId,
        appContext,
        autoStart,
        clientIds: input.clientIds,
        // This procedure serves the composer (`aiAgentService.execAgentTask`).
        // The client already queues follow-ups behind a live run and shows the
        // user a tray; refusing here would only make the message disappear.
        interactiveStart: true,
        // Propagate the originating request's client IP / user agent into the run
        // so downstream LLM-call metadata can carry them for auditing and spend
        // attribution. These are server-derived from the tRPC context and are
        // intentionally not part of the client-passable input schema.
        clientIp: ctx.clientIp ?? undefined,
        deviceId,
        localDeviceId,
        existingMessageIds,
        fileIds,
        mentionedAgents,
        parentMessageId,
        prompt,
        // When parentMessageId is provided, this is a regeneration/continue or a
        // human-approval resume — either way, skip user message creation.
        resume: !!parentMessageId,
        resumeApproval,
        resumeApprovals,
        resumeToolResult,
        selectedToolIds,
        slug,
        trigger: trigger ?? RequestTrigger.Chat,
        userAgent: ctx.userAgent ?? undefined,
        userInterventionConfig,
      });
    } catch (error: any) {
      console.error('execAgent failed: %O', error);

      if (error instanceof TRPCError) {
        throw error;
      }

      if (error instanceof HumanApprovalAlreadyResolvedError) {
        throw new TRPCError({
          cause: error,
          code: 'CONFLICT',
          message: 'This approval has already been resolved.',
        });
      }

      // A primary-key collision on a client-supplied id (a retried send
      // replaying the same `clientIds`) is client-correctable — surface it as
      // CONFLICT, not a 500. Generic message on purpose: echoing the id would
      // let a caller probe for rows it cannot read.
      if (unwrapPgError(error)?.code === '23505') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This run has already been created.',
        });
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to execute agent: ${error.message}`,
      });
    }
  }),

  /**
   * Defer an agent run to a future time ("send this in 3 hours").
   *
   * Kept separate from `execAgent` rather than folded in behind a `runAt` flag:
   * nothing is executed here, so every run-shaped field of `ExecAgentResult`
   * (operationId, assistantMessageId, autoStarted) would come back empty and
   * every caller would have to branch on it.
   *
   * Cancelling / rescheduling goes through the ordinary topic update mutations —
   * those are already ownership-scoped, and a schedule is just topic state.
   */
  scheduleAgentRun: aiAgentWriteProcedure
    .input(ScheduleAgentRunSchema)
    .mutation(async ({ input, ctx }) => {
      log('scheduleAgentRun: identifier=%s, runAt=%s', input.agentId || input.slug, input.runAt);

      try {
        await assertCanUseWorkspaceAgent({
          agentId: input.agentId,
          db: ctx.serverDB,
          slug: input.slug,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        return await ctx.aiAgentService.scheduleAgentRun(input);
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to schedule agent run: ${error.message}`,
        });
      }
    }),

  /**
   * Batch execute multiple agents
   * Supports parallel or sequential execution
   */
  execAgents: aiAgentWriteProcedure.input(ExecAgentsSchema).mutation(async ({ input, ctx }) => {
    const { tasks, parallel = true } = input;

    log('execAgents: %d tasks, parallel=%s', tasks.length, parallel);

    type TaskResult = {
      autoStarted?: boolean;
      error?: string;
      operationId?: string;
      success: boolean;
      taskIndex: number;
    };

    const executeTask = async (
      task: (typeof tasks)[number],
      taskIndex: number,
    ): Promise<TaskResult> => {
      const {
        agentId,
        slug,
        prompt,
        appContext,
        autoStart = true,
        deviceId,
        existingMessageIds = [],
        parentMessageId,
        trigger,
      } = task;

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId: appContext?.groupId,
          slug,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [
            ...existingMessageIds,
            parentMessageId,
            task.resumeApproval?.parentMessageId,
            task.resumeToolResult?.parentMessageId,
          ],
          topicId: appContext?.topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        const result = await ctx.aiAgentService.execAgent({
          agentId,
          appContext,
          autoStart,
          deviceId,
          existingMessageIds,
          parentMessageId,
          prompt,
          // When parentMessageId is provided, this is a regeneration/continue — skip user message creation
          resume: !!parentMessageId,
          slug,
          trigger: trigger ?? RequestTrigger.Chat,
        });

        return {
          autoStarted: result.autoStarted,
          operationId: result.operationId,
          success: true,
          taskIndex,
        };
      } catch (error: any) {
        log('execAgents task %d failed: %O', taskIndex, error);

        return {
          error: error.message || 'Unknown error',
          success: false,
          taskIndex,
        };
      }
    };

    // Execute tasks with pMap for concurrency control
    // parallel=true: concurrency of 5, parallel=false: sequential (concurrency of 1)
    const concurrency = parallel ? 5 : 1;

    const results = await pMap(tasks, (task, index) => executeTask(task, index), { concurrency });

    // Calculate summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      results,
      success: failed === 0,
      summary: {
        failed,
        succeeded,
        total: tasks.length,
      },
    };
  }),

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This endpoint combines message creation and agent execution:
   * 1. Create topic (if needed)
   * 2. Create user message
   * 3. Create assistant message placeholder
   * 4. Trigger Supervisor Agent execution
   * 5. Return operationId for SSE connection + messages for UI sync
   */
  execGroupAgent: aiAgentWriteProcedure
    .input(ExecGroupAgentSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, message, files, topicId, newTopic } = input;

      log('execGroupAgent: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: newTopic?.topicMessageIds,
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        // Execute group agent
        const result = await ctx.aiAgentService.execGroupAgent({
          agentId,
          files,
          groupId,
          message,
          newTopic,
          topicId,
        });

        // Get messages and topics for UI sync
        // Messages include the assistant message with error if operation failed to start
        const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
          agentId,
          groupId,
          includeTopic: result.isCreateNewTopic,
          topicId: result.topicId,
        });

        // Return result with messages/topics - includes error/success fields
        // Frontend can check success to decide whether to connect to SSE stream
        return { ...result, messages, topics };
      } catch (error: any) {
        log('execGroupAgent failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute group agent: ${error.message}`,
        });
      }
    }),

  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This endpoint is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   */
  execSubAgentTask: aiAgentWriteProcedure
    .input(ExecSubAgentTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        agentId,
        groupId,
        instruction,
        parentMessageId,
        parentOperationId,
        title,
        topicId,
        timeout,
      } = input;

      log('execSubAgentTask: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // External procedure name stays `execSubAgentTask`; the service method is `execSubAgent`.
        return await ctx.aiAgentService.execSubAgent({
          agentId,
          groupId,
          instruction,
          parentMessageId,
          ...(parentOperationId && { parentOperationId }),
          timeout,
          title,
          topicId,
        });
      } catch (error: any) {
        log('execSubAgentTask failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute sub-agent task: ${error.message}`,
        });
      }
    }),

  getOperationStatus: aiAgentProcedure
    .input(GetOperationStatusSchema)
    .query(async ({ input, ctx }) => {
      const { historyLimit, includeHistory, operationId } = input;

      if (!operationId) {
        throw new Error('operationId parameter is required');
      }

      log('Getting operation status for %s', operationId);

      // Get operation status using AgentRuntimeService
      const operationStatus = await ctx.agentRuntimeService.getOperationStatus({
        historyLimit,
        includeHistory,
        operationId,
      });

      return operationStatus;
    }),

  getPendingInterventions: aiAgentProcedure
    .input(GetPendingInterventionsSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, userId } = input;

      log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

      // Get pending interventions using AgentRuntimeService
      const result = await ctx.agentRuntimeService.getPendingInterventions({
        operationId: operationId || undefined,
        userId: userId || undefined,
      });

      return result;
    }),

  /**
   * Get SubAgent task execution status
   *
   * This endpoint queries the status of a SubAgent task by threadId.
   * It queries from Thread table (PostgreSQL) for persistence,
   * and supplements with real-time status from Redis if available.
   *
   * Works for both Group mode and Single Agent mode tasks.
   *
   * IMPORTANT: In QStash queue mode, step lifecycle callbacks cannot fire
   * because each HTTP request creates a new AgentRuntimeService instance.
   * As a workaround, this endpoint also updates Thread metadata from Redis
   * when real-time status is available.
   */
  getSubAgentTaskStatus: aiAgentProcedure
    .input(
      z.object({
        /** Thread ID */
        threadId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { threadId } = input;

      log('getSubAgentTaskStatus: threadId=%s', threadId);

      // 1. Find thread by threadId
      const thread = await ctx.threadModel.findById(threadId);

      if (!thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Thread not found',
        });
      }

      // 2. Map Thread status to task status
      const threadStatusToTaskStatus: Record<string, TaskStatusResult['status']> = {
        [ThreadStatus.Active]: 'processing',
        [ThreadStatus.Cancel]: 'cancel',
        [ThreadStatus.Completed]: 'completed',
        [ThreadStatus.Failed]: 'failed',
        [ThreadStatus.InReview]: 'processing',
        [ThreadStatus.Pending]: 'processing',
        [ThreadStatus.Processing]: 'processing',
        [ThreadStatus.Todo]: 'processing',
      };

      const taskStatus = threadStatusToTaskStatus[thread.status] || 'processing';
      const metadata = thread.metadata;

      // 3. Try to get real-time status from Redis (for active tasks)
      // Note: This is optional - Redis operation may be expired or unavailable.
      // Thread table is the persistent source of truth.
      let realtimeStatus: Awaited<ReturnType<typeof ctx.agentRuntimeService.getOperationStatus>> =
        null;
      const resolvedOperationId = metadata?.operationId;
      if (resolvedOperationId && taskStatus === 'processing') {
        realtimeStatus = await ctx.agentRuntimeService.getOperationStatus({
          operationId: resolvedOperationId,
        });

        // 4. WORKAROUND for QStash mode: Update Thread metadata from Redis
        // In QStash mode, step callbacks don't fire because each HTTP request
        // creates a new AgentRuntimeService instance with empty callback map.
        // So we update Thread metadata here when polling for status.
        // Note: realtimeStatus may be null if operation expired from Redis
        if (realtimeStatus) {
          const redisState = realtimeStatus.currentState;
          const updatedMetadata: Record<string, any> = {
            ...metadata,
            operationId: resolvedOperationId,
          };

          // Update metrics from Redis state using currentState and stats
          if (redisState.usage) {
            updatedMetadata.totalTokens = redisState.usage.llm?.tokens?.total;
            updatedMetadata.totalToolCalls = redisState.usage.tools?.totalCalls;
          }
          if (redisState.cost?.total !== undefined) {
            updatedMetadata.totalCost = redisState.cost.total;
          }

          // Use stats for totalMessages (currentState doesn't include messages array)
          const { stats } = realtimeStatus;
          if (stats?.totalMessages) {
            updatedMetadata.totalMessages = stats.totalMessages;
          }

          // Store totalSteps from stepCount
          if (redisState.stepCount) {
            updatedMetadata.totalSteps = redisState.stepCount;
          }

          // Check if operation is completed
          if (realtimeStatus.isCompleted || redisState.status === 'done') {
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            // Update thread status to completed
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Completed,
            });

            log('getSubAgentTaskStatus: marked thread %s as completed', threadId);
          } else if (realtimeStatus.hasError || redisState.status === 'error') {
            // Normalize nested runtime errors so task metadata keeps a readable message.
            const formattedError = formatTaskError(redisState.error);

            updatedMetadata.error = formattedError;
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            log('getSubAgentTaskStatus: error formatting for thread %s: %O', threadId, {
              originalError: redisState.error,
              formattedError,
            });

            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Failed,
            });
            log('getSubAgentTaskStatus: marked thread %s as failed', threadId);
          } else {
            // Still processing, just update metrics
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
            });
            log('getSubAgentTaskStatus: updated thread %s metadata', threadId);
          }
        } else {
          // Redis status not available (expired), use Thread data only
          log(
            'getSubAgentTaskStatus: Redis operation %s expired, using Thread data only',
            resolvedOperationId,
          );
        }
      }

      // 5. Re-fetch thread to get updated metadata
      const updatedThread = await ctx.threadModel.findById(threadId);
      const updatedMetadata = updatedThread?.metadata ?? metadata;
      const updatedStatus = updatedThread?.status ?? thread.status;
      const updatedTaskStatus = threadStatusToTaskStatus[updatedStatus] || 'processing';

      if (updatedTaskStatus === 'failed') {
        log('getSubAgentTaskStatus: returning failed task status for thread %s: %O', threadId, {
          updatedMetadata,
          error: updatedMetadata?.error,
          updatedStatus,
        });
      }

      // 6. Query thread messages for result content or current activity
      const threadMessages = await ctx.messageModel.query(
        { threadId },
        {
          postProcessUrl: createUiMessageFileUrlResolver(),
        },
      );
      const sortedMessages = threadMessages.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // 6.1 Parse messages using conversation-flow for UI display
      const { flatList: parsedMessages } = parse(threadMessages);

      // 7. Get result content when task is completed or failed
      let resultContent: string | undefined;
      if (updatedTaskStatus === 'completed' || updatedTaskStatus === 'failed') {
        const lastAssistantMessage = sortedMessages.find((m) => m.role === 'assistant');
        resultContent = lastAssistantMessage?.content;
      }

      // 8. Build currentActivity when task is processing
      let currentActivity: TaskCurrentActivity | undefined;
      if (updatedTaskStatus === 'processing' && sortedMessages.length > 0) {
        const lastMessage = sortedMessages[0];

        if (lastMessage.role === 'tool') {
          // Tool message means tool has returned result
          currentActivity = {
            apiName: lastMessage.plugin?.apiName ?? undefined,
            contentPreview: lastMessage.content?.slice(0, 100),
            identifier: lastMessage.plugin?.identifier ?? undefined,
            type: 'tool_result',
          };
        } else if (lastMessage.role === 'assistant') {
          // Check if assistant is calling tools
          const tools = lastMessage.tools as Array<{
            apiName?: string;
            identifier?: string;
          }> | null;
          if (tools && tools.length > 0) {
            const lastTool = tools.at(-1);
            currentActivity = {
              apiName: lastTool?.apiName,
              identifier: lastTool?.identifier,
              type: 'tool_calling',
            };
          } else {
            // Assistant is generating content
            currentActivity = {
              contentPreview: lastMessage.content?.slice(0, 100),
              type: 'generating',
            };
          }
        }
      }

      // 9. Build TaskDetail from Thread (uses ThreadStatus)
      const taskDetail = {
        completedAt: updatedMetadata?.completedAt,
        duration: updatedMetadata?.duration,
        error: updatedMetadata?.error,
        startedAt: updatedMetadata?.startedAt,
        status: updatedStatus,
        threadId: thread.id,
        title: thread.title,
        totalCost: updatedMetadata?.totalCost,
        totalMessages: updatedMetadata?.totalMessages,
        totalSteps: updatedMetadata?.totalSteps,
        totalTokens: updatedMetadata?.totalTokens,
        totalToolCalls: updatedMetadata?.totalToolCalls,
      };

      // 10. Build result
      const result: TaskStatusResult = {
        completedAt: updatedMetadata?.completedAt,
        cost:
          realtimeStatus?.currentState?.cost ??
          (updatedMetadata?.totalCost ? { total: updatedMetadata.totalCost } : undefined),
        currentActivity,
        error: updatedMetadata?.error ?? realtimeStatus?.currentState?.error,
        messages: parsedMessages,
        result: resultContent,
        status: updatedTaskStatus,
        stepCount: realtimeStatus?.currentState?.stepCount,
        taskDetail,
        usage:
          realtimeStatus?.currentState?.usage ??
          (updatedMetadata?.totalTokens
            ? { total_tokens: updatedMetadata.totalTokens }
            : undefined),
      };

      return result;
    }),

  /**
   * Interrupt a running task
   *
   * This endpoint interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  /**
   * Stop a run parked on tool approval: settle the pending tool rows and end
   * the operation without executing anything or continuing the model.
   *
   * Distinct from `interruptTask`, which only flips runtime state and assumes
   * a live loop will persist the outcome — a parked run has no loop, so its
   * tool rows and DB row would both be left behind.
   */
  stopPendingApproval: aiAgentWriteProcedure
    .input(
      z.object({
        /** Stable sealed batch id stamped on every pending tool row. */
        batchId: z.string().min(1),
        /** Exact parked operation to stop; never inferred from topic recency. */
        operationId: z.string().min(1),
        /** Pending `role='tool'` message ids to settle — the active batch. */
        toolMessageIds: z.array(z.string()).min(1),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Same ownership gate the approval resume uses: every target must belong
      // to the caller before anything is written.
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: input.toolMessageIds,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      const stopPlugins = await Promise.all(
        input.toolMessageIds.map((id) => ctx.messageModel.findMessagePlugin(id)),
      );
      const hasGenericSource = stopPlugins.every(
        (plugin) =>
          Boolean(plugin?.toolCallId) &&
          plugin?.intervention?.operationId === input.operationId &&
          plugin.intervention.batchId === input.batchId,
      );
      if (hasGenericSource) {
        const sourceResolution = await resolveAgentInterventionBySource({
          action: { scope: 'operation', type: 'stop' },
          actorUserId: ctx.userId,
          batchId: input.batchId,
          operationId: input.operationId,
          resolutionRequestId: randomUUID(),
          targets: stopPlugins.map((plugin, index) => ({
            toolCallId: plugin!.toolCallId!,
            toolMessageId: input.toolMessageIds[index],
          })),
          workspaceId: ctx.workspaceId ?? undefined,
        });
        if (sourceResolution.handled) {
          if (sourceResolution.state === 'already_resolved') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'This approval has already been resolved.',
            });
          }
          await dispatchClaimedAgentIntervention(sourceResolution, ctx);
          return {
            operationId: input.operationId,
            settledToolMessageIds: input.toolMessageIds,
            success: true,
          };
        }
      }

      return ctx.aiAgentService.stopPendingApproval({
        batchId: input.batchId,
        operationId: input.operationId,
        toolMessageIds: input.toolMessageIds,
        topicId: input.topicId,
      });
    }),

  interruptTask: aiAgentWriteProcedure
    .input(InterruptTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const { threadId, operationId, topicId } = input;

      log('interruptTask: threadId=%s, operationId=%s, topicId=%s', threadId, operationId, topicId);

      try {
        return await ctx.aiAgentService.interruptTask({ operationId, threadId, topicId });
      } catch (error: any) {
        if (error.message === 'Thread not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
        }
        if (error.message === 'Operation ID not found') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Operation ID not found' });
        }
        throw error;
      }
    }),

  /**
   * Ingest a batch of `AgentStreamEvent`s from a `lh hetero exec` producer
   * (CLI standalone, sandboxed CC, etc.) and republish them through the
   * existing stream fanout so renderer-side gateway WS subscribers see them
   * unchanged. Phase 2a: pub/sub only — no DB persistence (phase 2b adds it).
   */
  heteroIngest: heteroAgentProcedure.input(HeteroIngestSchema).mutation(async ({ input, ctx }) => {
    const { agentType, assistantMessageId, events, operationId, topicId } = input;

    await authorizeOperationCallback(ctx, operationId, 'hetero:ingest');

    log(
      'heteroIngest: topic=%s op=%s type=%s count=%d',
      topicId,
      operationId,
      agentType,
      events.length,
    );

    try {
      const wsId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId,
        userId: ctx.userId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // Zod's z.any() infers `data?: any`, but the wire shape always includes
      // a `data` field (may be null). Cast at the boundary instead of widening
      // the shared `AgentStreamEvent` type or the service signature.
      await heteroService.heteroIngest({
        agentType,
        assistantMessageId,
        events: events as AgentStreamEvent[],
        operationId,
        topicId,
      });
      return { ack: true as const };
    } catch (error: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (error instanceof TRPCError) throw error;
      log('heteroIngest failed: %s', error?.message);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: error?.message || 'Failed to ingest heterogeneous agent events',
      });
    }
  }),

  /**
   * Terminal handshake from a `lh hetero exec` producer: signals process exit
   * and carries the run's high-level outcome. Always emits a final
   * `agent_runtime_end` so renderer subscribers can shut down even when the
   * CLI's own end-event was lost mid-flight.
   */
  heteroFinish: heteroAgentProcedure.input(HeteroFinishSchema).mutation(async ({ input, ctx }) => {
    const { agentType, assistantMessageId, error, operationId, result, sessionId, topicId } = input;

    await authorizeOperationCallback(ctx, operationId, 'hetero:finish');

    log('heteroFinish: topic=%s op=%s type=%s result=%s', topicId, operationId, agentType, result);

    try {
      const wsId = await resolveHeteroTopicWorkspace({
        db: ctx.serverDB,
        requestedWorkspaceId: ctx.workspaceId,
        topicId,
        userId: ctx.userId,
      });
      const heteroService = new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      });

      // heteroFinish now owns the full terminal transition: it fires the run's
      // onComplete/onError hooks through the shared hookDispatcher, which drives
      // the task lifecycle (onTopicComplete) and any IM bot completion callback —
      // the same mechanism the normal LLM runtime uses. No bespoke lifecycle call
      // here anymore; this is just the server-to-server ack endpoint.
      await heteroService.heteroFinish({
        agentType,
        assistantMessageId,
        error,
        operationId,
        result,
        sessionId,
        topicId,
      });

      return { ack: true as const };
    } catch (err: any) {
      // Preserve deliberate auth errors (e.g. the ownership FORBIDDEN) instead
      // of masking them as a generic 500.
      if (err instanceof TRPCError) throw err;
      log('heteroFinish failed: %s', err?.message);
      throw new TRPCError({
        cause: err,
        code: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'Failed to finalize heterogeneous agent run',
      });
    }
  }),

  /**
   * Exec-side long-poll for remote Human-in-the-loop (op-JWT auth, same as
   * `heteroIngest`). The `lh hetero exec` producer — which holds only an
   * op-scoped JWT + tRPC and never the server's Redis — pulls
   * `agent_intervention_response` events off the op's Redis stream through this
   * server-mediated read, then resolves its in-process `AskUserBridge`. One
   * bounded `XREAD BLOCK` per call; the producer loops while a pending is in
   * flight, threading `lastEventId` forward so nothing is missed between polls.
   */
  waitInterventionResponse: heteroAgentProcedure
    .input(WaitInterventionResponseSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, lastEventId, blockMs } = input;

      await authorizeOperationCallback(ctx, operationId, 'hetero:intervention:read');

      // Ownership guard, mirroring heteroIngest / heteroFinish. The op stream is
      // read by `operationId` alone, so an owner-token caller (a logged-in
      // desktop reusing its own OIDC session) must prove it owns THIS operation
      // — otherwise any signed-in user could long-poll another run's
      // `agent_intervention_response` payloads by id. Bind the guard to the
      // operation row directly (tighter than the topic-level guard the write
      // paths use, since the read has no topicId to key on). Strict operation-token
      // callers already passed the durable principal check above; user tokens and
      // pre-deploy operation tokens use the legacy ownership lookup.
      if (ctx.heteroAuthKind !== 'operation') {
        const [operationRow] = await ctx.serverDB
          .select({ userId: agentOperations.userId })
          .from(agentOperations)
          .where(eq(agentOperations.id, operationId))
          .limit(1);

        if (operationRow?.userId !== ctx.userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Operation not found or not owned by the caller',
          });
        }
      }

      const streamEventManager = createStreamEventManager();
      const { events, lastEventId: nextEventId } = await streamEventManager.readEventsOnce(
        operationId,
        lastEventId,
        blockMs,
      );

      // Only intervention responses matter to the producer; everything else on
      // the stream is already going out via its own outbound ingest path.
      return {
        events: events.filter((e) => e.type === 'agent_intervention_response'),
        lastEventId: nextEventId,
      };
    }),

  /**
   * Authenticated v2 review lookup. The opaque token is only a locator: the
   * business implementation must resolve the row, then evaluate view and
   * resolve access against the intervention's current conversation resource.
   * Keep the token in a POST body rather than a query URL retained by access
   * logs and browser history.
   */
  getAgentInterventionReview: aiAgentBaseProcedure
    .input(GetAgentInterventionReviewSchema)
    .mutation(({ input, ctx }) =>
      getAgentInterventionReview({
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
    ),

  /**
   * Read-only counterpart to the active Web source resolver. Chat surfaces
   * fetch authoritative authorization before rendering controls, so a
   * view-only collaborator sees the request with actions disabled instead of
   * discovering the denial only after a mutation. Source ids remain locators;
   * Cloud applies the final resource ACL after resolving the durable row.
   */
  getAgentInterventionReviewBySource: aiAgentBaseProcedure
    .input(GetAgentInterventionReviewBySourceSchema)
    .mutation(async ({ input, ctx }) => {
      await assertCanViewMessageTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        input.targets.map(({ toolMessageId }) => toolMessageId),
      );

      return getAgentInterventionReviewBySource({
        actorUserId: ctx.userId,
        batchId: input.batchId,
        operationId: input.operationId,
        targets: input.targets,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),

  /**
   * Active Web approval bridge. Source ids only locate the durable runtime
   * rows; Cloud re-resolves their operation, sealed batch, membership,
   * revisions and conversation ACL before using the same atomic claim as
   * Review. OSS returns unavailable so its existing message-row path remains
   * the compatibility fallback.
   */
  resolveAgentInterventionBySource: aiAgentWriteProcedure
    .input(ResolveAgentInterventionBySourceSchema)
    .mutation(async ({ input, ctx }) => {
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: input.targets.map(({ toolMessageId }) => toolMessageId),
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      const resolution = await resolveAgentInterventionBySource({
        action: input.action,
        actorUserId: ctx.userId,
        batchId: input.batchId,
        operationId: input.operationId,
        resolutionRequestId: input.resolutionRequestId,
        targets: input.targets,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      if (!resolution.handled) {
        return {
          contractVersion: 2 as const,
          status: 'unavailable' as const,
          success: false as const,
        };
      }
      if (resolution.state === 'already_resolved') {
        return {
          contractVersion: 2 as const,
          ...(resolution.conversationUrl && { conversationUrl: resolution.conversationUrl }),
          state: resolution.state,
          status: resolution.status,
          success: true as const,
        };
      }

      const dispatch = await dispatchClaimedAgentIntervention(resolution, ctx);
      return {
        contractVersion: 2 as const,
        ...(resolution.conversationUrl && { conversationUrl: resolution.conversationUrl }),
        ...(dispatch.execution && { execution: dispatch.execution }),
        state: resolution.state,
        status: dispatch.status,
        success: true as const,
      };
    }),

  /**
   * Resolve one v2 review through the durable first-winner claim. The client
   * supplies only review/item ids plus revisions; the business slot derives
   * every runtime authority (operation, tool call, message, canonical tool
   * key) after ACL + batch membership checks.
   */
  resolveAgentIntervention: aiAgentWriteProcedure
    .input(ResolveAgentInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const resolution = await resolveAgentIntervention({
        action: input.action,
        expectedBatchVersion: input.expectedBatchVersion,
        expectedRequestRevisions: input.expectedRequestRevisions,
        resolutionRequestId: input.resolutionRequestId,
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      if (!resolution.handled) {
        return {
          contractVersion: 2 as const,
          status: 'unavailable' as const,
          success: false as const,
        };
      }
      if (resolution.state === 'already_resolved') {
        return {
          contractVersion: 2 as const,
          conversationUrl: resolution.conversationUrl,
          status: resolution.status,
          success: true as const,
        };
      }

      const { status: publishedStatus } = await dispatchClaimedAgentIntervention(resolution, ctx);

      return {
        contractVersion: 2 as const,
        conversationUrl: resolution.conversationUrl,
        status: publishedStatus,
        success: true as const,
      };
    }),

  /**
   * Authenticated cold-start review lookup. The opaque token is the only
   * client-supplied locator; Cloud resolves operation/tool ownership inside
   * the business slot. Keep this read-only operation on the mutation transport
   * so the review token is carried in the POST body instead of a query URL that
   * infrastructure access logs commonly retain. OSS reports `unavailable`
   * without exposing internals.
   */
  getHeteroInterventionReview: aiAgentBaseProcedure
    .input(HeteroInterventionReviewTokenSchema)
    .mutation(({ input, ctx }) =>
      getHeteroInterventionReview({
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
    ),

  /** Token-only atomic resolution path used by Mobile review/deep links. */
  resolveHeteroIntervention: aiAgentWriteProcedure
    .input(ResolveHeteroInterventionReviewSchema)
    .mutation(async ({ input, ctx }) => {
      const resolution = await resolveHeteroIntervention({
        action: input.action,
        cancelReason: input.action === 'skip' ? 'user_cancelled' : undefined,
        result: input.action === 'submit' ? input.result : undefined,
        resolutionRequestId: input.resolutionRequestId,
        target: { reviewToken: input.reviewToken },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      if (!resolution.handled) return { status: 'unavailable' as const, success: false as const };
      if (resolution.state === 'already_resolved') {
        return { status: resolution.status, success: true as const };
      }

      return publishClaimedHeteroIntervention({
        claim: resolution,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),

  /**
   * Browser leg of remote Human-in-the-loop (user auth). Publishes the user's
   * answer to an `agent_intervention_request` back onto the op's Redis stream
   * as an `agent_intervention_response`. Two consumers converge on it by
   * `toolCallId`: the renderer (card → resolved) and the exec long-poll
   * (`waitInterventionResponse` → `bridge.resolve`). Symmetric with the
   * desktop path, which resolves the bridge over Electron IPC instead.
   */
  submitHeteroIntervention: aiAgentWriteProcedure
    .input(SubmitHeteroInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        operationId,
        toolCallId,
        stepIndex,
        result,
        cancelled,
        resolutionRequestId = randomUUID(),
      } = input;

      log(
        'submitHeteroIntervention: op=%s toolCallId=%s cancelled=%s',
        operationId,
        toolCallId,
        cancelled ?? false,
      );

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Cloud overrides this as an atomic first-winner claim shared by Web and
      // Mobile. OSS returns `handled:false` and preserves the legacy stream
      // publish below. A claimed response is authoritative: client-supplied
      // operation/tool fields cannot override what Cloud resolved durably.
      const businessResolution = await resolveHeteroIntervention({
        action: cancelled ? 'skip' : 'submit',
        cancelReason: cancelled ? 'user_cancelled' : undefined,
        result: cancelled ? undefined : result,
        resolutionRequestId,
        target: { operationId, toolCallId },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (businessResolution.handled) {
        if (businessResolution.state === 'already_resolved') {
          return { status: businessResolution.status, success: true as const };
        }
        return publishClaimedHeteroIntervention({
          claim: businessResolution,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      const streamEventManager = createStreamEventManager();
      await streamEventManager.publishStreamEvent(operationId, {
        data: {
          // Client-driven cancellation cannot impersonate producer timeout or
          // session teardown; those terminal reasons originate from bridge ACKs.
          cancelReason: cancelled ? 'user_cancelled' : undefined,
          cancelled,
          producerAck: false,
          result: cancelled ? undefined : result,
          resolutionRequestId,
          toolCallId,
        },
        stepIndex,
        type: 'agent_intervention_response',
      });

      return { status: 'resolving' as const, success: true as const };
    }),

  processHumanIntervention: aiAgentWriteProcedure
    .input(ProcessHumanInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, action, data, reason, stepIndex, toolMessageId } = input;

      log(`Processing ${action} for operation ${operationId}`);

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Build intervention parameters
      const interventionParams: any = {
        action,
        operationId,
        stepIndex,
        toolMessageId,
      };

      switch (action) {
        case 'approve': {
          if (!data?.approvedToolCall) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'approvedToolCall is required for approve action',
            });
          }
          interventionParams.approvedToolCall = data.approvedToolCall;
          // toolMessageId is required for the server to persist the
          // intervention + short-circuit into call_tool; the handler itself
          // no-ops when missing, so keep the schema permissive for legacy
          // callers that haven't been updated yet.
          break;
        }
        case 'reject':
        case 'reject_continue': {
          interventionParams.rejectionReason = reason || 'Tool call rejected by user';
          interventionParams.rejectAndContinue = action === 'reject_continue';
          break;
        }
        case 'input': {
          if (!data?.input) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'input is required for input action',
            });
          }
          interventionParams.humanInput = { response: data.input };
          break;
        }
        case 'select': {
          if (!data?.selection) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'selection is required for select action',
            });
          }
          interventionParams.humanInput = { selection: data.selection };
          break;
        }
      }

      // Process human intervention using AgentRuntimeService
      const result = await ctx.agentRuntimeService.processHumanIntervention(interventionParams);

      return {
        action,
        message: `Human intervention processed successfully. Execution resumed.`,
        operationId,
        scheduledMessageId: result.messageId,
        success: true,
        timestamp: new Date().toISOString(),
      };
    }),

  startExecution: aiAgentWriteProcedure
    .input(StartExecutionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, context, priority, delay } = input;

      log('Starting execution for operation %s', operationId);

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Start execution using AgentRuntimeService
      const result = await ctx.agentRuntimeService.startExecution({
        context,
        delay,
        operationId,
        priority,
      });

      return {
        ...result,
        message: 'Agent execution started successfully',
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * Update Thread status after client-side task execution completes
   *
   * This endpoint is called by desktop client after task execution finishes.
   * It updates the Thread status and metadata similar to server-side completion.
   */
  updateClientTaskThreadStatus: aiAgentWriteProcedure
    .input(UpdateClientTaskThreadStatusSchema)
    .mutation(async ({ input, ctx }) => {
      const { threadId, completionReason, error, resultContent, metadata } = input;

      log('updateClientTaskThreadStatus: threadId=%s, reason=%s', threadId, completionReason);

      try {
        // Find thread
        const thread = await ctx.threadModel.findById(threadId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Thread not found',
          });
        }

        const completedAt = new Date().toISOString();
        const startedAt = thread.metadata?.startedAt;
        const duration = startedAt ? Date.now() - new Date(startedAt).getTime() : undefined;

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (completionReason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Update Thread metadata and status
        await ctx.threadModel.update(threadId, {
          metadata: {
            ...thread.metadata,
            completedAt,
            duration,
            error: error || undefined,
            totalCost: metadata?.totalCost,
            totalMessages: metadata?.totalMessages,
            totalSteps: metadata?.totalSteps,
            totalTokens: metadata?.totalTokens,
            totalToolCalls: metadata?.totalToolCalls,
          },
          status,
        });

        // Update task message (sourceMessageId) with result content if provided
        if (resultContent && thread.sourceMessageId) {
          await ctx.messageModel.update(thread.sourceMessageId, {
            content: resultContent,
          });
          log(
            'updateClientTaskThreadStatus: updated task message %s with result',
            thread.sourceMessageId,
          );
        }

        log('updateClientTaskThreadStatus: thread %s completed with status %s', threadId, status);

        return {
          status,
          success: true,
          threadId,
        };
      } catch (error: any) {
        log('updateClientTaskThreadStatus failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update client task thread status: ${error.message}`,
        });
      }
    }),

  /**
   * Refresh Gateway JWT token for an existing operation.
   * Used when reconnecting after page reload (original token expired).
   */
  refreshGatewayToken: aiAgentProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify the topic belongs to this user and has a running operation
      const topic = await ctx.topicModel.findById(input.topicId);

      if (!topic?.metadata?.runningOperation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
});
