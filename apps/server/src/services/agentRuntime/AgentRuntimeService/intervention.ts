import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import {
  deriveAgentInterventionQueueDeduplicationId,
  matchesAgentInterventionContinuationProvenance,
} from '@/business/server/agent-run/agentInterventionIdentity';

import { type PendingInterventionsResult } from '../types';
import { INTERVENTION_LIFECYCLE_CHECKPOINT_KEY } from './constants';
import type { AgentRuntimeServiceContext, InterventionLifecycleCheckpoint } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type InterventionDeps = Pick<
  AgentRuntimeServiceContext,
  | 'agentOperationModel'
  | 'baseURL'
  | 'coordinator'
  | 'persistInterventionDispatchAck'
  | 'queueService'
>;

/** Load the authoritative runtime state for a deterministic intervention continuation. */
export async function loadInterventionContinuationState(
  deps: InterventionDeps,
  operationId: string,
): Promise<AgentState | null> {
  return deps.coordinator.loadAgentState(operationId);
}

/**
 * Re-enqueue a continuation whose durable state was written but whose first
 * queue delivery may have been lost with the resolving HTTP process. The
 * operation id and step index are stable, so the ordinary distributed step
 * lock de-duplicates concurrent/repeated schedules.
 */
export async function ensureInterventionContinuationStarted(
  deps: InterventionDeps,
  operationId: string,
): Promise<'already_started' | 'missing' | 'scheduled'> {
  const state = await deps.coordinator.loadAgentState(operationId);
  if (!state) return 'missing';

  const provenance = state.origin?.continuation as
    | {
        resolutionRequestId?: unknown;
        sourceOperationId?: unknown;
        sourceToolMessageIds?: unknown;
      }
    | undefined;
  const preparation = state.metadata?.agentInterventionPreparation as
    | {
        deduplicationId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
        stepIndex?: unknown;
      }
    | undefined;
  if (
    typeof provenance?.resolutionRequestId !== 'string' ||
    typeof provenance.sourceOperationId !== 'string' ||
    !Array.isArray(provenance.sourceToolMessageIds) ||
    !provenance.sourceToolMessageIds.every((id) => typeof id === 'string')
  ) {
    throw new Error(`Intervention continuation provenance missing: ${operationId}`);
  }
  if (
    preparation?.state !== 'ready' ||
    preparation.resolutionRequestId !== provenance.resolutionRequestId ||
    typeof preparation.stepIndex !== 'number' ||
    !Number.isSafeInteger(preparation.stepIndex) ||
    preparation.stepIndex < 0
  ) {
    throw new Error(`Intervention continuation is not ready to schedule: ${operationId}`);
  }
  const stepIndex = preparation.stepIndex;
  const deduplicationId = deriveAgentInterventionQueueDeduplicationId(operationId, stepIndex);
  if (preparation.deduplicationId !== deduplicationId) {
    throw new Error(`Intervention continuation dedupe provenance conflict: ${operationId}`);
  }
  const operation = await deps.agentOperationModel.findById(operationId);
  if (
    !operation ||
    !matchesAgentInterventionContinuationProvenance(
      operation.metadata?.agentInterventionContinuation,
      provenance as {
        resolutionRequestId: string;
        sourceOperationId: string;
        sourceToolMessageIds: string[];
      },
    )
  ) {
    throw new Error(`Intervention continuation durable provenance conflict: ${operationId}`);
  }
  const durablePreparation = operation.metadata?.agentInterventionPreparation as
    | {
        deduplicationId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
        stepIndex?: unknown;
      }
    | undefined;
  if (
    durablePreparation &&
    (durablePreparation.state !== 'ready' ||
      durablePreparation.resolutionRequestId !== provenance.resolutionRequestId ||
      durablePreparation.stepIndex !== stepIndex ||
      durablePreparation.deduplicationId !== deduplicationId)
  ) {
    throw new Error(`Intervention continuation durable preparation conflict: ${operationId}`);
  }
  if (!durablePreparation) {
    const persisted = await deps.agentOperationModel.recordAgentInterventionPreparation(
      operationId,
      {
        deduplicationId,
        resolutionRequestId: provenance.resolutionRequestId,
        state: 'ready',
        stepIndex,
      },
    );
    if (!persisted) {
      throw new Error(`Failed to backfill intervention preparation: ${operationId}`);
    }
  }
  const dispatchMarker = operation.metadata?.agentInterventionDispatch as
    | {
        deduplicationId?: unknown;
        messageId?: unknown;
        resolutionRequestId?: unknown;
        state?: unknown;
      }
    | undefined;
  if (dispatchMarker) {
    if (
      dispatchMarker.state !== 'scheduled' ||
      dispatchMarker.resolutionRequestId !== provenance.resolutionRequestId ||
      dispatchMarker.deduplicationId !== deduplicationId
    ) {
      throw new Error(`Intervention continuation dispatch marker conflict: ${operationId}`);
    }
    return 'already_started';
  }
  if (!deps.queueService) {
    throw new Error(`Cannot schedule intervention continuation ${operationId}`);
  }

  // Missing provider ACK is never inferred from `state.status`: a worker may
  // have raced the HTTP response and advanced this state to running/terminal.
  // Re-publish with the same provider dedupe key to recover the ACK without a
  // second actual delivery, then persist the authoritative dispatch marker.
  const messageId = await deps.queueService.scheduleMessage({
    context: (state as AgentState & { initialContext: AgentRuntimeContext }).initialContext,
    deduplicationId,
    delay: 0,
    endpoint: `${deps.baseURL}/run`,
    operationId,
    priority: 'high',
    retryDelay:
      typeof state.host?.queue?.retryDelay === 'string' ? state.host?.queue?.retryDelay : undefined,
    retries:
      typeof state.host?.queue?.retries === 'number' ? state.host?.queue?.retries : undefined,
    stepIndex,
  });
  await deps.persistInterventionDispatchAck({
    deduplicationId,
    messageId,
    operationId,
    resolutionRequestId: provenance.resolutionRequestId,
  });

  return 'scheduled';
}

export async function persistInterventionDispatchAck(
  deps: InterventionDeps,
  params: {
    deduplicationId: string;
    messageId: string;
    operationId: string;
    resolutionRequestId: string;
  },
): Promise<void> {
  const marker = {
    deduplicationId: params.deduplicationId,
    messageId: params.messageId,
    resolutionRequestId: params.resolutionRequestId,
    scheduledAt: new Date().toISOString(),
    state: 'scheduled' as const,
  };
  const persisted = await deps.agentOperationModel.recordAgentInterventionDispatch(
    params.operationId,
    marker,
  );
  if (!persisted) {
    throw new Error(`Failed to persist intervention queue ACK: ${params.operationId}`);
  }
}

/**
 * Get list of pending human interventions
 */
export async function getPendingInterventions(
  deps: InterventionDeps,
  params: {
    operationId?: string;
    userId?: string;
  },
): Promise<PendingInterventionsResult> {
  const { operationId, userId } = params;

  try {
    log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

    let operations: string[] = [];

    if (operationId) {
      operations = [operationId];
    } else if (userId) {
      // Get all active operations for the user
      try {
        const activeOperations = await deps.coordinator.getActiveOperations();

        // Filter operations belonging to this user
        const userOperations = [];
        for (const operation of activeOperations) {
          try {
            const metadata = await deps.coordinator.getOperationMetadata(operation);
            if (metadata?.userId === userId) {
              userOperations.push(operation);
            }
          } catch (error) {
            log('Failed to get metadata for operation %s: %O', operation, error);
          }
        }
        operations = userOperations;
      } catch (error) {
        log('Failed to get active operations: %O', error);
        operations = [];
      }
    }

    // Check status of each operation
    const pendingInterventions = [];

    for (const operation of operations) {
      try {
        const [state, metadata] = await Promise.all([
          deps.coordinator.loadAgentState(operation),
          deps.coordinator.getOperationMetadata(operation),
        ]);

        if (state?.status === 'waiting_for_human') {
          const intervention: any = {
            lastModified: state.lastModified,
            modelRuntimeConfig: metadata?.modelRuntimeConfig,
            operationId: operation,
            status: state.status,
            stepCount: state.stepCount,
            userId: metadata?.userId,
          };

          // Add specific pending content
          if (state.pendingToolsCalling) {
            intervention.type = 'tool_approval';
            intervention.pendingToolsCalling = state.pendingToolsCalling;
          } else if (state.pendingHumanPrompt) {
            intervention.type = 'human_prompt';
            intervention.pendingHumanPrompt = state.pendingHumanPrompt;
          } else if (state.pendingHumanSelect) {
            intervention.type = 'human_select';
            intervention.pendingHumanSelect = state.pendingHumanSelect;
          }

          pendingInterventions.push(intervention);
        }
      } catch (error) {
        log('Failed to get state for operation %s: %O', operation, error);
      }
    }

    return {
      pendingInterventions,
      timestamp: new Date().toISOString(),
      totalCount: pendingInterventions.length,
    };
  } catch (error) {
    log('Failed to get pending interventions: %O', error);
    throw error;
  }
}

/**
 * Process human intervention
 */
export async function processHumanIntervention(
  deps: InterventionDeps,
  params: {
    action: 'approve' | 'reject' | 'reject_continue' | 'input' | 'select';
    approvedToolCall?: any;
    humanInput?: any;
    operationId: string;
    rejectAndContinue?: boolean;
    rejectionReason?: string;
    stepIndex: number;
    toolMessageId?: string;
  },
): Promise<{ messageId?: string }> {
  const {
    operationId,
    stepIndex,
    action,
    approvedToolCall,
    humanInput,
    rejectAndContinue,
    rejectionReason,
    toolMessageId,
  } = params;

  try {
    log(
      'Processing human intervention for operation %s:%d (action: %s)',
      operationId,
      stepIndex,
      action,
    );

    // Schedule execution with high priority (if queue service is available)
    let messageId: string | undefined;
    if (deps.queueService) {
      messageId = await deps.queueService.scheduleMessage({
        context: undefined, // Will be retrieved from state manager
        delay: 100,
        endpoint: `${deps.baseURL}/run`,
        operationId,
        payload: {
          approvedToolCall,
          humanInput,
          rejectAndContinue,
          rejectionReason,
          toolMessageId,
        },
        priority: 'high',
        stepIndex,
      });
      log('Scheduled immediate execution for operation %s (messageId: %s)', operationId, messageId);
    } else {
      log('Queue service disabled, skipping schedule for operation %s', operationId);
    }

    return { messageId };
  } catch (error) {
    log('Failed to process human intervention for operation %s: %O', operationId, error);
    throw error;
  }
}

/**
 * Identify a provider redelivery that must replay a completed approval
 * lifecycle instead of being acknowledged as an ordinary stale step.
 *
 * `pendingApprovalBatch` is the durable, sealed runtime marker written before
 * Review publication. The QStash retry header distinguishes a failed request
 * redelivery from a benign duplicate that arrived after a successful ACK.
 */
export function shouldReplayPendingInterventionLifecycle(
  state: AgentState,
  stepIndex: number,
  externalRetryCount: number,
): boolean {
  const checkpoint = state.metadata?.[INTERVENTION_LIFECYCLE_CHECKPOINT_KEY] as
    InterventionLifecycleCheckpoint | undefined;

  return (
    externalRetryCount > 0 &&
    state.status === 'waiting_for_human' &&
    state.pendingApprovalBatch?.sealed === true &&
    // A missing checkpoint is a rollout-compatible pending state. Once a
    // successful lifecycle writes `completed`, a lost HTTP response can be
    // ACKed without publishing the Review or onComplete hook a second time.
    (!checkpoint || (checkpoint.stepIndex === stepIndex && checkpoint.state === 'pending'))
  );
}

/**
 * Checkpoint a fully delivered Review + onComplete lifecycle before the step
 * request returns. This closes the common response-loss window: QStash may
 * redeliver, but the stale-step guard can ACK a completed checkpoint without
 * duplicating either side effect. The Review itself remains batch-idempotent
 * for the smaller crash window before this checkpoint is saved.
 */
export async function recordInterventionLifecycleCompletion(
  deps: InterventionDeps,
  operationId: string,
  state: AgentState,
  stepIndex: number,
): Promise<void> {
  state.metadata = {
    ...state.metadata,
    [INTERVENTION_LIFECYCLE_CHECKPOINT_KEY]: {
      state: 'completed',
      stepIndex,
    } satisfies InterventionLifecycleCheckpoint,
  };

  try {
    await deps.coordinator.saveAgentState(operationId, state);
  } catch (error) {
    // The Review and hook are already delivered. Do not turn a best-effort
    // dedup checkpoint failure into an agent error; a rare later redelivery
    // safely retries the batch-idempotent Review and at-least-once hook.
    log(
      '[%s][%d] Failed to save intervention lifecycle checkpoint: %O',
      operationId,
      stepIndex,
      error,
    );
  }
}
