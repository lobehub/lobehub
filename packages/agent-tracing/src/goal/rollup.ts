import { buildGraphShape, reconstructFinalGraph } from './delta';
import type { GoalGraphShape, GoalTrajectory } from './types';

/**
 * The `goal_traces` row for a trajectory.
 *
 * Everything here is a scalar or a small bucket count — the analytics surface.
 * Per-advance detail (the graph at each tick, the budget it read, the frontier
 * candidates it passed over) stays in the trajectory object, the same way an
 * operation's messages stay in its `ExecutionSnapshot` rather than on
 * `agent_operations`.
 */
export interface GoalTraceRollup {
  advancesByOutcome: Record<string, number>;
  advancesByTrigger: Record<string, number>;
  advancesTotal: number;
  completedAt?: number;
  completionReason?: string;
  findingsTotal: number;
  gatesOpened: number;
  gatesResolved: number;
  /** Wall time a goal spent parked on a human, summed across gates. */
  humanWaitingMs: number;
  nodesTotal: number;
  startedAt: number;
  ticksByBranch: Record<string, number>;
  ticksTotal: number;
  /** Operations this goal put in flight — the join key count into `agent_operations`. */
  workOperations: number;
  workResolved: number;
  workRetired: number;
}

const increment = (counter: Record<string, number>, key: string): void => {
  counter[key] = (counter[key] ?? 0) + 1;
};

/**
 * Time parked on a person: from the advance that opened a gate to the advance
 * that a human's decision triggered. Derived rather than measured because the
 * gate rows carry `resolvedAt` but nothing records when the coordinator
 * actually stopped, and it is the stop that costs wall time.
 */
const humanWaiting = (trajectory: GoalTrajectory): number => {
  let total = 0;
  let openedAt: number | undefined;

  for (const advance of trajectory.advances) {
    if (openedAt !== undefined && advance.trigger === 'decide') {
      total += advance.startedAt - openedAt;
      openedAt = undefined;
    }
    const opened = advance.effects.some((effect) => effect.type === 'opened_decision');
    if (opened) openedAt = advance.completedAt;
  }
  return total;
};

export const buildGoalTraceRollup = (trajectory: GoalTrajectory): GoalTraceRollup => {
  const advancesByTrigger: Record<string, number> = {};
  const advancesByOutcome: Record<string, number> = {};
  const ticksByBranch: Record<string, number> = {};

  let ticksTotal = 0;
  let gatesOpened = 0;
  let gatesResolved = 0;
  const operationIds = new Set<string>();

  for (const advance of trajectory.advances) {
    increment(advancesByTrigger, advance.trigger);

    // An advance's outcome is its last tick's — the one it stopped on.
    const last = advance.ticks.at(-1);
    if (last) increment(advancesByOutcome, last.outcome);

    ticksTotal += advance.ticks.length;
    for (const tick of advance.ticks) increment(ticksByBranch, tick.branch);

    for (const effect of advance.effects) {
      if (effect.type === 'opened_decision') gatesOpened += 1;
      if (effect.type === 'resolved_decision') gatesResolved += 1;
    }
    for (const operationId of advance.childOperationIds ?? []) operationIds.add(operationId);
  }

  const shape: GoalGraphShape = buildGraphShape(reconstructFinalGraph(trajectory));
  const finalGraph = reconstructFinalGraph(trajectory);

  return {
    advancesByOutcome,
    advancesByTrigger,
    advancesTotal: trajectory.advances.length,
    completedAt: trajectory.completedAt,
    completionReason: trajectory.completionReason,
    findingsTotal: shape.findings,
    gatesOpened,
    gatesResolved,
    humanWaitingMs: humanWaiting(trajectory),
    nodesTotal: shape.nodesTotal,
    startedAt: trajectory.startedAt,
    ticksByBranch,
    ticksTotal,
    workOperations: operationIds.size,
    workResolved: shape.workResolved,
    workRetired: finalGraph.nodes.filter(
      (node) => node.kind === 'work' && node.status === 'retired',
    ).length,
  };
};
