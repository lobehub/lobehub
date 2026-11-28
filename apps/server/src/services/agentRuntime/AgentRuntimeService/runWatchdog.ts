import debug from 'debug';

import type { AgentExecutionParams } from '../types';
import type { AgentRuntimeServiceContext } from './types';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type RunWatchdogDeps = Pick<AgentRuntimeServiceContext, 'baseURL' | 'queueService'>;

/**
 * Deadline payloads a watchdog delivery can carry. Each is handled by
 * `runLockFreeDelivery` without claiming the step lock of the run it guards.
 */
export type RunWatchdogPayload = Pick<
  AgentExecutionParams,
  'groupMemberTimeout' | 'subAgentTimeout'
>;

/**
 * Schedule a delayed `/run` delivery that enforces a child run's deadline
 * (group member or `callSubAgent` sub-agent). The delivery is keyed on the
 * guarded run so the `/run` worker resolves the user from its metadata, the
 * same trust chain as every other scheduled step.
 *
 * Best-effort and a no-op when the queue is disabled (in-process local mode)
 * or the delay is non-positive: a failed schedule must not fail the dispatch
 * that started the child.
 */
export async function scheduleRunWatchdog(
  deps: RunWatchdogDeps,
  params: { delayMs: number; operationId: string; payload: RunWatchdogPayload },
): Promise<void> {
  const { delayMs, operationId, payload } = params;
  if (!deps.queueService || !(delayMs > 0)) return;
  try {
    await deps.queueService.scheduleMessage({
      context: undefined,
      delay: delayMs,
      endpoint: `${deps.baseURL}/run`,
      operationId,
      payload,
      priority: 'normal',
      stepIndex: 0,
    });
    log('[%s] scheduled run watchdog in %dms (%s)', operationId, delayMs, Object.keys(payload));
  } catch (error) {
    log('[%s] failed to schedule run watchdog (non-fatal): %O', operationId, error);
  }
}
