import type { AgentState } from '@lobechat/agent-runtime';
import { extractActivatedToolIdsFromMessages } from '@lobechat/agent-runtime';
import debug from 'debug';

import {
  deriveAgentInterventionQueueDeduplicationId,
  matchesAgentInterventionContinuationProvenance,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { traceStartStage } from '@/server/services/aiAgent/pipeline/sendTracing';

import { isAbortError, throwIfAborted } from '../abort';
import { hookDispatcher, parseSerializedHooks } from '../hooks';
import {
  type GroupActionMemberBridgeParams,
  type OperationCreationParams,
  type OperationCreationResult,
} from '../types';
import type { AgentRuntimeService } from '.';
import { withoutFrozenModelFacts } from './utils';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Create a new Agent operation
 */
export async function createOperation(
  svc: AgentRuntimeService,
  params: OperationCreationParams,
): Promise<OperationCreationResult> {
  const {
    acceptsFileWorks,
    acceptsMemberRuntimeEnd,
    activeDeviceId,
    activeDeviceScope,
    operationId,
    initialContext,
    agentConfig,
    agentGroup,
    agentShareVisitor,
    modelRuntimeConfig,
    operationCredentials,
    userId,
    autoStart = true,
    stream,
    initialMessages = [],
    interventionResolution,
    onInterventionPrepared,
    appContext,
    toolSet,
    hooks,
    userInterventionConfig,
    queueRetries,
    queueRetryDelay,
    searchDecision,
    botContext,
    botPlatformContext,
    deviceAccessPolicy,
    connectorOwnershipNote,
    discordContext,
    evalContext,
    evalRuntime,
    enableExpertise,
    expertise,
    projectInstructions,
    executionPlan,
    maxSteps,
    userMemory,
    deviceSystemInfo,
    disabledPluginIds,
    operationSkillSet,
    parentOperationId,
    signal,
    userTimezone,
    initialStepCount = 0,
    workspaceId,
  } = params;

  // Persist initial agent_operations row. CompletionLifecycle owns both
  // ends of the persistence lifecycle (start row here, terminal update
  // in dispatchHooks) and swallows DB errors so runtime startup is never
  // blocked.
  // A group member's completion bridge lives in the runtime snapshot, which
  // expires (2h). Keep a durable copy on the row so a late approval or a
  // stop can still reach the member's supervisor (`loadGroupMemberBridge`).
  const groupMemberBridge = hooks?.find((hook) => hook.id === 'group-member-bridge')?.webhook
    ?.body as Omit<GroupActionMemberBridgeParams, 'operationId' | 'reason'> | undefined;
  // The Redis state expires independently of pending tools/approvals. Keep
  // caller hook templates on the private operation record, as hetero runs do.
  const durableHooks = parseSerializedHooks(
    (hooks ?? []).flatMap((hook) =>
      hook.webhook
        ? [{ id: hook.id, type: hook.type, matcher: hook.matcher, webhook: hook.webhook }]
        : [],
    ),
  );
  const requiresDurableResultControl = durableHooks.some(
    (hook) => hook.type === 'afterToolCall' && hook.webhook?.responseHandling === 'toolCall',
  );
  const operationStartPersisted = await traceStartStage('record_start', () =>
    svc.completionLifecycle.recordStart({
      agentId: appContext?.agentId ?? null,
      appContext: {
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId,
        editingAgentId: appContext?.editingAgentId,
        groupId: appContext?.groupId,
        scope: appContext?.scope,
        sessionId: appContext?.sessionId,
        sourceMessageId: appContext?.sourceMessageId,
      },
      chatGroupId: appContext?.groupId ?? null,
      maxSteps,
      metadata: {
        ...(durableHooks.length > 0 && { _hooks: durableHooks }),
        ...(appContext?.agentSignal ? { agentSignal: appContext.agentSignal } : {}),
        ...(interventionResolution
          ? { agentInterventionContinuation: interventionResolution }
          : {}),
        ...(groupMemberBridge ? { groupMemberBridge } : {}),
      },
      model: modelRuntimeConfig?.model,
      modelRuntimeConfig: withoutFrozenModelFacts(modelRuntimeConfig),
      operationId,
      parentOperationId: parentOperationId ?? null,
      provider: modelRuntimeConfig?.provider,
      taskId: appContext?.taskId ?? null,
      threadId: appContext?.threadId ?? null,
      topicId: appContext?.topicId ?? null,
      trigger: appContext?.trigger,
    }),
  );
  if (requiresDurableResultControl && !operationStartPersisted) {
    throw new Error('Failed to durably persist afterToolCall control policy before dispatch');
  }
  if (interventionResolution && !operationStartPersisted) {
    throw new Error(
      `Failed to durably persist intervention continuation ${operationId} before dispatch`,
    );
  }

  // A member's durable bridge is what a Stop or a late approval falls back
  // to once the runtime snapshot expires; a member without it could strand
  // its supervisor, so fail the start instead.
  if (groupMemberBridge && !operationStartPersisted) {
    throw new Error(`Failed to durably persist group member ${operationId} before dispatch`);
  }

  if (interventionResolution) {
    const durableOperation = await svc.agentOperationModel.findById(operationId);
    const persistedProvenance = durableOperation?.metadata?.agentInterventionContinuation;
    if (
      !durableOperation ||
      !matchesAgentInterventionContinuationProvenance(persistedProvenance, interventionResolution)
    ) {
      throw new Error(`Intervention continuation operation identity conflict: ${operationId}`);
    }
  }

  const operationToolSet = toolSet;
  let operationCreated = false;
  let hooksRegistered = false;

  try {
    throwIfAborted(signal, 'Agent execution aborted before operation startup');

    const memories = userMemory?.memories;
    log(
      '[%s] Creating new operation (autoStart: %s) with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d, memory=%s',
      operationId,
      autoStart,
      agentConfig?.model,
      agentConfig?.provider,
      operationToolSet.tools?.length ?? 0,
      initialMessages.length,
      operationToolSet.manifestMap ? Object.keys(operationToolSet.manifestMap).length : 0,
      memories
        ? `{contexts:${memories.contexts?.length ?? 0},experiences:${memories.experiences?.length ?? 0},preferences:${memories.preferences?.length ?? 0},identities:${memories.identities?.length ?? 0},activities:${memories.activities?.length ?? 0},persona:${memories.persona ? 'yes' : 'no'}}`
        : 'none',
    );

    // Initialize operation state - create state before saving
    const activatableToolIds = new Set(operationToolSet.activatableToolIds ?? []);
    const restoredActivatedToolIds = extractActivatedToolIdsFromMessages(initialMessages)?.filter(
      (id) => activatableToolIds.has(id),
    );
    const activatedStepTools = restoredActivatedToolIds?.length
      ? restoredActivatedToolIds.map((id) => ({
          activatedAtStep: initialStepCount,
          id,
          manifest: operationToolSet.manifestMap[id],
          source: 'discovery' as const,
        }))
      : undefined;

    const llmExecutor = await svc.resolveLlmExecutor(params.llmExecutor, parentOperationId);
    // A member's pushes reach the supervisor's client, so it renders what
    // that client declared.
    const fileWorksAccepted =
      acceptsFileWorks ??
      (parentOperationId && appContext?.orchestrationRole === 'member'
        ? await svc.acceptsFileWorks(parentOperationId)
        : undefined);

    const initialState = {
      activatedStepTools,
      createdAt: new Date().toISOString(),
      // Store initialContext for executeSync to use
      initialContext,
      lastModified: new Date().toISOString(),
      // Use the passed initial messages
      messages: initialMessages,
      // Late-bound execution facts. The device may be unrouted here and get
      // bound at a later step boundary (`computeDeviceContext`).
      ...((activeDeviceId || deviceSystemInfo) && {
        binding: {
          device: {
            ...(activeDeviceId && { id: activeDeviceId }),
            ...(deviceSystemInfo && { systemInfo: deviceSystemInfo }),
          },
        },
      }),
      // What the host needs to deliver and retry the run. Hooks are stamped
      // right after creation once the dispatcher has serialized them.
      host: {
        ...(fileWorksAccepted === true && { acceptsFileWorks: true }),
        ...(params.clientProtocol === 2 && { clientProtocol: 2 as const }),
        ...(params.includeFinalState === true && { includeFinalState: true }),
        ...(llmExecutor && { llmExecutor }),
        queue: { retries: queueRetries, retryDelay: queueRetryDelay },
      },
      // Run ledger — everything fixed at creation lives in the typed slots.
      metadata: {},
      // Where the run came from — frozen from here on. Mirrors the
      // agent_operations row so the runtime can hang its output on the right
      // conversation node without a lookup.
      origin: {
        agentId: appContext?.agentId,
        continuation: interventionResolution,
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId ?? undefined,
        editingAgentId: appContext?.editingAgentId,
        editingGroupId: appContext?.editingGroupId,
        groupId: appContext?.groupId ?? undefined,
        lineage: {
          isSubAgent: appContext?.isSubAgent,
          orchestrationRole: appContext?.orchestrationRole,
          parentOperationId,
          progressAnchor: appContext?.subAgentProgress,
        },
        scope: appContext?.scope ?? undefined,
        sessionId: appContext?.sessionId,
        signal: appContext?.agentSignal,
        sourceMessageId: appContext?.sourceMessageId,
        taskId: appContext?.taskId,
        threadId: appContext?.threadId ?? undefined,
        topicId: appContext?.topicId ?? undefined,
        trigger: appContext?.trigger,
        userId,
        workspaceId,
      },
      maxSteps,
      // modelRuntimeConfig at state level for executor fallback
      modelRuntimeConfig,
      // Read once during discovery; dropped again as soon as the run changes
      // its own credentials (see the creds invalidation after a step).
      operationCredentials,
      operationId,
      // The run's only copy of its tool set. The manifest map is the heaviest
      // thing on the state and the state is re-serialized at every step, so the
      // former top-level mirrors (`tools`, `toolManifestMap`, `toolSourceMap`,
      // `toolExecutorMap`) are no longer written; readers go through
      // `selectToolManifestMap` and friends.
      operationToolSet,
      status: 'idle',
      stepCount: initialStepCount,
      // How the run executes — frozen from here on.
      plan: {
        eval: evalRuntime,
        execution: executionPlan,
        skills: operationSkillSet,
        stream,
        workingDirectory: agentConfig?.chatConfig?.runtimeEnv?.workingDirectory,
      },
      // Under whose authority the run acts and what it may do — decided here,
      // re-presented (never re-derived) at each dispatch boundary.
      principal: {
        actor: {
          bot: botContext,
          deviceScope: activeDeviceScope,
          shareVisitor: agentShareVisitor,
        },
        audit: { clientIp: appContext?.clientIp, userAgent: appContext?.userAgent },
        // What the run may do, decided once here: device access and the
        // approval mode its tool calls answer to.
        policy: { deviceAccess: deviceAccessPolicy, userIntervention: userInterventionConfig },
      },
      // Compat mirrors for a rolling deploy: a worker still running the
      // pre-slot build reads only these, and a missing approval mode defaults
      // to `manual` there — which parks a headless run on an approval nobody
      // can give. Drop them (and the matching entries in
      // `normalizeAgentState`'s COMPAT_MIRROR_PATHS) once no pre-slot worker
      // can pick up a step.
      enableExpertise,
      expertise,
      userInterventionConfig,
      // What the model is told about the run's world — frozen from here on;
      // the context engine reads it on every step.
      world: {
        agent: agentConfig,
        ...((botPlatformContext || discordContext) && {
          channel: { botPlatform: botPlatformContext, discord: discordContext },
        }),
        connectorOwnershipNote,
        disabledPluginIds,
        enableExpertise,
        eval: evalContext,
        expertise,
        group: agentGroup,
        projectInstructions,
        searchDecision,
        userMemory,
        userTimezone,
      },
    } as Partial<AgentState>;

    // Use coordinator to create operation, automatically sends initialization event.
    // For an in-group broadcast/speak member, mirror its Gateway stream events
    // onto the supervisor op's channel (parentOperationId) so they flow down the
    // supervisor's existing WebSocket — the client subscribes to one connection,
    // not one per member (single-connection multiplexing).
    const mirrorToOperationId =
      appContext?.orchestrationRole === 'member' ? (parentOperationId ?? undefined) : undefined;
    await traceStartStage('runtime_meta', () =>
      svc.coordinator.createAgentOperation(operationId, {
        acceptsMemberRuntimeEnd,
        agentConfig,
        // Persisted so a queue worker that never ran this op's init still
        // applies the owner-configured visitor redaction policy instead of the
        // fail-closed full strip. See `gatewayVisitorRedaction.ts`.
        visitorRedaction: agentShareVisitor
          ? {
              showErrorDetails: agentShareVisitor.showErrorDetails,
              showModelInfo: agentShareVisitor.showModelInfo,
            }
          : undefined,
        mirrorToOperationId,
        modelRuntimeConfig: withoutFrozenModelFacts(modelRuntimeConfig),
        // Share-visitor runs execute as the creator (`userId`) but stream only
        // to the visitor — the gateway registers the WS channel under this id.
        streamOwnerUserId: agentShareVisitor?.visitorUserId,
        userId,
        workspaceId: svc.workspaceId,
      }),
    );
    operationCreated = true;

    // Save initial state
    await traceStartStage('save_state', () =>
      svc.coordinator.saveAgentState(operationId, initialState as any),
    );

    // Register external hooks
    hookDispatcher.register(operationId, hooks ?? []);
    hooksRegistered = hookDispatcher.hasHooks(operationId);
    if (hooksRegistered) {
      // Persist webhook configs to state metadata for production mode
      const serializedHooks = hookDispatcher.getSerializedHooks(operationId);
      if (serializedHooks && serializedHooks.length > 0) {
        const currentState = await svc.coordinator.loadAgentState(operationId);
        if (currentState) {
          await svc.coordinator.saveAgentState(operationId, {
            ...currentState,
            host: { ...currentState.host, hooks: serializedHooks },
          });
        }
      }
    }

    if (interventionResolution) {
      const preparedState = await svc.coordinator.loadAgentState(operationId);
      if (!preparedState) {
        throw new Error(`Intervention continuation state disappeared: ${operationId}`);
      }
      const preparation = {
        deduplicationId: deriveAgentInterventionQueueDeduplicationId(operationId, initialStepCount),
        resolutionRequestId: interventionResolution.resolutionRequestId,
        state: 'ready' as const,
        stepIndex: initialStepCount,
      };
      await svc.coordinator.saveAgentState(operationId, {
        ...preparedState,
        metadata: {
          ...preparedState.metadata,
          agentInterventionPreparation: preparation,
        },
      });
      const preparationPersisted = await svc.agentOperationModel.recordAgentInterventionPreparation(
        operationId,
        preparation,
      );
      if (!preparationPersisted) {
        throw new Error(`Failed to persist intervention continuation preparation: ${operationId}`);
      }
      onInterventionPrepared?.();
    }

    await params.onOperationCreated?.(operationId);

    throwIfAborted(signal, 'Agent execution aborted before first step scheduling');

    let messageId: string | undefined;
    let autoStarted = false;

    if (autoStart && svc.queueService) {
      const deduplicationId = interventionResolution
        ? deriveAgentInterventionQueueDeduplicationId(operationId, initialStepCount)
        : undefined;
      // Both local and queue modes use scheduleMessage
      // LocalQueueServiceImpl uses setTimeout + callback mechanism
      // QStashQueueServiceImpl schedules HTTP requests
      const queueService = svc.queueService;
      messageId = await traceStartStage('schedule_step', () =>
        queueService.scheduleMessage({
          context: initialContext,
          deduplicationId,
          delay: 50, // Short delay for startup
          endpoint: `${svc.baseURL}/run`,
          operationId,
          priority: 'high',
          retryDelay: queueRetryDelay,
          retries: queueRetries,
          stepIndex: initialStepCount,
        }),
      );
      if (interventionResolution && deduplicationId) {
        await svc.persistInterventionDispatchAck({
          deduplicationId,
          messageId,
          operationId,
          resolutionRequestId: interventionResolution.resolutionRequestId,
        });
      }
      autoStarted = true;
      log('[%s] Scheduled first step (messageId: %s)', operationId, messageId);
    }

    if (!autoStarted) {
      log('[%s] Created operation without auto-start', operationId);
    }

    return { autoStarted, messageId, operationId, success: true };
  } catch (error) {
    if (isAbortError(error)) {
      if (hooksRegistered) {
        hookDispatcher.unregister(operationId);
      }

      if (operationCreated) {
        try {
          await svc.coordinator.deleteAgentOperation(operationId);
        } catch (cleanupError) {
          console.error('Failed to cleanup aborted operation %s: %O', operationId, cleanupError);
        }
      }

      log('[%s] Operation creation aborted before scheduling', operationId);
      throw error;
    }

    console.error('Failed to create operation %s: %O', operationId, error);
    throw error;
  }
}
