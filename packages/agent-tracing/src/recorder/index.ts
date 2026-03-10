import type { ISnapshotStore } from '../store/types';
import type { ExecutionSnapshot, StepSnapshot } from '../types';

/**
 * Append a step to a partial snapshot on disk.
 * Called from the executeStep loop on each step completion.
 */
export async function appendStepToPartial(
  store: ISnapshotStore,
  operationId: string,
  step: StepSnapshot,
  metadata?: { model?: string; provider?: string },
): Promise<void> {
  const partial = (await store.loadPartial(operationId)) ?? { steps: [] };

  if (!partial.startedAt) {
    partial.startedAt = Date.now();
    partial.model = metadata?.model;
    partial.provider = metadata?.provider;
  }

  if (!partial.steps) partial.steps = [];
  partial.steps.push(step);

  await store.savePartial(operationId, partial);
}

/**
 * Finalize a partial snapshot into a completed ExecutionSnapshot.
 * Called from the executeStep loop when the operation completes.
 */
export async function finalizeSnapshot(
  store: ISnapshotStore,
  operationId: string,
  completion: {
    error?: { message: string; type: string };
    reason: string;
    totalCost: number;
    totalSteps: number;
    totalTokens: number;
  },
): Promise<void> {
  const partial = await store.loadPartial(operationId);
  if (!partial) return;

  const snapshot: ExecutionSnapshot = {
    completedAt: Date.now(),
    completionReason: completion.reason as ExecutionSnapshot['completionReason'],
    error: completion.error,
    model: partial.model,
    operationId,
    provider: partial.provider,
    startedAt: partial.startedAt ?? Date.now(),
    steps: (partial.steps ?? []).sort((a, b) => a.stepIndex - b.stepIndex),
    totalCost: completion.totalCost,
    totalSteps: completion.totalSteps,
    totalTokens: completion.totalTokens,
    traceId: operationId,
  };

  await store.save(snapshot);
  await store.removePartial(operationId);
}
