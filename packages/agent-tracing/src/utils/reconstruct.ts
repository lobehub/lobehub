import type { ExecutionSnapshot, StepSnapshot } from '../types';

/**
 * Check whether a snapshot uses the incremental (delta) format.
 */
export function isIncrementalFormat(snapshot: ExecutionSnapshot): boolean {
  return snapshot.steps.some((s) => s.messagesDelta !== undefined);
}

/**
 * Reconstruct full `messages` (before step) and `messagesAfter` (after step)
 * from incremental baseline + delta chain.
 */
export function reconstructMessages(
  steps: StepSnapshot[],
  targetStepIndex: number,
): { messages: any[]; messagesAfter: any[] } {
  let current: any[] = [];

  for (const step of steps) {
    if (step.stepIndex > targetStepIndex) break;

    // Reset to baseline when present (step 0 or compression)
    if (step.messagesBaseline) {
      current = [...step.messagesBaseline];
    }

    const beforeStep = [...current];

    // Apply delta
    if (step.messagesDelta) {
      current = [...current, ...step.messagesDelta];
    }

    if (step.stepIndex === targetStepIndex) {
      return { messages: beforeStep, messagesAfter: current };
    }
  }

  return { messages: current, messagesAfter: current };
}

/**
 * Reconstruct the operation-level toolset baseline from snapshot steps.
 * Returns the `operationToolSet` stored at step 0.
 */
export function reconstructToolsetBaseline(steps: StepSnapshot[]): any | undefined {
  return steps.find((s) => s.toolsetBaseline)?.toolsetBaseline;
}

/**
 * Reconstruct cumulative `activatedStepTools` up to a given step
 * from per-step deltas.
 */
export function reconstructActivatedStepTools(
  steps: StepSnapshot[],
  targetStepIndex: number,
): any[] {
  const accumulated: any[] = [];

  for (const step of steps) {
    if (step.stepIndex > targetStepIndex) break;

    if (step.activatedStepToolsDelta) {
      accumulated.push(...step.activatedStepToolsDelta);
    }
  }

  return accumulated;
}

/**
 * Expand an incremental snapshot into legacy full-messages format.
 * Useful for backward-compatible tooling.
 */
export function expandSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  if (!isIncrementalFormat(snapshot)) return snapshot;

  return {
    ...snapshot,
    steps: snapshot.steps.map((step) => {
      const { messages, messagesAfter } = reconstructMessages(snapshot.steps, step.stepIndex);
      return { ...step, messages, messagesAfter };
    }),
  };
}
