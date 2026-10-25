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
import {
  applyOperationInitSlots,
  buildPreInitState,
  pickOperationInitSlots,
} from './operationInitSlots';
import type { AgentRuntimeServiceContext } from './types';
import { withoutFrozenModelFacts } from './utils';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type CreateOperationDeps = Pick<
  AgentRuntimeServiceContext,
  | 'acceptsFileWorks'
  | 'agentOperationModel'
  | 'baseURL'
  | 'completionLifecycle'
  | 'coordinator'
  | 'persistInterventionDispatchAck'
  | 'queueService'
  | 'resolveLlmExecutor'
  | 'workspaceId'
>;

/**
 * Create a new Agent operation
 */
export async function createOperation(
  deps: CreateOperationDeps,
  params: OperationCreationParams,
): Promise<OperationCreationResult> {
  const {
    acceptsFileWorks,
    acceptsMemberRuntimeEnd,
    operationId,
    initialContext,
    agentConfig,
    agentShareVisitor,
    modelRuntimeConfig,
    userId,
    autoStart = true,
    initialMessages = [],
    interventionResolution,
    onInterventionPrepared,
    appContext,
    toolSet,
    hooks,
    queueRetries,
    queueRetryDelay,
    maxSteps,
    userMemory,
    parentOperationId,
    signal,
    initialStepCount = 0,
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
    deps.completionLifecycle.recordStart({
      agentId: appContext?.agentId ?? null,
      appContext: {
        defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
        documentId: appContext?.documentId,
        editingAgentId: appContext?.editingAgentId,
        // The Group Agent Builder target must survive on the durable row: an
        // intervention continuation rebuilds its app context from this row
        // (never from client input), and a topic whose metadata predates the
        // `editingGroupId` stamp has nothing else to recover it from.
        editingGroupId: appContext?.editingGroupId,
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
    const durableOperation = await deps.agentOperationModel.findById(operationId);
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

    const llmExecutor = await deps.resolveLlmExecutor(params.llmExecutor, parentOperationId);
    // A member's pushes reach the supervisor's client, so it renders what
    // that client declared.
    const fileWorksAccepted =
      acceptsFileWorks ??
      (parentOperationId && appContext?.orchestrationRole === 'member'
        ? await deps.acceptsFileWorks(parentOperationId)
        : undefined);

    const preInitState = buildPreInitState(params, { fileWorksAccepted, llmExecutor });
    const initialState = applyOperationInitSlots(preInitState, pickOperationInitSlots(params));

    // Use coordinator to create operation, automatically sends initialization event.
    // For an in-group broadcast/speak member, mirror its Gateway stream events
    // onto the supervisor op's channel (parentOperationId) so they flow down the
    // supervisor's existing WebSocket — the client subscribes to one connection,
    // not one per member (single-connection multiplexing).
    const mirrorToOperationId =
      appContext?.orchestrationRole === 'member' ? (parentOperationId ?? undefined) : undefined;
    await traceStartStage('runtime_meta', () =>
      deps.coordinator.createAgentOperation(
        operationId,
        {
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
          workspaceId: deps.workspaceId,
        },
        {
          agentId: appContext?.agentId ?? undefined,
          groupId: appContext?.groupId ?? undefined,
          parentOperationId: parentOperationId ?? undefined,
          scope: appContext?.scope ?? undefined,
          taskId: appContext?.taskId ?? undefined,
          threadId: appContext?.threadId ?? undefined,
          topicId: appContext?.topicId ?? undefined,
        },
      ),
    );
    operationCreated = true;

    // Save initial state
    await traceStartStage('save_state', () =>
      deps.coordinator.saveAgentState(operationId, initialState as any),
    );

    // Register external hooks
    hookDispatcher.register(operationId, hooks ?? []);
    hooksRegistered = hookDispatcher.hasHooks(operationId);
    if (hooksRegistered) {
      // Persist webhook configs to state metadata for production mode
      const serializedHooks = hookDispatcher.getSerializedHooks(operationId);
      if (serializedHooks && serializedHooks.length > 0) {
        const currentState = await deps.coordinator.loadAgentState(operationId);
        if (currentState) {
          await deps.coordinator.saveAgentState(operationId, {
            ...currentState,
            host: { ...currentState.host, hooks: serializedHooks },
          });
        }
      }
    }

    if (interventionResolution) {
      const preparedState = await deps.coordinator.loadAgentState(operationId);
      if (!preparedState) {
        throw new Error(`Intervention continuation state disappeared: ${operationId}`);
      }
      const preparation = {
        deduplicationId: deriveAgentInterventionQueueDeduplicationId(operationId, initialStepCount),
        resolutionRequestId: interventionResolution.resolutionRequestId,
        state: 'ready' as const,
        stepIndex: initialStepCount,
      };
      await deps.coordinator.saveAgentState(operationId, {
        ...preparedState,
        metadata: {
          ...preparedState.metadata,
          agentInterventionPreparation: preparation,
        },
      });
      const preparationPersisted =
        await deps.agentOperationModel.recordAgentInterventionPreparation(operationId, preparation);
      if (!preparationPersisted) {
        throw new Error(`Failed to persist intervention continuation preparation: ${operationId}`);
      }
      onInterventionPrepared?.();
    }

    await params.onOperationCreated?.(operationId);

    throwIfAborted(signal, 'Agent execution aborted before first step scheduling');

    let messageId: string | undefined;
    let autoStarted = false;

    if (autoStart && deps.queueService) {
      const deduplicationId = interventionResolution
        ? deriveAgentInterventionQueueDeduplicationId(operationId, initialStepCount)
        : undefined;
      // Both local and queue modes use scheduleMessage
      // LocalQueueServiceImpl uses setTimeout + callback mechanism
      // QStashQueueServiceImpl schedules HTTP requests
      const queueService = deps.queueService;
      messageId = await traceStartStage('schedule_step', () =>
        queueService.scheduleMessage({
          context: initialContext,
          deduplicationId,
          delay: 50, // Short delay for startup
          endpoint: `${deps.baseURL}/run`,
          operationId,
          priority: 'high',
          retryDelay: queueRetryDelay,
          retries: queueRetries,
          stepIndex: initialStepCount,
        }),
      );
      if (interventionResolution && deduplicationId) {
        await deps.persistInterventionDispatchAck({
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
          await deps.coordinator.deleteAgentOperation(operationId);
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
