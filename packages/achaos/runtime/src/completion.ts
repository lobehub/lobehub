import type { RuntimeChaosController } from './controller';
import { delayWithAbort } from './effects';

export interface CompletionEvent {
  operationId: string;
  payload: unknown;
}

/** Applies deterministic drop/duplicate/delay effects to completion delivery. */
export const deliverCompletionWithChaos = async (
  controller: RuntimeChaosController,
  event: CompletionEvent,
  deliver: (event: CompletionEvent) => Promise<void>,
) => {
  const activations = controller.activationsFor({
    operationId: event.operationId,
    phase: 'completion',
  });
  let deliveries = 1;
  for (const { effect, markApplied, signal } of activations) {
    markApplied();
    if (effect.type === 'drop') return;
    if (effect.type === 'delay') await delayWithAbort(effect.durationMs, signal);
    if (effect.type === 'duplicate') deliveries = effect.count;
    if (effect.type === 'throw') throw new Error(effect.message ?? effect.errorType);
  }
  for (let index = 0; index < deliveries; index += 1) await deliver(event);
};
