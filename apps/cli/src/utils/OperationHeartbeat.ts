import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

const DEFAULT_OPERATION_HEARTBEAT_INTERVAL_MS = 30_000;

interface OperationHeartbeatOptions {
  intervalMs?: number;
  operationId: string;
  push: (event: AgentStreamEvent) => void;
}

/**
 * Keep a remote heterogeneous operation active while its CLI is legitimately
 * silent (for example, while a long-running shell command produces no output).
 *
 * The heartbeat rides `step_complete` with a dedicated phase because the
 * gateway worker lives outside this repository. Existing consumers already
 * ignore unknown phases, while the Redis stream write still renews the
 * gateway's inactivity watchdog.
 */
export const createOperationHeartbeat = ({
  intervalMs = DEFAULT_OPERATION_HEARTBEAT_INTERVAL_MS,
  operationId,
  push,
}: OperationHeartbeatOptions) => {
  let lastStepIndex = 0;

  const timer = setInterval(() => {
    push({
      data: { phase: 'operation_heartbeat' },
      operationId,
      stepIndex: lastStepIndex,
      timestamp: Date.now(),
      type: 'step_complete',
    });
  }, intervalMs);
  timer.unref?.();

  return {
    observe: (event: AgentStreamEvent) => {
      lastStepIndex = Math.max(lastStepIndex, event.stepIndex);
    },
    stop: () => clearInterval(timer),
  };
};
