import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';

import type { CompletionLifecycle } from './CompletionLifecycle';
import type { AgentExecutionResult } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** `AgentRuntimeDelegate.verifyShareRunStillAuthorized`. */
type VerifyShareRunStillAuthorized = (params: {
  agentId: string;
  shareId: string;
}) => Promise<boolean>;

/**
 * Whether an Agent Share visitor run has lost its authorization. Fails closed:
 * a read failure is treated as revoked. Non-share runs are never revoked.
 */
export const isShareRunRevoked = async (
  verify: VerifyShareRunStillAuthorized | undefined,
  operationId: string,
  stepIndex: number,
  agentState: AgentState,
): Promise<boolean> => {
  if (!verify) return false;
  const shareMarker = agentState.principal?.actor?.shareVisitor as
    { agentId?: string; shareId?: string } | undefined;
  if (!shareMarker?.agentId || !shareMarker.shareId) return false;
  try {
    return !(await verify({ agentId: shareMarker.agentId, shareId: shareMarker.shareId }));
  } catch (error) {
    log('[%s][%d] Share run authorization re-check failed: %O', operationId, stepIndex, error);
    return true;
  }
};

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
export const abortShareRun = async (
  deps: {
    completionLifecycle: CompletionLifecycle;
    coordinator: AgentRuntimeCoordinator;
    interruptOperation: (operationId: string) => Promise<unknown>;
  },
  operationId: string,
  state: AgentState | null | undefined,
): Promise<AgentExecutionResult> => {
  log('[%s] Aborting share visitor run — the share is no longer authorized', operationId);

  try {
    if (state) {
      const interruptedState: AgentState = {
        ...state,
        lastModified: new Date().toISOString(),
        status: 'interrupted',
      };
      await deps.coordinator.saveAgentState(operationId, interruptedState);

      await deps.completionLifecycle.emitSignalEvents(operationId, interruptedState, 'interrupted');
      await deps.completionLifecycle.dispatchHooks(operationId, interruptedState, 'interrupted');
    } else {
      await deps.interruptOperation(operationId);
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
};
