import type { ToolRunResult } from '@lobechat/agent-runtime/src/transport/tool';

import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export interface ToolAttemptChaosPoint {
  apiName: string;
  callIndex: number;
  operationId: string;
  stepIndex: number;
}

const retryableFailure = (message: string, errorType: string): ToolRunResult => ({
  content: JSON.stringify({ error: message, errorType }),
  error: { errorType, kind: 'retry', message },
  success: false,
});

/** Wrap each executeToolWithRetry attempt so chaos faults exercise the real retry policy. */
export const executeToolAttemptWithChaos = async (
  controller: RuntimeChaosController,
  point: ToolAttemptChaosPoint,
  execute: () => Promise<ToolRunResult>,
): Promise<ToolRunResult> => {
  const activations = controller.activationsFor({ ...point, phase: 'tool_attempt' });
  for (const { effect, signal } of activations) {
    if (effect.type === 'delay') {
      try {
        await delayWithAbort(effect.durationMs, signal);
      } catch {
        return retryableFailure('Tool attempt canceled while chaos delay was active', 'Canceled');
      }
    }
    if (effect.type === 'drop')
      return retryableFailure('Tool attempt dropped by chaos experiment', 'ChaosDroppedToolCall');
    if (effect.type === 'throw')
      return retryableFailure(effect.message ?? effect.errorType, effect.errorType);
  }
  return execute();
};
