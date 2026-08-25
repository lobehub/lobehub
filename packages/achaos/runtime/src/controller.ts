import type { ChaosEffect, ChaosInjectionReceipt, ChaosRunContext } from '@achaos/core';

export interface RuntimeChaosPoint {
  apiName?: string;
  callIndex?: number;
  operationId: string;
  phase: 'before_tool_call' | 'completion' | 'tool_attempt';
  stepIndex?: number;
}

interface ArmedFault {
  abort: AbortController;
  activations: number;
  detachParentAbort: () => void;
  effect: ChaosEffect;
  injectionId: string;
  maxInjections: number;
  selector: Record<string, unknown>;
}

export interface RuntimeChaosActivation {
  effect: ChaosEffect;
  signal: AbortSignal;
}

const matches = (point: RuntimeChaosPoint, selector: Record<string, unknown>) =>
  Object.entries(selector).every(([key, value]) => point[key as keyof RuntimeChaosPoint] === value);

/** Operation-scoped deterministic fault controller consumed by Runtime hook adapters. */
export class RuntimeChaosController {
  readonly #faults = new Map<string, ArmedFault>();

  arm(context: ChaosRunContext): ChaosInjectionReceipt {
    const injectionId = `${context.runId}:runtime`;
    const abort = new AbortController();
    const onParentAbort = () => abort.abort(context.signal.reason);
    context.signal.addEventListener('abort', onParentAbort, { once: true });
    this.#faults.set(injectionId, {
      abort,
      activations: 0,
      detachParentAbort: () => context.signal.removeEventListener('abort', onParentAbort),
      effect: context.experiment.effect,
      injectionId,
      maxInjections: context.experiment.safety.maxInjections ?? Number.POSITIVE_INFINITY,
      selector: context.experiment.target.selector,
    });
    return { adapter: 'runtime', cleanupToken: { injectionId }, injectionId };
  }

  disarm(receipt: ChaosInjectionReceipt) {
    const injectionId = receipt.cleanupToken?.injectionId;
    if (typeof injectionId !== 'string') return;
    const fault = this.#faults.get(injectionId);
    if (!fault) return;
    fault.abort.abort(new Error('Chaos fault disarmed'));
    fault.detachParentAbort();
    this.#faults.delete(injectionId);
  }

  wasActivated(receipt: ChaosInjectionReceipt) {
    const injectionId = receipt.cleanupToken?.injectionId;
    return typeof injectionId === 'string' && (this.#faults.get(injectionId)?.activations ?? 0) > 0;
  }

  activationsFor(point: RuntimeChaosPoint): RuntimeChaosActivation[] {
    const activations: RuntimeChaosActivation[] = [];
    for (const fault of this.#faults.values()) {
      if (!matches(point, fault.selector) || fault.activations >= fault.maxInjections) continue;
      fault.activations += 1;
      activations.push({ effect: fault.effect, signal: fault.abort.signal });
    }
    return activations;
  }
}
