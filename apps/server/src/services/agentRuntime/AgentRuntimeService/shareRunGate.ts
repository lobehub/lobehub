import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { type AgentExecutionResult } from '../types';
import type { AgentRuntimeService } from '.';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Terminate an Agent Share visitor run whose authorization was revoked
 * mid-flight (see the per-step check in `executeStep`).
 *
 * Persists `interrupted` onto the already-loaded state — the same terminal
 * status a visitor's own Stop produces — so the client's stream settles
 * normally instead of hanging. Falls back to `interruptOperation` when no
 * state was readable. A persistence failure is logged, never rethrown: the
 * run must stop regardless of whether the terminal status could be written.
 *
 * The completion lifecycle (`emitSignalEvents` + `dispatchHooks`) must run
 * here too: this abort short-circuits `executeStep` before `runtime.step()`,
 * so no downstream path is left to persist the terminal status. Without it
 * `saveAgentState` would only update the runtime-state cache and publish the
 * terminal stream event, leaving `agent_operations` stuck on `running` —
 * which `TopicModel.tryReserveTaskCallback` then reads as a live run and
 * blocks the visitor's next send on that topic for the abandoned-run TTL.
 */
export async function buildShareAbortResult(
  svc: AgentRuntimeService,
  operationId: string,
  state: AgentState | null | undefined,
): Promise<AgentExecutionResult> {
  log('[%s] Aborting share visitor run — the share is no longer authorized', operationId);

  try {
    if (state) {
      const interruptedState: AgentState = {
        ...state,
        lastModified: new Date().toISOString(),
        status: 'interrupted',
      };
      await svc.coordinator.saveAgentState(operationId, interruptedState);

      await svc.completionLifecycle.emitSignalEvents(operationId, interruptedState, 'interrupted');
      await svc.completionLifecycle.dispatchHooks(operationId, interruptedState, 'interrupted');
    } else {
      await svc.interruptOperation(operationId);
    }
  } catch (error) {
    log(
      '[%s] Failed to persist interrupted state for an aborted share run: %O',
      operationId,
      error,
    );
  }

  return {
    nextStepScheduled: false,
    state: { status: 'interrupted' },
    stepResult: null,
    success: false,
  };
}
