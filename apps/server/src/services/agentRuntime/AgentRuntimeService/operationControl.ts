import type { AgentState } from '@lobechat/agent-runtime';
import { getLlmCallCount, isParkedStatus } from '@lobechat/agent-runtime';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { hookDispatcher } from '../hooks';
import {
  controlDeferredToolResult,
  type DeferredToolResultControlInput,
  loadDurableToolResultHooks,
} from '../hooks/deferredToolResultControl';
import { steerQueueScopeOf } from '../steerQueueScope';
import {
  type AgentStepContinuation,
  type OperationStatusResult,
  type StartExecutionParams,
  type StartExecutionResult,
} from '../types';
import {
  DEAD_OPERATION_LEASE_MS,
  DURABLE_LEASE_HEARTBEAT_EVERY_TICKS,
  STEP_LOCK_HEARTBEAT_MS,
  STEP_LOCK_TTL_SECONDS,
} from './constants';
import type { AgentRuntimeServiceContext } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type OperationControlDeps = Pick<
  AgentRuntimeServiceContext,
  | 'agentOperationModel'
  | 'baseURL'
  | 'completionLifecycle'
  | 'coordinator'
  | 'delegate'
  | 'endExpiredClientLlmWait'
  | 'messageModel'
  | 'queueService'
  | 'streamManager'
  | 'traceRecorder'
  | 'userId'
  | 'workspaceId'
>;

export function startStepLockHeartbeat(
  deps: OperationControlDeps,
  operationId: string,
  stepIndex: number,
  ownerId: string,
): () => void {
  let heartbeatTick = 0;
  const timer = setInterval(() => {
    heartbeatTick += 1;
    const refreshDurableLease = heartbeatTick % DURABLE_LEASE_HEARTBEAT_EVERY_TICKS === 0;

    Promise.all([
      deps.coordinator.refreshStepLock(operationId, stepIndex, STEP_LOCK_TTL_SECONDS, ownerId),
      refreshDurableLease
        ? deps.agentOperationModel.touchRunning(operationId)
        : Promise.resolve(true),
    ])
      .then(([refreshed, leaseRefreshed]) => {
        if (!refreshed) {
          log(
            '[%s][%d] Step lock heartbeat did not refresh; ownership may have changed',
            operationId,
            stepIndex,
          );
        }
        if (!leaseRefreshed) {
          log(
            '[%s][%d] Durable operation lease was lost; terminal persistence will be rejected',
            operationId,
            stepIndex,
          );
        }
      })
      .catch((error) => {
        log('[%s][%d] Step lock heartbeat failed: %O', operationId, stepIndex, error);
      });
  }, STEP_LOCK_HEARTBEAT_MS);

  const timerWithUnref = timer as { unref?: () => void };
  timerWithUnref.unref?.();

  return () => clearInterval(timer);
}

/**
 * Whether someone already asked this run to stop (the interrupt sentinel is
 * set), even though it may still be finishing its current step.
 */
export async function isOperationInterrupted(
  deps: OperationControlDeps,
  operationId: string,
): Promise<boolean> {
  return deps.coordinator.isInterrupted(operationId);
}

/**
 * Interrupt a running agent operation by setting its state to 'interrupted'.
 * The agent will stop at the next step boundary (cannot abort an in-flight LLM call).
 * Works with both Redis and InMemory state managers via the coordinator abstraction.
 *
 * @returns true if interruption is acknowledged (including an already terminal operation),
 * false if missing runtime state prevents confirming that the operation has stopped.
 */
export async function interruptOperation(
  deps: OperationControlDeps,
  operationId: string,
): Promise<boolean> {
  const state = await deps.coordinator.loadAgentState(operationId);
  if (!state) {
    // Runtime state can expire before the task-topic completion callback lands.
    // Absence alone is not proof of exit (e.g. another in-memory worker owns
    // the run). Only an owned, durably terminal operation can acknowledge it.
    const operation = await deps.agentOperationModel.findById(operationId);
    if (!operation) return false;
    if (['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)) return true;

    // A `running` row with no runtime state whose durable lease stopped
    // refreshing long ago has nothing executing it: the step heartbeat moves
    // `updatedAt` every few minutes while a step is live. Without this, the
    // row stays `running` forever and every stop request on its task is
    // refused as unconfirmed. Retire it atomically — a concurrent heartbeat
    // moves `updatedAt` past the cutoff and wins, keeping a live run alive.
    if (
      operation.status === 'running' &&
      operation.updatedAt &&
      new Date(operation.updatedAt).getTime() < Date.now() - DEAD_OPERATION_LEASE_MS
    ) {
      return deps.agentOperationModel.settleStaleRunning(
        operationId,
        new Date(Date.now() - DEAD_OPERATION_LEASE_MS),
      );
    }
    return false;
  }

  if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
    // A retried stop must be able to settle a stale running task-topic without
    // overwriting the original completion outcome or emitting another stop.
    return true;
  }

  // Sentinel FIRST: the poller and the step-boundary check read only the
  // sentinel, so it must become visible no later than the interrupted
  // state — otherwise a boundary check landing between the two writes
  // reads false and the following saveStepResult clobbers the
  // interruption. Writing it first also keeps failure atomic: if the
  // sentinel write throws, the state below is never marked either, so the
  // two never diverge. A sentinel that lands without the state save
  // (crash between the writes) only stops the op earlier than the record
  // shows — the step-boundary check then persists the interrupted state.
  await deps.coordinator.markInterrupted(operationId);

  const parkedWait = state.status === 'waiting_for_client' ? state.clientLlmWait : undefined;
  const interruptedState: AgentState = {
    ...state,
    ...(state.status === 'waiting_for_client' && { clientLlmWait: undefined }),
    lastModified: new Date().toISOString(),
    status: 'interrupted',
  };
  await deps.coordinator.saveAgentState(operationId, interruptedState);

  // A run parked for a client has no step that would reach a boundary and
  // settle it, so settle it here — otherwise the row and the topic stay live
  // until the wait expires. Its waiting card goes too: nothing can continue it.
  if (state.status === 'waiting_for_client') {
    if (parkedWait?.assistantMessageId) {
      await deps.messageModel
        .update(parkedWait.assistantMessageId, { error: null })
        .catch((error) => log('[%s] Failed to clear the waiting notice: %O', operationId, error));
    }
    if (await deps.agentOperationModel.settleClientWait(operationId, 'interrupted')) {
      await deps.completionLifecycle.dispatchHooks(operationId, interruptedState, 'interrupted');
    } else if (parkedWait) {
      // The wait's expiry claimed the row first and has not finished (its
      // Redis state still read this park). Its retry would find the state
      // this Stop just wrote and give up, so finish it here as the row says.
      const row = await deps.agentOperationModel.findById(operationId).catch(() => undefined);
      if (row?.status === 'error') {
        log('[%s] Stop lost to the wait expiry; finishing the expiry', operationId);
        await deps.endExpiredClientLlmWait(operationId, state, parkedWait);
      }
    }
  }

  log('[%s] Operation interrupted', operationId);
  return true;
}

/**
 * Whether the client that started this operation declared it renders `file`
 * Works. An unknown or expired operation reads as `false`, so a continuation
 * then keeps the pushed snapshot every client can render.
 */
export async function acceptsFileWorks(
  deps: OperationControlDeps,
  operationId: string,
): Promise<boolean> {
  try {
    const state = await deps.coordinator.loadAgentState(operationId);
    return state?.host?.acceptsFileWorks === true;
  } catch (error) {
    log('[%s] Failed to read the file Works declaration: %O', operationId, error);
    return false;
  }
}

/**
 * Whether the client that started this operation declared it handles
 * `member_runtime_end`. An unknown or expired operation reads as `false`, so
 * a continuation then keeps the verbatim terminal every client understands.
 */
export async function acceptsMemberRuntimeEnd(
  deps: OperationControlDeps,
  operationId: string,
): Promise<boolean> {
  const metadata = await deps.coordinator.getOperationMetadata(operationId).catch(() => null);
  return metadata?.acceptsMemberRuntimeEnd === true;
}

/**
 * The Group Agent Builder target frozen on the durable operation row.
 *
 * An intervention continuation rebuilds its app context from server-side
 * evidence (never client input), and `state.origin` expires with the runtime
 * snapshot. The row is the only durable copy — older topics may lack
 * `topics.metadata.editingGroupId`, so without it the resumed member tools
 * answer `NoGroupContext`.
 */
export async function getOperationEditingGroupId(
  deps: OperationControlDeps,
  operationId: string,
): Promise<string | undefined> {
  try {
    const row = await deps.agentOperationModel.findById(operationId);
    const value = row?.appContext?.editingGroupId;
    return typeof value === 'string' && value ? value : undefined;
  } catch (error) {
    log('[%s] Failed to read the editing group target: %O', operationId, error);
    return undefined;
  }
}

/**
 * Record whether the client still holds user messages queued behind a run.
 * Only the run's owner may flag it; an unknown or foreign operation is a
 * no-op, so a caller cannot touch another user's run by guessing its id.
 *
 * @returns true when the flag was written
 */
export async function setQueuedMessages(
  deps: OperationControlDeps,
  operationId: string,
  pending: boolean,
): Promise<boolean> {
  const metadata = await deps.coordinator.getOperationMetadata(operationId);
  if (!metadata || metadata.userId !== deps.userId) return false;

  await deps.coordinator.setQueuedMessages(operationId, pending);
  log('[%s] Queued messages flag set to %s', operationId, pending);
  return true;
}

/**
 * Whether follow-ups wait behind this run: the client's flag, or the
 * follow-ups queued server-side on the run's conversation (a top-level run
 * only — see `steerQueueScopeOf`). A failed read keeps the run going: the
 * follow-up still starts once the run ends, exactly as it did before the flag
 * existed, instead of failing the step.
 */
export async function readQueuedMessagesFlag(
  deps: OperationControlDeps,
  operationId: string,
  stepIndex: number,
  state?: AgentState,
): Promise<boolean> {
  try {
    if (await deps.coordinator.hasQueuedMessages(operationId)) return true;

    const scope = state && steerQueueScopeOf(state, deps.userId);
    return scope ? (await redisService.steerQueue.length(scope, operationId)) > 0 : false;
  } catch (error) {
    log('[%s][%d] Queued messages flag read failed: %O', operationId, stepIndex, error);
    return false;
  }
}

/**
 * Join the follow-ups queued behind this run into it, right before its next
 * LLM call, instead of ending the run and starting another for them. Hands off
 * to the owning layer (merge, access check, persisting the user message); the
 * caller re-enters the LLM on top of that message.
 *
 * Best-effort: any failure leaves the follow-ups queued, and the run hands its
 * turn back for them at this decision point as it did before.
 *
 * @returns the user message the follow-ups became, or `undefined` when none
 * were taken in
 */
export async function injectQueuedFollowUp(
  deps: OperationControlDeps,
  operationId: string,
  stepIndex: number,
  state: AgentState,
): Promise<{ messageId: string } | undefined> {
  const scope = steerQueueScopeOf(state, deps.userId);
  if (!scope || !deps.delegate.injectQueuedFollowUp) return;

  try {
    if ((await redisService.steerQueue.length(scope, operationId)) === 0) return;

    const injected = await deps.delegate.injectQueuedFollowUp({ operationId, scope, state });
    if (injected) {
      log(
        '[%s][%d] Joined queued follow-ups into the run as %s',
        operationId,
        stepIndex,
        injected.messageId,
      );
    }
    return injected;
  } catch (error) {
    log('[%s][%d] Joining queued follow-ups failed: %O', operationId, stepIndex, error);
    return;
  }
}

/** Review out-of-band results before any subsequent history read can expose them. */
export async function controlCompletedToolResult(
  deps: OperationControlDeps,
  input: DeferredToolResultControlInput,
) {
  const controlled = await controlDeferredToolResult(
    {
      dispatcher: hookDispatcher,
      loadState: (operationId) => deps.coordinator.loadAgentState(operationId),
      loadDurableHooks: (operationId) =>
        loadDurableToolResultHooks(deps.agentOperationModel, operationId),
      messageModel: deps.messageModel,
      userId: deps.userId,
      workspaceId: deps.workspaceId,
    },
    input,
  );
  return controlled;
}

/**
 * Publish a continuation that `executeStep` handed back instead of queueing.
 * The inline step loop calls this when it runs out of invocation budget, so
 * the remaining steps resume in a fresh invocation.
 */
export async function scheduleContinuation(
  deps: OperationControlDeps,
  continuation: AgentStepContinuation,
): Promise<void> {
  if (!deps.queueService) {
    throw new Error(
      `Cannot schedule continuation for ${continuation.operationId}: no queue service`,
    );
  }

  // The steps this invocation inlined are still only in memory — the
  // invocation that picks the run up reads the partial from the store, and
  // the gateway pushes it issued have nothing else to carry them.
  await deps.traceRecorder.flushPartial();
  await deps.streamManager.drainPushes?.(continuation.operationId);

  await deps.queueService.scheduleMessage({
    ...continuation,
    endpoint: `${deps.baseURL}/run`,
  });

  log('[%s] Handed step %d back to the queue', continuation.operationId, continuation.stepIndex);
}

/**
 * Release a lock that was retained across an inline step loop. Owner-scoped,
 * so it is a no-op when this invocation never held the lock.
 */
export async function releaseOperationLock(
  deps: OperationControlDeps,
  operationId: string,
  stepLockOwner: string,
): Promise<void> {
  await deps.coordinator.releaseStepLock(operationId, 0, stepLockOwner);
}

/**
 * Get operation status
 */
export async function getOperationStatus(
  deps: OperationControlDeps,
  params: {
    historyLimit?: number;
    includeHistory?: boolean;
    operationId: string;
  },
): Promise<OperationStatusResult | null> {
  const { operationId, includeHistory = false, historyLimit = 10 } = params;

  try {
    log('Getting operation status for %s', operationId);

    // Get current state and metadata
    const [currentState, operationMetadata] = await Promise.all([
      deps.coordinator.loadAgentState(operationId),
      deps.coordinator.getOperationMetadata(operationId),
    ]);

    // Operation may have expired or does not exist, return null
    if (!currentState || !operationMetadata) {
      log('Operation %s not found (may have expired)', operationId);
      return null;
    }

    // Get execution history (if needed)
    let executionHistory;
    if (includeHistory) {
      try {
        executionHistory = await deps.coordinator.getExecutionHistory(operationId, historyLimit);
      } catch (error) {
        log('Failed to load execution history: %O', error);
        executionHistory = [];
      }
    }

    // Get recent stream events (for debugging)
    let recentEvents;
    if (includeHistory) {
      try {
        recentEvents = await deps.streamManager.getStreamHistory(operationId, 20);
      } catch (error) {
        log('Failed to load recent events: %O', error);
        recentEvents = [];
      }
    }

    // Calculate operation statistics
    const stats = {
      lastActiveTime: operationMetadata.lastActiveAt
        ? Date.now() - new Date(operationMetadata.lastActiveAt).getTime()
        : 0,
      totalCost: currentState.cost?.total || 0,
      totalMessages: currentState.messages?.length || 0,
      totalSteps: getLlmCallCount(currentState),
      uptime: operationMetadata.createdAt
        ? Date.now() - new Date(operationMetadata.createdAt).getTime()
        : 0,
    };

    return {
      currentState: {
        cost: currentState.cost,
        costLimit: currentState.costLimit,
        error: currentState.error,
        interruption: currentState.interruption,
        lastModified: currentState.lastModified,
        maxSteps: currentState.maxSteps,
        pendingHumanPrompt: currentState.pendingHumanPrompt,
        pendingHumanSelect: currentState.pendingHumanSelect,
        pendingToolsCalling: currentState.pendingToolsCalling,
        status: currentState.status,
        stepCount: currentState.stepCount,
        usage: currentState.usage,
      },
      executionHistory: executionHistory?.slice(0, historyLimit),
      hasError: currentState.status === 'error',
      isActive: currentState.status === 'running' || isParkedStatus(currentState.status),
      isCompleted: currentState.status === 'done',
      metadata: operationMetadata,
      needsHumanInput: currentState.status === 'waiting_for_human',
      operationId,
      recentEvents: recentEvents?.slice(0, 10),
      stats,
    };
  } catch (error) {
    log('Failed to get operation status for %s: %O', operationId, error);
    throw error;
  }
}

/**
 * Explicitly start operation execution
 */
export async function startExecution(
  deps: OperationControlDeps,
  params: StartExecutionParams,
): Promise<StartExecutionResult> {
  const { operationId, context, priority = 'normal', delay = 50 } = params;

  try {
    log('Starting execution for operation %s', operationId);

    // Check if operation exists
    const operationMetadata = await deps.coordinator.getOperationMetadata(operationId);
    if (!operationMetadata) {
      throw new Error(`Operation ${operationId} not found`);
    }

    // Get current state
    const currentState = await deps.coordinator.loadAgentState(operationId);
    if (!currentState) {
      throw new Error(`Agent state not found for operation ${operationId}`);
    }

    // Check operation status
    if (currentState.status === 'running') {
      throw new Error(`Operation ${operationId} is already running`);
    }

    if (currentState.status === 'done') {
      throw new Error(`Operation ${operationId} is already completed`);
    }

    if (currentState.status === 'error') {
      throw new Error(`Operation ${operationId} is in error state`);
    }

    if (currentState.status === 'interrupted') {
      throw new Error(`Operation ${operationId} is interrupted`);
    }

    // Build execution context
    let executionContext = context;
    if (!executionContext) {
      // If no context provided, build default context from metadata
      // Note: AgentRuntimeContext requires sessionId for compatibility with @lobechat/agent-runtime
      executionContext = {
        payload: {
          isFirstMessage: true,
          message: [{ content: '' }],
        },
        phase: 'user_input' as const,
        session: {
          messageCount: currentState.messages?.length || 0,
          sessionId: operationId,
          status: 'idle' as const,
          stepCount: currentState.stepCount || 0,
        },
      };
    }

    // Update operation status to running
    await deps.coordinator.saveAgentState(operationId, {
      ...currentState,
      lastModified: new Date().toISOString(),
      status: 'running',
    });

    // Schedule execution (if queue service is available)
    let messageId: string | undefined;
    if (deps.queueService) {
      messageId = await deps.queueService.scheduleMessage({
        context: executionContext,
        delay,
        endpoint: `${deps.baseURL}/run`,
        operationId,
        priority,
        stepIndex: currentState.stepCount || 0,
      });
      log('Scheduled execution for operation %s (messageId: %s)', operationId, messageId);
    } else {
      log('Queue service disabled, skipping schedule for operation %s', operationId);
    }

    return {
      messageId,
      operationId,
      scheduled: !!messageId,
      success: true,
    };
  } catch (error) {
    log('Failed to start execution for operation %s: %O', operationId, error);
    throw error;
  }
}
