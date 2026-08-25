import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export interface ToolAttemptChaosPoint {
  apiName: string;
  callIndex: number;
  operationId: string;
  stepIndex: number;
}

/** Wrap each executeToolWithRetry attempt so thrown faults exercise the real retry policy. */
export const executeToolAttemptWithChaos = async <Result>(
  controller: RuntimeChaosController,
  point: ToolAttemptChaosPoint,
  execute: () => Promise<Result>,
) => {
  const activations = controller.activationsFor({ ...point, phase: 'tool_attempt' });
  for (const { effect, signal } of activations) {
    if (effect.type === 'delay') await delayWithAbort(effect.durationMs, signal);
    if (effect.type === 'drop') throw new Error('Tool attempt dropped by chaos experiment');
    if (effect.type === 'throw') throw new Error(effect.message ?? effect.errorType);
  }
  return execute();
};
