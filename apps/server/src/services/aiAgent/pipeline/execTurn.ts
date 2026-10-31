import type { SandboxStorageClaim } from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentSenderMetadata, ExecAgentResult, UserInterventionConfig } from '@lobechat/types';
import { agentShareFileAccessScope, ordinaryFileAccessScope } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import type { AgentModel } from '@/database/models/agent';
import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { ConnectorModel } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { MessageModel } from '@/database/models/message';
import type { PluginModel } from '@/database/models/plugin';
import type { TopicModel } from '@/database/models/topic';
import type { AgentConfigWithId } from '@/server/services/agent';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import type { ComposioService } from '@/server/services/composio';
import { DocumentService } from '@/server/services/document';
import type { MarketService } from '@/server/services/market';

import { createRunFacts, type RunFacts } from '../runFacts';
import { applyShareGateToAgentConfig } from '../shareGate';
import { assertAgentRelayHop } from '../sourceAttribution';
import type { ExecRunContext, InternalExecAgentParams } from '../types';
import type { ApprovalClaimState } from './approvalResume';
import { claimApprovalResume, tryReuseInterventionContinuation } from './approvalResume';
import { dispatchHeteroAgent } from './heteroDispatch';
import { buildOperationInitRequest, runOperationInit } from './operationInit';
import { createHistoryMessagesLoader } from './operationPrep';
import { resolveRunAgentConfig } from './resolveRunAgentConfig';
import { loadResumeParentMessage } from './resumeParent';
import { resolveRunSettings } from './runSettings';
import { traceSendStage } from './sendTracing';
import { startOperation } from './startOperation';
import { bindTopicWorkingDirectory } from './topicWorkingDirectory';
import { setupTurn } from './turnSetup';

const log = debug('lobe-server:ai-agent-service');

/**
 * Everything one {@link execAgentTurn} reads from its owning `AiAgentService`:
 * the user/workspace-scoped models and services, plus the service methods the
 * turn calls back into.
 */
export interface ExecAgentTurnDeps {
  agentDocumentsService: AgentDocumentsService;
  agentModel: AgentModel;
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  composioService: ComposioService;
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
  db: LobeChatDatabase;
  getMarketService: (
    runFacts?: RunFacts,
    options?: { sandboxStorage: SandboxStorageClaim },
  ) => Promise<MarketService>;
  messageModel: MessageModel;
  pluginModel: PluginModel;
  resolveAgentConfigOrThrow: (identifier: string) => Promise<AgentConfigWithId>;
  resolveDeviceWorkspaceId: (deviceId: string | undefined) => Promise<string | undefined>;
  resolveOperationTaskId: (idOrIdentifier?: string | null) => Promise<string | undefined>;
  resolveSourceAgentSnapshot: (
    destinationAgentId: string,
    sourceOperationId?: string,
  ) => Promise<AgentSenderMetadata | undefined>;
  retirePendingApprovalOperation: (operationId: string) => Promise<void>;
  topicModel: TopicModel;
  userId: string;
  withholdGatewayToken: boolean;
  workspaceId?: string;
}

/**
 * Run one agent turn once the topic-start reservation (if any) is held: resolve
 * the run's agent config, claim a resumed human decision, set up the turn rows,
 * then either dispatch a heterogeneous agent or initialise and start the
 * operation on the agent runtime.
 */
export const execAgentTurn = async (
  deps: ExecAgentTurnDeps,
  params: InternalExecAgentParams,
  approvalClaim: ApprovalClaimState,
): Promise<ExecAgentResult> => {
  const {
    additionalPluginIds,
    exclusivePluginIds,
    agentId,
    slug,
    prompt,
    appContext,
    autoStart = true,
    botContext,
    botSender,
    createdThreadId,
    externalOrigin,
    clientIp,
    userAgent,
    deviceId: requestedDeviceId,
    requireDevice,
    localDeviceId,
    botPlatformContext,
    discordContext,
    existingMessageIds = [],
    fileIds: attachedFileIds,
    files,
    functionTools,
    hooks,
    instructions,
    chatConfigOverride,
    toolModeOverride,
    model: modelOverride,
    provider: providerOverride,
    stream,
    title,
    steer,
    trigger,
    cronJobId,
    taskId,
    evalContext,
    evalRuntime,
    maxSteps,
    disableLocalSystem,
    initialLlmCalls,
    initialStepCount,
    signal,
    userInterventionConfig: requestedUserInterventionConfig = { approvalMode: 'headless' },
    userMessage,
    queueRetries,
    queueRetryDelay,
    parentMessageId,
    parentOperationId,
    resume,
    resumeApproval,
    resumeApprovals,
    resumeToolResult,
    approvalResolutionRequestId: providedApprovalResolutionRequestId,
    approvalSourceOperationId: providedApprovalSourceOperationId,
    selectedSkillIds,
    selectedToolIds,
    shareGate,
    mentionedAgents,
    suppressUserMessage,
    ephemeralUserMessage,
  } = params;

  // Agent Share visitor runs execute under the CREATOR's credentials but are
  // approved by the VISITOR: granting a tool grants its normal approval
  // flow, so the run honors the visitor's own approval mode (sent by the
  // share client, see `shareChat.execAgent`) and parks intervention-gated
  // calls for the visitor to resolve on the share page.
  //
  // A share caller that sends no config falls back to `manual`, never to
  // this method's `headless` default: `headless` auto-runs `'required'`
  // calls, which would grant a consent nobody gave.
  const userInterventionConfig: UserInterventionConfig = shareGate
    ? (params.userInterventionConfig ?? { approvalMode: 'manual' })
    : requestedUserInterventionConfig;

  // Honour client-minted row ids on a FRESH send only. Resume / regeneration
  // replays reach this method too (resumeApproval, resumeToolResult,
  // parentMessageId), and a replayed id there would collide with the row the
  // original send already created — so those paths drop the ids defensively
  // rather than trusting every caller to omit them.
  const interventionResumeCount = [resumeApproval, resumeApprovals, resumeToolResult].filter(
    Boolean,
  ).length;
  if (interventionResumeCount > 1) {
    throw new Error(
      'Only one of resumeApproval, resumeApprovals, or resumeToolResult may be provided',
    );
  }

  const isResumeLike =
    !!resume ||
    !!resumeApproval ||
    !!resumeApprovals?.length ||
    !!resumeToolResult ||
    !!parentMessageId;
  const clientIds = isResumeLike ? undefined : params.clientIds;

  // Validate that either agentId or slug is provided
  if (!agentId && !slug) {
    throw new Error('Either agentId or slug must be provided');
  }

  // Determine the identifier to use (agentId takes precedence)
  const identifier = agentId || slug!;

  if (params.reservedOperationId) {
    const reserved = await deps.agentOperationModel.findById(params.reservedOperationId);
    if (
      !reserved ||
      reserved.status !== 'idle' ||
      reserved.agentId !== agentId ||
      reserved.topicId !== appContext?.topicId ||
      reserved.userId !== deps.userId ||
      (reserved.workspaceId ?? undefined) !== deps.workspaceId
    )
      throw new Error('The reserved operation does not match this execution');
  }

  log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

  const operationTaskId = await deps.resolveOperationTaskId(taskId ?? appContext?.taskId);

  const assistantMessageRef: { current?: string } = {};
  const updateAbortedAssistantMessage = async (errorMessage: string) => {
    if (!assistantMessageRef.current) return;

    try {
      await deps.messageModel.update(assistantMessageRef.current, {
        content: '',
        error: {
          body: {
            detail: errorMessage,
          },
          message: errorMessage,
          type: 'ServerAgentRuntimeError',
        },
      });
    } catch (error) {
      log(
        'execAgent: failed to update aborted assistant message %s: %O',
        assistantMessageRef.current,
        error,
      );
    }
  };
  const throwIfExecutionAborted = async (stage: string) => {
    if (!signal?.aborted) return;

    const error = getAbortError(signal, `Agent execution aborted during ${stage}`);
    await updateAbortedAssistantMessage(error.message);
    throw error;
  };

  throwIfAborted(signal, 'Agent execution aborted before startup');

  // Stages 1–2.5 — resolve the effective agent config for this run
  // (see `pipeline/resolveRunAgentConfig`).
  const {
    agentConfig,
    agentSlug,
    assistantAgentId,
    canManageAgent,
    conversationAgentId,
    disabledPluginIds,
    isPublicWorkspaceAgent,
    memberDeviceOverride,
    persistAgentId,
    resolvedAgentId,
  } = await traceSendStage('agent_config', () =>
    resolveRunAgentConfig(
      {
        db: deps.db,
        resolveAgentConfigOrThrow: deps.resolveAgentConfigOrThrow,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      },
      {
        appContext,
        chatConfigOverride,
        agentConfigSnapshot: params.agentConfigSnapshot,
        identifier,
        instructions,
        modelOverride,
        providerOverride,
        shareVisitorUserId: shareGate?.visitorUserId,
        throwIfExecutionAborted,
        toolModeOverride,
      },
    ),
  );

  // Share-visitor runs must never see the creator's files/knowledge bases.
  // Applied to the resolved config before anything downstream (knowledge
  // flags, tools engine, context snapshot) reads it.
  if (shareGate) applyShareGateToAgentConfig(agentConfig);

  let resumeParentMessage: Awaited<ReturnType<MessageModel['findById']>>;

  // `resumeApproval` implies the same "load parent message + skip user
  // message creation" semantics as `resume`. Callers that go through the
  // tRPC router get `resume: true` via the router, but the service-level
  // API allows resumeApproval alone — fold both into a single effective
  // flag so downstream resume branches don't need to know about approval.
  // Normalize the single and batch approval forms into one list so every
  // branch below (validation, DB writes, resume context) has a single shape
  // to reason about. `resumeApproval` stays the wire format for one decision.
  const approvalDecisions = resumeApprovals?.length
    ? resumeApprovals
    : resumeApproval
      ? [resumeApproval]
      : [];

  const effectiveResume = resume || approvalDecisions.length > 0 || !!resumeToolResult;

  // Both resume and suppressUserMessage run the turn off existing history
  // instead of appending a new user message — share the message-construction
  // branches below. Resume-specific validation/approval stays gated on
  // `effectiveResume` only.
  const runFromHistory = effectiveResume || !!suppressUserMessage;

  if (effectiveResume) {
    resumeParentMessage = await loadResumeParentMessage(
      { messageModel: deps.messageModel },
      { appContext, parentMessageId },
    );
  }

  // Stages 2.6–2.7 — claim the human decision(s) before anything below reads
  // message history (see `pipeline/approvalResume`).
  const {
    approvalOwnerAssistantId,
    approvalSourceOperationId,
    approvalSourceToolMessageIds,
    approvedToolEntries,
    batchApprovalAnchorId,
    resumeApprovalPlugin,
    resolvedToolResult,
  } = await traceSendStage('approval_claim', () =>
    claimApprovalResume(
      {
        controlToolResult: (input) => deps.agentRuntimeService.controlCompletedToolResult(input),
        messageModel: deps.messageModel,
      },
      {
        appContext,
        approvalClaim,
        approvalDecisions,
        parentMessageId,
        providedApprovalResolutionRequestId,
        providedApprovalSourceOperationId,
        resumeApprovals,
        resumeParentMessage,
        resumeToolResult,
      },
    ),
  );

  // Deterministic continuation identity for a generic (v2) approval claim.
  // Also consumed by the turn setup below: a crash-safe re-entry must find
  // the SAME assistant placeholder instead of minting a second turn.
  const continuationIdentity = providedApprovalResolutionRequestId
    ? {
        resolutionRequestId: providedApprovalResolutionRequestId,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      }
    : undefined;
  const continuationOperationId = continuationIdentity
    ? deriveAgentInterventionContinuationOperationId(continuationIdentity)
    : undefined;
  const continuationAssistantId = continuationIdentity
    ? deriveAgentInterventionContinuationMessageId(continuationIdentity)
    : undefined;

  const reusedContinuation = await tryReuseInterventionContinuation(
    {
      agentOperationModel: deps.agentOperationModel,
      agentRuntimeService: deps.agentRuntimeService,
      messageModel: deps.messageModel,
      userId: deps.userId,
      withholdGatewayToken: deps.withholdGatewayToken,
      workspaceId: deps.workspaceId,
    },
    {
      approvalClaim,
      approvalSourceOperationId,
      approvalSourceToolMessageIds,
      continuationAssistantId,
      continuationOperationId,
      parentMessageId,
      providedApprovalResolutionRequestId,
      resolvedAgentId,
      topicId: appContext?.topicId,
    },
  );
  if (reusedContinuation) return reusedContinuation;

  // Agent → agent attribution: resolve the launching run's agent into a
  // display snapshot once, before the turn rows exist, so the persisted user
  // message carries a self-contained sender block.
  const agentSender =
    params.agentSender ??
    (await deps.resolveSourceAgentSnapshot(resolvedAgentId, params.sourceOperationId));
  // Two agents told to report back to each other would otherwise wake each
  // other forever; past the bound a person has to step in.
  assertAgentRelayHop(agentSender);

  // Stage 3 + shared turn setup — topic creation/reuse (with the pinned
  // model), device-access policy, hetero detection, attachment ingestion, and
  // the persisted user/assistant rows (see `pipeline/turnSetup`).
  const turn = await traceSendStage('turn_setup', () =>
    setupTurn(
      {
        db: deps.db,
        messageModel: deps.messageModel,
        topicModel: deps.topicModel,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      },
      {
        agentConfig,
        agentSender,
        agentSlug,
        appContext,
        assistantAgentId,
        attachedFileIds,
        batchApprovalAnchorId,
        botContext,
        botSender,
        clientIds,
        continuationAssistantId,
        conversationAgentId,
        createdThreadId,
        externalOrigin,
        cronJobId,
        files,
        modelOverride,
        operationTaskId,
        parentMessageId,
        prompt,
        providerOverride,
        requestedDeviceId,
        requireDevice,
        resolvedAgentId,
        resume,
        runFromHistory,
        selectedSkillIds,
        shareGate,
        steer,
        throwIfExecutionAborted,
        title,
        trigger,
        userMessage,
      },
    ),
  );
  assistantMessageRef.current = turn.assistantMessageId;
  const {
    canUseDevice,
    deviceAccessReason,
    isHeteroAgent,
    model,
    provider,
    requestTriggerMetadata,
    runAttachments,
    selfMessageIds,
    topicId,
  } = turn;

  // Shared context for the extracted execAgent pipeline stages
  // (`pipeline/*`). Built after the turn rows exist so every stage sees the
  // persisted anchors; `agentConfig` stays the same mutable object so stage
  // systemRole appends remain visible to `createOperation` below.
  // One reader for the facts that cannot change within this turn, so the
  // send window asks the routed device and the user's row once each.
  const runFacts = createRunFacts({
    db: deps.db,
    userId: deps.userId,
    workspaceId: deps.workspaceId,
  });

  const runContext: ExecRunContext = {
    agentConfig,
    // Facts the turn resolved (builder target, project) ride on the context so
    // every later stage — and the frozen operation origin — reads one value.
    appContext:
      (turn.editingAgentId && turn.editingAgentId !== appContext?.editingAgentId) ||
      turn.projectId !== appContext?.projectId
        ? {
            ...appContext,
            editingAgentId: turn.editingAgentId ?? appContext?.editingAgentId,
            projectId: turn.projectId,
          }
        : appContext,
    assistantMessageId: turn.assistantMessageId,
    botContext,
    botPlatformContext,
    canUseDevice,
    deviceAccessReason,
    disabledPluginIds,
    discordContext,
    model,
    parentMessageId,
    persistAgentId,
    prompt,
    provider,
    resolvedAgentId,
    runFacts,
    shareGate,
    topicEditingGroupId: turn.topicEditingGroupId,
    topicId,
    trigger,
    userMessageId: turn.userMessageId,
    // Exactly what the user row was persisted with, so every stage reads the
    // message the way a later turn reads it back from history.
    userMessageMetadata: turn.userMessageId ? turn.requestTriggerMetadata : undefined,
  };

  if (isHeteroAgent) {
    return dispatchHeteroAgent(
      {
        bindTopicWorkingDirectory: (p) =>
          bindTopicWorkingDirectory({ topicModel: deps.topicModel }, p),
        db: deps.db,
        getMarketService: (options) => deps.getMarketService(runFacts, options),
        messageModel: deps.messageModel,
        resolveDeviceWorkspaceId: deps.resolveDeviceWorkspaceId,
        topicModel: deps.topicModel,
        userId: deps.userId,
        withholdGatewayToken: deps.withholdGatewayToken,
        workspaceId: deps.workspaceId,
      },
      runContext,
      {
        canManageAgent,
        effectiveRequestedDeviceId: turn.effectiveRequestedDeviceId,
        heteroType: turn.heteroType,
        heterogeneousProvider: turn.heterogeneousProvider,
        hooks,
        isPublicWorkspaceAgent,
        localDeviceId,
        maxSteps,
        memberDeviceOverride,
        operationTaskId,
        onOperationCreated: params.onOperationCreated,
        reservedOperationId: params.reservedOperationId,
        parentOperationId,
        pinnedHeterogeneousTopicModel: turn.pinnedHeterogeneousTopicModel,
        pinnedHeterogeneousTopicSources: turn.pinnedHeterogeneousTopicSources,
        requestTrigger: requestTriggerMetadata.trigger,
        requestedDeviceId: turn.requestedDeviceId,
        runAttachments,
        selfMessageIds,
        topicStartOwnerOperationId: params.topicStartOwnerOperationId,
      },
    );
  }

  // 4. Fetch user settings (memory config + timezone)
  const { enableExpertise, globalMemoryEnabled, userTimezone } = await traceSendStage(
    'run_settings',
    () => resolveRunSettings({ agentConfig, runFacts, shareGate }),
  );
  log(
    'execAgent: globalMemoryEnabled=%s, timezone=%s',
    globalMemoryEnabled,
    userTimezone ?? 'default',
  );

  // History loader shared by tool discovery (media-availability probe) and
  // the operation-prep message assembly (see `pipeline/operationPrep`).
  const loadHistoryMessages = createHistoryMessagesLoader(
    {
      db: deps.db,
      isShareVisitorRun: !!shareGate,
      messageModel: deps.messageModel,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
    {
      appContext,
      effectiveResume,
      existingMessageIds,
      parentMessageId,
      resumeParentMessage,
      selfMessageIds,
    },
  );

  // When the user @-mentions agents (multi-mention, non-group), enable the
  // agent-management tool for this run so the supervisor can `callAgent` to
  // delegate. Mirrors the client runtime, which injects a callAgent manifest.
  // Single-mention takes a client-only deterministic-router path and never
  // reaches here. The delegation *context* (which agents were mentioned) is
  // injected separately via `initialContext.mentionedAgents` below.
  const hasMentionedAgents = !appContext?.groupId && !!mentionedAgents?.length;

  // 15. Generate operation ID: op_{timestamp}_{agentId}_{topicId}_{random}
  const operationId =
    params.reservedOperationId ??
    continuationOperationId ??
    `op_${Date.now()}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

  // Stages 5–18 — the run's init: the tool surface, the message/context
  // assembly, and the human decision a resumed approval turns into the first
  // context. One call so the same work can later run in the step-0 worker
  // instead of on the send path.
  const initRequest = buildOperationInitRequest({
    additionalPluginIds,
    taskId: operationTaskId,
    agentSlug,
    approvalOwnerAssistantId,
    approvedToolEntries,
    attachedFileIds,
    disableLocalSystem,
    disableSelfFeedbackIntentTool: params.disableSelfFeedbackIntentTool,
    disableTools: params.disableTools,
    ephemeralUserMessage,
    evalAllowedTools: evalRuntime?.allowedTools,
    evalMemory: evalRuntime?.memory,
    exclusivePluginIds,
    existingMessageIds,
    files,
    functionTools,
    globalMemoryEnabled,
    hasMentionedAgents,
    isFixedDeviceTarget: turn.isFixedDeviceTarget,
    localDeviceId,
    requireDevice,
    mentionedAgents,
    parentMessageId,
    prompt,
    requestedTopicId: appContext?.topicId ?? undefined,
    requestTrigger: requestTriggerMetadata.trigger,
    requestedDeviceId: turn.requestedDeviceId,
    resumeApproval,
    resumeApprovalPlugin,
    resumeApprovals,
    resume,
    resumeFromHistory: runFromHistory,
    resumeToolResult: resolvedToolResult,
    runAttachments,
    selectedSkillIds,
    selectedToolIds,
    topicBoundDeviceId: turn.topicBoundDeviceId,
    viewedGoal: appContext?.viewedGoal,
  });

  const { discovery, initialContext, prep } = await traceSendStage('operation_init', () =>
    runOperationInit(
      {
        agentDocumentsService: deps.agentDocumentsService,
        agentModel: deps.agentModel,
        bindTopicWorkingDirectory: (p) =>
          bindTopicWorkingDirectory({ topicModel: deps.topicModel }, p),
        composioService: deps.composioService,
        connectorModel: deps.connectorModel,
        connectorToolModel: deps.connectorToolModel,
        db: deps.db,
        getMarketService: () => deps.getMarketService(runFacts),
        loadHistoryMessages,
        messageModel: deps.messageModel,
        pluginModel: deps.pluginModel,
        readFileContent: async (fileId) =>
          (
            await new DocumentService(deps.db, deps.userId, deps.workspaceId).parseFile(
              fileId,
              shareGate ? agentShareFileAccessScope(shareGate) : ordinaryFileAccessScope,
            )
          ).content ?? undefined,
        throwIfExecutionAborted,
        topicModel: deps.topicModel,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      },
      runContext,
      initRequest,
      operationId,
    ),
  );

  // 17. Log final operation parameters summary
  log(
    'execAgent: creating operation %s with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d',
    operationId,
    model,
    provider,
    discovery.tools?.length ?? 0,
    prep.allMessages.length,
    Object.keys(discovery.toolManifestMap).length,
  );

  // Claim the child slot on the supervisor's runningOperation marker LAST,
  // immediately before startup. The marker vanishes when the supervisor is
  // cancelled or settled, so every awaited preparation step above widens the
  // claim→start race window — an orphaned child would start against a
  // marker that no longer lists it. Claiming here keeps the window minimal;
  // a failed claim only wastes the preparation reads (its lone write — the
  // topic cwd pin — is additive and idempotent).
  if (params.topicStartOwnerOperationId) {
    const attached = await deps.topicModel.appendRunningOperationChild(
      topicId,
      params.topicStartOwnerOperationId,
      {
        assistantMessageId: turn.assistantMessageId,
        operationId,
        orchestrationRole: appContext?.orchestrationRole,
        scope: appContext?.scope ?? undefined,
        threadId: appContext?.threadId ?? undefined,
      },
    );
    if (!attached) {
      const errorMessage = 'Group supervisor finished before this member could start.';
      await updateAbortedAssistantMessage(errorMessage);
      return {
        agentId: resolvedAgentId,
        assistantMessageId: turn.assistantMessageId,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: errorMessage,
        message: errorMessage,
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: turn.userMessageId ?? parentMessageId ?? '',
      };
    }
  }

  // 19. Create the operation via AgentRuntimeService, persist the reconnect
  // marker, and mint the gateway token (see `pipeline/startOperation`).
  return traceSendStage('start_operation', () =>
    startOperation(
      {
        agentRuntimeService: deps.agentRuntimeService,
        messageModel: deps.messageModel,
        retirePendingApprovalOperation: deps.retirePendingApprovalOperation,
        topicModel: deps.topicModel,
        userId: deps.userId,
        withholdGatewayToken: deps.withholdGatewayToken,
        workspaceId: deps.workspaceId,
      },
      runContext,
      {
        acceptsFileWorks: params.acceptsFileWorks,
        acceptsMemberRuntimeEnd: params.acceptsMemberRuntimeEnd,
        approvalClaim,
        approvalSourceOperationId,
        approvalSourceToolMessageIds,
        autoStart,
        onOperationCreated: params.onOperationCreated,
        botContext,
        botPlatformContext,
        clientIp,
        disabledPluginIds,
        discordContext,
        discovery,
        enableExpertise,
        evalContext,
        evalRuntime,
        hooks,
        initialContext,
        initialLlmCalls,
        initialStepCount,
        maxSteps,
        operationId,
        operationTaskId,
        parentOperationId,
        prep,
        providedApprovalResolutionRequestId,
        queueRetries,
        queueRetryDelay,
        reservedOperation: !!params.reservedOperationId,
        signal,
        stream,
        clientProtocol: params.clientProtocol,
        includeFinalState: params.includeFinalState,
        llmExecutor: params.llmExecutor,
        topicStartOwnerOperationId: params.topicStartOwnerOperationId,
        updateAbortedAssistantMessage,
        userAgent,
        userInterventionConfig,
        userTimezone,
      },
    ),
  );
};
