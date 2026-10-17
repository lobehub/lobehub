import { selectUserInterventionConfig } from '@lobechat/agent-runtime';
import type { ExecAgentResult, UserInterventionConfig, UserToolConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import {
  type AgentInterventionReviewStatus,
  type AgentInterventionRuntimeAction,
  onAgentInterventionResolutionPublished,
  type ResolveAgentInterventionResult,
  rollbackAgentInterventionResolution,
} from '@/business/server/agent-run/agentInterventionReview';
import { executeAgentMarketplaceIntervention } from '@/business/server/agent-run/executeCustomIntervention';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import type { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';

const log = debug('lobe-server:ai-agent-router');

type ClaimedAgentInterventionResolution = Extract<
  ResolveAgentInterventionResult,
  { state: 'claimed' }
>;

export interface AgentInterventionDispatchContext {
  /**
   * Creator-scoped service for a share run, caller-scoped otherwise. The
   * continuation always executes as the run owner.
   */
  aiAgentService: AiAgentService;
  serverDB: LobeChatDatabase;
  /**
   * Present when a share VISITOR resolved an intervention on their own share
   * run (`shareChat.resolveInterventionBySource`). Rebuilt from the live share row by
   * the caller — never from the parked run's state — so the continuation is
   * gated by the share's CURRENT config exactly like a fresh visitor turn.
   */
  shareGate?: AgentShareGate;
  /** The resolving actor: the owner/member, or the share visitor. */
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

  const stateProvenance = state.origin?.continuation as typeof provenance | undefined;
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
    state.origin?.userId === resolution.ownerUserId &&
    sameNullable(
      state.origin?.workspaceId,
      resolution.workspaceId ?? ctx.workspaceId ?? undefined,
    ) &&
    state.origin?.agentId === continuation.agentId &&
    state.origin?.topicId === continuation.appContext.topicId &&
    sameNullable(state.origin?.threadId, continuation.appContext.threadId) &&
    sameNullable(state.origin?.taskId, continuation.appContext.taskId) &&
    sameNullable(state.origin?.groupId, continuation.appContext.groupId) &&
    sameNullable(state.origin?.documentId, continuation.appContext.documentId) &&
    sameNullable(state.origin?.scope, continuation.appContext.scope) &&
    sameNullable(state.origin?.sessionId, continuation.appContext.sessionId) &&
    state.origin?.sourceMessageId === continuation.parentMessageId &&
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
 * The approval mode a continuation runs under. A continuation carries on the
 * run the user just answered, so it inherits that run's intervention policy —
 * otherwise `execAgent` falls back to `headless` and the next question or
 * approval in the continuation is blocked instead of waiting for the user.
 *
 * When the parked run's state has already expired, fall back to the owner's
 * foreground approval preference: only a run that could wait for a human can
 * park on an intervention, so the answered run was never headless.
 *
 * The owner's persisted allow list is merged in either way: an "Approve, and
 * don't ask again" answer writes the tool key there before this dispatch, and
 * the snapshot in the parked run predates it.
 *
 * A share visitor's continuation uses neither owner fallback: the parked run
 * carries the VISITOR's approval mode, a visitor can never "remember" into
 * the owner's allow list, and the owner's own preferences must not decide
 * what runs unattended in someone else's conversation.
 */
const resolveContinuationUserInterventionConfig = async (
  resolution: ClaimedAgentInterventionResolution,
  sourceOperationId: string,
  ctx: AgentInterventionDispatchContext,
): Promise<UserInterventionConfig> => {
  const [sourceState, settings] = await Promise.all([
    ctx.aiAgentService.loadInterventionContinuationState(sourceOperationId).catch((error) => {
      log('failed to load source state for %s: %O', sourceOperationId, error);
      return null;
    }),
    new UserModel(ctx.serverDB, resolution.ownerUserId).getUserSettings().catch((error) => {
      log('failed to load intervention settings for %s: %O', resolution.ownerUserId, error);
      return undefined;
    }),
  ]);
  const intervention = (settings?.tool as UserToolConfig | undefined)?.humanIntervention;
  const persistedAllowList = intervention?.allowList ?? [];

  const inherited = sourceState ? selectUserInterventionConfig(sourceState) : undefined;
  if (ctx.shareGate) return inherited ?? { approvalMode: 'manual' };
  if (inherited) {
    const inheritedAllowList = inherited.allowList ?? [];
    const remembered = persistedAllowList.filter((key) => !inheritedAllowList.includes(key));
    if (remembered.length === 0) return inherited;
    return { ...inherited, allowList: [...inheritedAllowList, ...remembered] };
  }

  const approvalMode =
    intervention?.approvalMode === 'headless'
      ? 'auto-run'
      : (intervention?.approvalMode ?? 'manual');

  return { allowList: persistedAllowList, approvalMode };
};

/**
 * One dispatch boundary shared by token Review and the active Web source
 * bridge. Both paths arrive here only after Cloud has won the same durable
 * first-winner claim.
 */
export const dispatchClaimedAgentIntervention = async (
  resolution: ClaimedAgentInterventionResolution,
  ctx: AgentInterventionDispatchContext,
  /**
   * `acceptsMemberRuntimeEnd`: the resolving client's own declaration when that
   * client is the one subscribing to the continuation (the Web source bridge).
   * Left unset for a resolver that isn't (token Review), so the continuation
   * inherits the parked operation's declaration. `acceptsFileWorks` follows
   * the same rule.
   */
  options: { acceptsFileWorks?: boolean; acceptsMemberRuntimeEnd?: boolean } = {},
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
      /**
       * A continuation is a fresh operation started by the user resolving an
       * intervention, and the durable app context does not carry the parked
       * run's trigger. Without an explicit trigger every LLM call in the
       * continuation lands in route attempt logs with an unknown source.
       */
      const continuationTrigger = ctx.shareGate ? RequestTrigger.AgentShare : RequestTrigger.Chat;
      const continuation = continuationRuntimeAction(runtimeAction);
      const userInterventionConfig = continuation
        ? await resolveContinuationUserInterventionConfig(resolution, continuation.operationId, ctx)
        : undefined;

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
              acceptsFileWorks: options.acceptsFileWorks,
              acceptsMemberRuntimeEnd: options.acceptsMemberRuntimeEnd,
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
              shareGate: ctx.shareGate,
              topicStartReservationId: deterministicContinuationOperationId,
              trigger: continuationTrigger,
              userInterventionConfig,
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
            acceptsFileWorks: options.acceptsFileWorks,
            acceptsMemberRuntimeEnd: options.acceptsMemberRuntimeEnd,
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
            shareGate: ctx.shareGate,
            topicStartReservationId: deterministicContinuationOperationId,
            trigger: continuationTrigger,
            userInterventionConfig,
          });
          break;
        }
        case 'resume_tool_result': {
          execution = await ctx.aiAgentService.execAgent({
            agentId: runtimeAction.agentId,
            acceptsFileWorks: options.acceptsFileWorks,
            acceptsMemberRuntimeEnd: options.acceptsMemberRuntimeEnd,
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
            shareGate: ctx.shareGate,
            topicStartReservationId: deterministicContinuationOperationId,
            trigger: continuationTrigger,
            userInterventionConfig,
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
