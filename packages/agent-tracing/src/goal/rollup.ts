import { applyGraphDelta, buildGraphShape, reconstructFinalGraph } from './delta';
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
  /** Operations this goal put in flight — the join key count into `agent_operations`. */
  operationsTotal: number;
  startedAt: number;
  tasksCompleted: number;
  tasksRetired: number;
  ticksByBranch: Record<string, number>;
  ticksTotal: number;
}

const increment = (counter: Record<string, number>, key: string): void => {
  counter[key] = (counter[key] ?? 0) + 1;
};

interface GateMetrics {
  gatesOpened: number;
  gatesResolved: number;
  humanWaitingMs: number;
}

/**
 * Gate metrics, read from the recorded graph rather than from effects.
 *
 * Effects only exist where someone remembered to emit one, and the resolving
 * half never can: a person answers a gate through `goal.decide`, outside any
 * advance, so no tick is running to report it. The decision rows are in every
 * recorded graph state either way, so folding them forward sees both
 * transitions without the coordinator having to cooperate.
 *
 * Waiting time is measured between the tick that first saw the gate open and
 * the tick that first saw it answered. That is the wall time the goal actually
 * stood still — it starts when the coordinator stopped, not when the row was
 * written, and it ends when the coordinator noticed, not when the person
 * clicked. Both boundaries are what the goal experienced.
 */
const gateMetrics = (trajectory: GoalTrajectory): GateMetrics => {
  let state = trajectory.graphBaseline;
  const openedAt = new Map<string, number>();
  let gatesOpened = 0;
  let gatesResolved = 0;
  let humanWaitingMs = 0;

  const observe = (at: number) => {
    for (const decision of state.decisions) {
      if (decision.status === 'pending') {
        if (!openedAt.has(decision.id)) {
          openedAt.set(decision.id, at);
          gatesOpened += 1;
        }
        continue;
      }
      // Anything that is no longer pending has been answered — by a person, or
      // by the coordinator canceling it.
      const opened = openedAt.get(decision.id);
      if (opened === undefined) continue;
      openedAt.delete(decision.id);
      gatesResolved += 1;
      humanWaitingMs += Math.max(0, at - opened);
    }
  };

  for (const advance of trajectory.advances) {
    for (const tick of advance.ticks) {
      state = applyGraphDelta(state, tick.graphDelta);
      observe(tick.at);
    }
  }

  return { gatesOpened, gatesResolved, humanWaitingMs };
};

export const buildGoalTraceRollup = (trajectory: GoalTrajectory): GoalTraceRollup => {
  const advancesByTrigger: Record<string, number> = {};
  const advancesByOutcome: Record<string, number> = {};
  const ticksByBranch: Record<string, number> = {};

  let ticksTotal = 0;
  const operationIds = new Set<string>();

  for (const advance of trajectory.advances) {
    increment(advancesByTrigger, advance.trigger);

    // An advance's outcome is its last tick's — the one it stopped on.
    const last = advance.ticks.at(-1);
    if (last) increment(advancesByOutcome, last.outcome);

    ticksTotal += advance.ticks.length;
    for (const tick of advance.ticks) increment(ticksByBranch, tick.branch);
    for (const operationId of advance.childOperationIds ?? []) operationIds.add(operationId);
  }

  const finalGraph = reconstructFinalGraph(trajectory);
  const shape: GoalGraphShape = buildGraphShape(finalGraph);
  const gates = gateMetrics(trajectory);

  return {
    advancesByOutcome,
    advancesByTrigger,
    advancesTotal: trajectory.advances.length,
    completedAt: trajectory.completedAt,
    completionReason: trajectory.completionReason,
    findingsTotal: shape.findings,
    gatesOpened: gates.gatesOpened,
    gatesResolved: gates.gatesResolved,
    humanWaitingMs: gates.humanWaitingMs,
    nodesTotal: shape.nodesTotal,
    startedAt: trajectory.startedAt,
    ticksByBranch,
    ticksTotal,
    operationsTotal: operationIds.size,
    tasksCompleted: shape.tasksCompleted,
    tasksRetired: finalGraph.nodes.filter(
      (node) => node.kind === 'work' && node.status === 'retired',
    ).length,
  };
};
