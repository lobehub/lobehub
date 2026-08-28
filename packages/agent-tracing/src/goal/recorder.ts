import { buildGraphShape, computeGraphDelta, reconstructFinalGraph } from './delta';
import { partialToTrajectory } from './store/file-store';
import type { IGoalTraceStore } from './store/types';
import type {
  GoalAdvanceSnapshot,
  GoalAdvanceTrigger,
  GoalGraphState,
  GoalTickSnapshot,
  GoalTrajectory,
} from './types';

/**
 * One tick as the coordinator reports it. `graphState` is the full graph it
 * read on entry; the recorder turns consecutive states into the stored deltas,
 * so callers never have to remember what the previous tick saw.
 */
export interface RecordTickInput extends Omit<
  GoalTickSnapshot,
  'graphDelta' | 'graphShape' | 'index'
> {
  graphState: GoalGraphState;
}

export interface RecordAdvanceInput {
  childOperationIds?: string[];
  completedAt?: number;
  error?: { message: string; type: string };
  startedAt: number;
  ticks: RecordTickInput[];
  trigger: GoalAdvanceTrigger;
}

/**
 * Append one advance to a goal's in-progress trajectory.
 *
 * Deltas are computed here rather than by the caller because advances run in
 * separate processes — a QStash worker holds no memory of the previous one. The
 * partial is the only place the prior state exists, so folding it forward is
 * also what keeps a graph edit made outside an advance (a work node added from
 * the UI between two advances) inside the trace instead of vanishing between
 * two states.
 */
export const appendAdvanceToPartial = async (
  store: IGoalTraceStore,
  goalId: string,
  input: RecordAdvanceInput,
): Promise<GoalTrajectory | null> => {
  if (input.ticks.length === 0) return null;

  const partial = (await store.loadPartial(goalId)) ?? {};
  const advances = partial.advances ?? [];
  const baseline = partial.graphBaseline ?? input.ticks[0].graphState;

  let previousState: GoalGraphState = partial.graphBaseline
    ? reconstructFinalGraph(partialToTrajectory(goalId, partial))
    : baseline;

  const ticks: GoalTickSnapshot[] = input.ticks.map((tick, index) => {
    const { graphState, ...rest } = tick;
    const snapshot: GoalTickSnapshot = {
      ...rest,
      graphDelta: computeGraphDelta(previousState, graphState),
      graphShape: buildGraphShape(graphState),
      index,
    };
    previousState = graphState;
    return snapshot;
  });

  const completedAt = input.completedAt ?? Date.now();
  const advance: GoalAdvanceSnapshot = {
    childOperationIds: input.childOperationIds?.length ? input.childOperationIds : undefined,
    completedAt,
    durationMs: completedAt - input.startedAt,
    error: input.error,
    seq: advances.length,
    startedAt: input.startedAt,
    ticks,
    trigger: input.trigger,
  };

  const updated: Partial<GoalTrajectory> = {
    ...partial,
    advances: [...advances, advance],
    goalId,
    graphBaseline: baseline,
    startedAt: partial.startedAt ?? input.startedAt,
    title: partial.title ?? previousState.goal.title,
    traceId: partial.traceId ?? goalId,
  };
  await store.savePartial(goalId, updated);

  // Returned whole rather than as the appended advance alone: the caller needs
  // the accumulated run to derive the observation row, and re-reading the
  // object it just wrote would cost another round trip to storage.
  return partialToTrajectory(goalId, updated);
};

export interface FinalizeGoalTraceInput {
  completedAt?: number;
  completionReason: string;
}

/**
 * Promote the partial into the finalized trajectory.
 *
 * Called when the goal reaches a terminal status. A goal that never terminates
 * keeps its partial, which `get()` still serves — an unfinished long-horizon
 * goal is the normal thing to inspect, not an error.
 */
export const finalizeGoalTrace = async (
  store: IGoalTraceStore,
  goalId: string,
  input: FinalizeGoalTraceInput,
): Promise<GoalTrajectory | null> => {
  const partial = await store.loadPartial(goalId);
  if (!partial) return null;

  const trajectory: GoalTrajectory = {
    ...partialToTrajectory(goalId, partial),
    completedAt: input.completedAt ?? Date.now(),
    completionReason: input.completionReason,
  };

  await store.save(trajectory);
  await store.removePartial(goalId);
  return trajectory;
};
