import type { ExecAgentResult } from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { isAbortError } from '@/server/services/agentRuntime/abort';

import type { ExecRunContext, InternalExecAgentParams } from '../types';
import type { ApprovalClaimState } from './approvalResume';
import type { OperationPrepResult } from './operationPrep';
import type { ToolDiscoveryResult } from './toolDiscovery';

const log = debug('lobe-server:ai-agent-service');

export interface StartOperationDeps {
  agentRuntimeService: AgentRuntimeService;
  messageModel: MessageModel;
  retirePendingApprovalOperation: (operationId: string) => Promise<void>;
  topicModel: TopicModel;
  userId: string;
  withholdGatewayToken: boolean;
  workspaceId?: string;
}

export interface StartOperationInput {
  approvalClaim: ApprovalClaimState;
  approvalSourceOperationId?: string;
  approvalSourceToolMessageIds: string[];
  autoStart: boolean;
  botContext?: InternalExecAgentParams['botContext'];
  botPlatformContext?: InternalExecAgentParams['botPlatformContext'];
  clientIp?: string;
  discordContext?: any;
  discovery: ToolDiscoveryResult;
  enableExpertise: boolean;
  evalContext?: InternalExecAgentParams['evalContext'];
  evalRuntime?: InternalExecAgentParams['evalRuntime'];
  hooks?: InternalExecAgentParams['hooks'];
  /** Final runtime context — base prep context with 16b/16c overrides applied. */
  initialContext: OperationPrepResult['initialContext'];
  initialStepCount?: number;
  maxSteps?: number;
  operationId: string;
  operationTaskId?: string;
  parentOperationId?: string;
  prep: OperationPrepResult;
  providedApprovalResolutionRequestId?: string;
  queueRetries?: number;
  queueRetryDelay?: string;
  signal?: AbortSignal;
  stream?: boolean;
  topicStartOwnerOperationId?: string;
  updateAbortedAssistantMessage: (errorMessage: string) => Promise<void>;
  userAgent?: string;
  userInterventionConfig: InternalExecAgentParams['userInterventionConfig'];
  userTimezone?: string;
}

/**
 * Stage 19 of {@link AiAgentService.execAgent}: create the operation via
 * AgentRuntimeService, retire a legacy parked approval operation, persist the
 * topic's `runningOperation` reconnect marker, and mint the gateway token.
 *
 * Wrapped in try-catch to handle operation startup failures (e.g., QStash
 * unavailable): the persisted user/assistant rows stay valid, the assistant
 * bubble receives the startup error, and the caller gets `success: false`.
 */
export const startOperation = async (
  deps: StartOperationDeps,
  ctx: ExecRunContext,
  input: StartOperationInput,
): Promise<ExecAgentResult> => {
  const {
    agentConfig,
    appContext,
    assistantMessageId,
    canUseDevice,
    deviceAccessReason,
    model,
    parentMessageId,
    provider,
    resolvedAgentId,
    shareGate,
    topicId,
    trigger,
    userMessageId,
  } = ctx;
  const {
    approvalClaim,
    approvalSourceOperationId,
    approvalSourceToolMessageIds,
    autoStart,
    botContext,
    botPlatformContext,
    clientIp,
    discordContext,
    discovery,
    enableExpertise,
    evalContext,
    evalRuntime,
    hooks,
    initialContext,
    initialStepCount,
    maxSteps,
    operationId,
    operationTaskId,
    parentOperationId,
    prep,
    providedApprovalResolutionRequestId,
    queueRetries,
    queueRetryDelay,
    signal,
    stream,
    topicStartOwnerOperationId,
    updateAbortedAssistantMessage,
    userAgent,
    userInterventionConfig,
    userTimezone,
  } = input;

  log(
    'execAgent: creating operation %s — agentDocuments=%d, knowledgeBases=%s, tools=%d, skills=%d',
    operationId,
    discovery.hasAgentDocuments ? 'yes' : 0,
    discovery.hasEnabledKnowledgeBases,
    discovery.tools?.length ?? 0,
    prep.operationSkillSet?.skills?.length ?? 0,
  );

  // Wrap in try-catch to handle operation startup failures (e.g., QStash unavailable)
  // If createOperation fails, we still have valid messages that need error info
  try {
    const result = await deps.agentRuntimeService.createOperation({
      activeDeviceId: discovery.activeDeviceId,
      activeDeviceScope: discovery.activeDeviceScope,
      agentConfig,
      agentGroup: discovery.operationAgentGroup,
      agentShareVisitor: shareGate
        ? {
            agentId: shareGate.agentId,
            // Mirrors `shareConfig.allowReadMemory` so `BuiltinToolsExecutor`
            // can re-check the memory tool's grant at dispatch time (the
            // actual chokepoint) via `isShareBlockedDataToolCall` — see
            // `shareGate.ts`.
            allowReadMemory: shareGate.shareConfig.allowReadMemory,
            // Mirrors `shareConfig.toolGrants` so tool runtimes resolved
            // outside `toolManifestMap` (e.g. `activateSkill`, which queries
            // builtin/DB skills by name) can enforce the same allowlist.
            toolGrants: shareGate.shareConfig.toolGrants,
            // Sourced from the agent's OWN persisted assignment
            // (`agentConfig.knowledgeBases`, already blanked by
            // `applyShareGateToAgentConfig` in `execAgent`), never from visitor
            // input. Lets `isShareBlockedDataToolCall` scope
            // `lobe-knowledge-base.viewKnowledgeBase`'s `id` argument to
            // knowledge bases actually mounted on this agent.
            knowledgeBaseIds: (agentConfig.knowledgeBases ?? [])
              .filter((kb: { enabled?: boolean | null; id?: string | null }) => kb.enabled && kb.id)
              .map((kb: { id?: string | null }) => kb.id as string),
            // The share instance this run was authorized against. Re-read (not
            // reused) at every step boundary by
            // `AgentRuntimeService.executeStep` via
            // `AgentShareModel.isRunStillAuthorized`, so a revocation
            // committed mid-run is caught at the next step instead of only at
            // creation time. See `AgentShareGate.shareId`'s JSDoc for why the
            // id itself is the revocation token.
            shareId: shareGate.shareId,
            showErrorDetails: shareGate.shareConfig.showErrorDetails,
            showModelInfo: shareGate.shareConfig.showModelInfo,
            visitorUserId: shareGate.visitorUserId,
          }
        : undefined,
      deviceSystemInfo:
        Object.keys(prep.deviceSystemInfo).length > 0 ? prep.deviceSystemInfo : undefined,
      executionPlan: discovery.executionPlan,
      searchDecision: discovery.searchDecision,
      userTimezone,
      appContext: {
        // Background self-iteration runs execute under a builtin slug (so they
        // inherit the builtin agent's tools / systemRole / model), but their
        // resource tools and receipts must attribute to the *reviewed* user
        // agent, which rides on the marker. Prefer it so the tool-execution
        // context (state.metadata.agentId) targets the reviewed agent; ordinary
        // runs (no marker) fall back to the resolved executing agent.
        agentId: appContext?.agentSignal?.agentId ?? resolvedAgentId,
        // Propagate the originating request's client IP / user agent into
        // state.metadata (via the `...appContext` spread in createOperation) so
        // downstream LLM-call metadata can carry them for auditing and spend
        // attribution.
        clientIp,
        userAgent,
        // When scope === 'agent_builder', agentId stays as the builder builtin so
        // message ownership and queryUiMessages remain correct. editingAgentId
        // carries the actual editing target separately; only the AgentBuilder server
        // runtime reads it, keeping the rest of the pipeline unaffected.
        ...(appContext?.scope === 'agent_builder' && appContext?.editingAgentId
          ? { editingAgentId: appContext.editingAgentId }
          : {}),
        // Mirror of the above for the Group Agent Builder panel: the run is
        // owned by the builtin builder agent, so the edited group only rides
        // here. Read by the group-agent-builder server runtime and by the
        // `<current_group_context>` injector.
        ...(appContext?.scope === 'group_agent_builder' && appContext?.editingGroupId
          ? { editingGroupId: appContext.editingGroupId }
          : {}),
        // Run-scoped Agent Signal marker for background self-iteration / memory
        // runs — lands in state.metadata.agentSignal so the completion path can
        // project receipts/briefs. Undefined for ordinary chat runs.
        ...(appContext?.agentSignal ? { agentSignal: appContext.agentSignal } : {}),
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId,
        groupId: appContext?.groupId,
        isSubAgent: appContext?.isSubAgent,
        // Persist the orchestration role on state.metadata so the
        // inactivity-watchdog abandon path can distinguish an isolated group
        // member ('member') from a genuine callSubAgent child.
        orchestrationRole: appContext?.orchestrationRole,
        scope: appContext?.scope,
        sessionId: appContext?.sessionId,
        sourceMessageId: userMessageId ?? parentMessageId ?? undefined,
        // Live-progress anchor for a callSubAgent child — carries the parked
        // parent's operationId + placeholder tool message so the child's step
        // loop can stream its running totals down the parent's gateway channel.
        subAgentProgress: appContext?.subAgentProgress,
        taskId: operationTaskId,
        threadId: appContext?.threadId,
        topicId,
        trigger,
      },
      autoStart,
      botContext,
      botPlatformContext,
      deviceAccessPolicy: { canUseDevice, reason: deviceAccessReason },
      discordContext,
      evalContext,
      evalRuntime,
      enableExpertise,
      expertise: prep.expertise,
      initialContext,
      initialMessages: prep.allMessages,
      initialStepCount,
      ...(providedApprovalResolutionRequestId && approvalSourceOperationId
        ? {
            interventionResolution: {
              resolutionRequestId: providedApprovalResolutionRequestId,
              sourceOperationId: approvalSourceOperationId,
              sourceToolMessageIds: [...approvalSourceToolMessageIds].sort(),
            },
          }
        : {}),
      ...(providedApprovalResolutionRequestId
        ? {
            onInterventionPrepared: () => {
              approvalClaim.continuationPrepared = true;
            },
          }
        : {}),
      maxSteps,
      modelRuntimeConfig: { model, provider },
      hooks,
      operationId,
      parentOperationId,
      signal,
      queueRetries,
      queueRetryDelay,
      stream,
      toolSet: {
        activatableToolIds: prep.activatableToolIds,
        enabledToolIds: discovery.toolsResult.enabledToolIds,
        executorMap: discovery.toolExecutorMap,
        manifestMap: discovery.toolManifestMap,
        sourceMap: discovery.toolSourceMap,
        tools: discovery.tools,
      },
      operationSkillSet: prep.operationSkillSet,
      userId: deps.userId,
      userInterventionConfig,
      userMemory: prep.userMemory,
      workspaceId: deps.workspaceId,
    });
    approvalClaim.continuationStarted = true;

    // The approval continuation is a fresh operation. Legacy direct callers
    // retire the old parked runtime here, only after createOperation has
    // durably scheduled the replacement. Generic v2 calls carry a durable
    // resolution id and defer this transition to the shared router dispatch
    // boundary, which can retry it without losing this successful ExecAgent
    // result (and therefore the WebSocket subscription credentials).
    if (approvalSourceOperationId && !providedApprovalResolutionRequestId) {
      await deps.retirePendingApprovalOperation(approvalSourceOperationId);
    }

    log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

    // Persist running operation to topic metadata for reconnect after page reload.
    //
    // Skipped for isolation-thread children (callAgent / callSubAgent / group
    // members): they run on the SPAWNER's topic and finish long before it does,
    // so claiming the mark would first point every client reconnect at the
    // child's thread stream, and then — once the child finished and cleared it —
    // leave the still-running parent with no mark at all, i.e. no gateway
    // WebSocket for the rest of the run. The parent's mark stays authoritative;
    // a child's live progress already rides down the parent channel via
    // `appContext.subAgentProgress`.
    // `orchestrationRole` is public rendering metadata. Only the internally
    // propagated parent operation id proves child ownership of this topic.
    if (!appContext?.isolationThread && !appContext?.threadId && !topicStartOwnerOperationId) {
      await deps.topicModel.updateMetadata(topicId, {
        runningOperation: {
          assistantMessageId,
          heteroType: null,
          operationId,
          scope: appContext?.scope ?? undefined,
          // Liveness stamp — without it this marker can never be proven dead
          // and would hold the topic against background starts forever.
          startedAt: new Date().toISOString(),
          threadId: appContext?.threadId ?? undefined,
        },
      });
    }

    // Generate a short-lived JWT for Gateway WebSocket authentication.
    // Share-visitor runs sign for the VISITOR: signUserJWT mints a full
    // oidcAuth token, so a creator-signed token handed to the visitor's
    // browser would be creator account access. The gateway channel is
    // registered under the visitor's id (`streamOwnerUserId`), so the
    // visitor's own `sub` matches.
    let gatewayToken: string | undefined;
    if (!deps.withholdGatewayToken) {
      try {
        gatewayToken = await signUserJWT(shareGate?.visitorUserId ?? deps.userId);
      } catch {
        log('execAgent: failed to sign gateway JWT, gateway auth will be unavailable');
      }
    }

    return {
      agentId: resolvedAgentId,
      assistantMessageId,
      autoStarted: result.autoStarted,
      createdAt: new Date().toISOString(),
      heteroType: null,
      message: 'Agent operation created successfully',
      messageId: result.messageId,
      operationId,
      status: 'created',
      success: true,
      timestamp: new Date().toISOString(),
      token: gatewayToken,
      topicId,
      userMessageId: userMessageId ?? parentMessageId ?? '',
    };
  } catch (error) {
    if (topicStartOwnerOperationId) {
      await deps.topicModel.removeRunningOperationChild(topicId, operationId).catch(() => false);
    }
    if (isAbortError(error)) {
      await updateAbortedAssistantMessage(error.message);
      log('execAgent: createOperation aborted for %s: %s', operationId, error.message);
      throw error;
    }
    if (providedApprovalResolutionRequestId && approvalClaim.continuationPrepared) {
      // The source claim + deterministic state are now the retry record. A
      // queue ACK may have been accepted even when its HTTP response or our
      // follow-up marker write failed, so do not paint the stable assistant
      // as terminal error and do not collapse this into success:false.
      throw error;
    }

    // Operation startup failed (e.g., QStash queue service unavailable)
    // Update assistant message with error so user can see what went wrong
    const errorMessage = error instanceof Error ? error.message : 'Unknown error starting agent';
    log(
      'execAgent: createOperation failed, updating assistant message with error: %s',
      errorMessage,
    );

    await deps.messageModel.update(assistantMessageId, {
      content: '',
      error: {
        body: {
          detail: errorMessage,
        },
        message: errorMessage,
        type: 'ServerAgentRuntimeError', // ServiceUnavailable - agent runtime service unavailable
      },
    });

    // Return result with error status - messages are valid but agent didn't start
    return {
      agentId: resolvedAgentId,
      assistantMessageId,
      autoStarted: false,
      createdAt: new Date().toISOString(),
      error: errorMessage,
      message: 'Agent operation failed to start',
      operationId,
      status: 'error',
      success: false,
      timestamp: new Date().toISOString(),
      topicId,
      userMessageId: userMessageId ?? parentMessageId ?? '',
    };
  }
};
