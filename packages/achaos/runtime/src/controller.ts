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
  claims: number;
  detachParentAbort: () => void;
  effect: ChaosEffect;
  injectionId: string;
  maxInjections: number;
  selector: Record<string, unknown>;
}

export interface RuntimeChaosActivation {
  effect: ChaosEffect;
  markApplied: () => void;
  release: () => void;
  signal: AbortSignal;
}

const matches = (point: RuntimeChaosPoint, selector: Record<string, unknown>) =>
  Object.entries(selector).every(([key, value]) => point[key as keyof RuntimeChaosPoint] === value);

const supports = (phase: RuntimeChaosPoint['phase'], effect: ChaosEffect) => {
  if (phase === 'before_tool_call')
    return effect.type === 'delay' || effect.type === 'drop' || effect.type === 'replace_result';
  if (phase === 'completion')
    return (
      effect.type === 'delay' ||
      effect.type === 'drop' ||
      effect.type === 'duplicate' ||
      effect.type === 'throw'
    );
  return effect.type === 'delay' || effect.type === 'drop' || effect.type === 'throw';
};

/** Operation-scoped deterministic fault controller consumed by Runtime hook adapters. */
export class RuntimeChaosController {
  readonly #faults = new Map<string, ArmedFault>();

  arm(context: ChaosRunContext): ChaosInjectionReceipt {
    const injectionId = `${context.runId}:runtime`;
    const abort = new AbortController();
    const onParentAbort = () => {
      abort.abort(context.signal.reason);
      this.#faults.delete(injectionId);
    };
    context.signal.addEventListener('abort', onParentAbort, { once: true });
    this.#faults.set(injectionId, {
      abort,
      activations: 0,
      claims: 0,
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

  cancelRun(runId: string) {
    const fault = this.#faults.get(`${runId}:runtime`);
    if (!fault) return;
    this.disarm({
      adapter: 'runtime',
      cleanupToken: { injectionId: fault.injectionId },
      injectionId: fault.injectionId,
    });
  }

  wasActivated(receipt: ChaosInjectionReceipt) {
    const injectionId = receipt.cleanupToken?.injectionId;
    return typeof injectionId === 'string' && (this.#faults.get(injectionId)?.activations ?? 0) > 0;
  }

  activationsFor(point: RuntimeChaosPoint): RuntimeChaosActivation[] {
    const activations: RuntimeChaosActivation[] = [];
    for (const [injectionId, fault] of this.#faults) {
      if (fault.abort.signal.aborted) {
        fault.detachParentAbort();
        this.#faults.delete(injectionId);
        continue;
      }
      if (
        !matches(point, fault.selector) ||
        !supports(point.phase, fault.effect) ||
        fault.claims >= fault.maxInjections
      )
        continue;
      fault.claims += 1;
      let applied = false;
      activations.push({
        effect: fault.effect,
        markApplied: () => {
          if (applied) return;
          applied = true;
          fault.activations += 1;
        },
        release: () => {
          if (applied) return;
          applied = true;
          fault.claims -= 1;
        },
        signal: fault.abort.signal,
      });
      break;
    }
    return activations;
  }
}
