import type { RuntimeChaosController } from './controller';

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
  const effects = controller.effectsFor({ operationId: event.operationId, phase: 'completion' });
  let deliveries = 1;
  for (const effect of effects) {
    if (effect.type === 'drop') return;
    if (effect.type === 'delay')
      await new Promise((resolve) => setTimeout(resolve, effect.durationMs));
    if (effect.type === 'duplicate') deliveries = effect.count;
    if (effect.type === 'throw') throw new Error(effect.message ?? effect.errorType);
  }
  for (let index = 0; index < deliveries; index += 1) await deliver(event);
};
