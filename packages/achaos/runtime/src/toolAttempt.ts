import type { ToolRunResult } from '@lobechat/agent-runtime/src/transport/tool';

import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export interface ToolAttemptChaosPoint {
  apiName: string;
  callIndex: number;
  operationId: string;
  stepIndex: number;
}

const failedAttempt = (
  message: string,
  errorType: string,
  kind: 'retry' | 'stop',
): ToolRunResult => ({
  content: JSON.stringify({ error: message, errorType }),
  error: { errorType, kind, message },
  success: false,
});

/** Wrap each executeToolWithRetry attempt so chaos faults exercise the real retry policy. */
export const executeToolAttemptWithChaos = async (
  controller: RuntimeChaosController,
  point: ToolAttemptChaosPoint,
  execute: () => Promise<ToolRunResult>,
): Promise<ToolRunResult> => {
  const activations = controller.activationsFor({ ...point, phase: 'tool_attempt' });
  for (const { effect, markApplied, signal } of activations) {
    markApplied();
    if (effect.type === 'delay') {
      try {
        await delayWithAbort(effect.durationMs, signal);
      } catch {
        return failedAttempt(
          'Tool attempt canceled while chaos delay was active',
          'Canceled',
          'stop',
        );
      }
    }
    if (effect.type === 'drop')
      return failedAttempt(
        'Tool attempt dropped by chaos experiment',
        'ChaosDroppedToolCall',
        'retry',
      );
    if (effect.type === 'throw')
      return failedAttempt(effect.message ?? effect.errorType, effect.errorType, 'retry');
  }
  return execute();
};
