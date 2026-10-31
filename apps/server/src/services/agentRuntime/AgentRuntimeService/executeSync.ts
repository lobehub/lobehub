import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { isParkedStatus } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { AgentRuntimeServiceContext } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type ExecuteSyncDeps = Pick<
  AgentRuntimeServiceContext,
  'completionLifecycle' | 'coordinator' | 'executeStep' | 'shouldContinueExecution'
>;

/**
 * Synchronously execute Agent operation until completion
 *
 * Used in test scenarios, doesn't depend on QueueService, executes all steps directly in the current process.
 *
 * @param operationId Operation ID
 * @param options Execution options
 * @returns Final state
 *
 * @example
 * ```ts
 * // Create operation (without auto-starting queue)
 * const result = await service.createOperation({ ...params, autoStart: false });
 *
 * // Synchronously execute to completion
 * const finalState = await service.executeSync(result.operationId);
 * expect(finalState.status).toBe('done');
 * ```
 */
export async function executeSync(
  deps: ExecuteSyncDeps,
  operationId: string,
  options?: {
    /** Initial context (if not provided, inferred from state) */
    initialContext?: AgentRuntimeContext;
    /** Maximum step limit to prevent infinite loops, defaults to 9999 */
    maxSteps?: number;
    /** Callback after each step execution (for debugging) */
    onStepComplete?: (stepIndex: number, state: AgentState) => void;
  },
): Promise<AgentState> {
  const { maxSteps = 999, onStepComplete, initialContext } = options ?? {};

  log('[%s] Starting sync execution (maxSteps: %d)', operationId, maxSteps);

  // Load initial state
  const initialState = await deps.coordinator.loadAgentState(operationId);
  if (!initialState) {
    throw new Error(`Agent state not found for operation ${operationId}`);
  }

  let state: AgentState = initialState;

  // Build initial context
  // Priority: explicit initialContext param > saved initialContext in state > default
  let context: AgentRuntimeContext | undefined =
    initialContext ??
    (state as any).initialContext ??
    ({
      payload: {},
      phase: 'user_input' as const,
      session: {
        messageCount: state.messages?.length ?? 0,
        sessionId: operationId,
        status: state.status,
        stepCount: state.stepCount,
      },
    } as AgentRuntimeContext);

  let stepIndex = state.stepCount;

  // Execution loop
  while (stepIndex < maxSteps) {
    // Check termination conditions
    if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
      log('[%s] Sync execution finished with status: %s', operationId, state.status);
      break;
    }

    // Parked on a pause (human intervention or an async tool / sub-agent
    // result) — the result is delivered out-of-band, so sync execution
    // can't resume it
    if (isParkedStatus(state.status)) {
      log('[%s] Sync execution paused: %s', operationId, state.status);
      break;
    }

    // Execute one step
    log('[%s][%d] Start executing...', operationId, stepIndex);
    const result = await deps.executeStep({
      context,
      operationId,
      stepIndex,
    });

    state = result.state as AgentState;
    context = result.stepResult.nextContext;
    stepIndex++;

    // Callback
    if (onStepComplete) {
      onStepComplete(stepIndex, state);
    }

    // Check if should continue
    if (!deps.shouldContinueExecution(state, context)) {
      log('[%s] Sync execution stopped: shouldContinue=false', operationId);
      break;
    }
  }

  if (stepIndex >= maxSteps) {
    log('[%s] Sync execution stopped: reached maxSteps (%d)', operationId, maxSteps);
    // If stopped due to executeSync's maxSteps limit, need to manually dispatch onComplete hooks
    // Note: If stopped due to state.maxSteps being reached, onComplete has already been called in executeStep
    if (state.status !== 'done' && state.status !== 'error') {
      await deps.completionLifecycle.emitSignalEvents(operationId, state, 'max_steps');
      await deps.completionLifecycle.dispatchHooks(operationId, state, 'max_steps');
    }
  }

  return state;
}
