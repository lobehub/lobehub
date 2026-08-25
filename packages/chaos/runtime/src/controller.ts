import type { ChaosEffect, ChaosInjectionReceipt, ChaosRunContext } from '@chaos/core';

export interface RuntimeChaosPoint {
  apiName?: string;
  callIndex?: number;
  operationId: string;
  phase: 'before_tool_call' | 'completion';
  stepIndex?: number;
}

interface ArmedFault {
  effect: ChaosEffect;
  injectionId: string;
  selector: Record<string, unknown>;
}

const matches = (point: RuntimeChaosPoint, selector: Record<string, unknown>) =>
  Object.entries(selector).every(([key, value]) => point[key as keyof RuntimeChaosPoint] === value);

/** Operation-scoped deterministic fault controller consumed by Runtime hook adapters. */
export class RuntimeChaosController {
  readonly #faults = new Map<string, ArmedFault>();

  arm(context: ChaosRunContext): ChaosInjectionReceipt {
    const injectionId = `${context.runId}:runtime`;
    this.#faults.set(injectionId, {
      effect: context.experiment.effect,
      injectionId,
      selector: context.experiment.target.selector,
    });
    return { adapter: 'runtime', cleanupToken: { injectionId }, injectionId };
  }

  disarm(receipt: ChaosInjectionReceipt) {
    const injectionId = receipt.cleanupToken?.injectionId;
    if (typeof injectionId === 'string') this.#faults.delete(injectionId);
  }

  effectsFor(point: RuntimeChaosPoint) {
    return [...this.#faults.values()]
      .filter(({ selector }) => matches(point, selector))
      .map(({ effect }) => effect);
  }
}
