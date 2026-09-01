import type {
  GoalGraphDelta,
  GoalGraphShape,
  GoalGraphState,
  GoalTraceDecision,
  GoalTraceEdge,
  GoalTraceNode,
  GoalTrajectory,
} from './types';

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));

const sameNode = (a: GoalTraceNode, b: GoalTraceNode): boolean =>
  a.kind === b.kind &&
  a.status === b.status &&
  a.title === b.title &&
  a.priority === b.priority &&
  (a.taskId ?? null) === (b.taskId ?? null) &&
  a.createdAt === b.createdAt;

const sameDecision = (a: GoalTraceDecision, b: GoalTraceDecision): boolean =>
  a.status === b.status &&
  a.question === b.question &&
  a.nodeId === b.nodeId &&
  (a.resolvedOptionId ?? null) === (b.resolvedOptionId ?? null);

const goalDelta = (
  previous: GoalGraphState['goal'],
  next: GoalGraphState['goal'],
): Partial<GoalGraphState['goal']> | undefined => {
  const changed: Partial<GoalGraphState['goal']> = {};
  for (const key of Object.keys(next) as (keyof GoalGraphState['goal'])[]) {
    if ((previous[key] ?? null) !== (next[key] ?? null)) {
      changed[key] = next[key] as never;
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
};

/**
 * Diff two graph states into the delta persisted on an advance.
 *
 * Only entities that actually moved are emitted. A goal that sits through a
 * sweep tick without changing produces an empty delta, which is what makes a
 * long-horizon trajectory cheap to keep in one object.
 */
export const computeGraphDelta = (
  previous: GoalGraphState,
  next: GoalGraphState,
): GoalGraphDelta | undefined => {
  const delta: GoalGraphDelta = {};

  const previousNodes = byId(previous.nodes);
  const nodesUpserted = next.nodes.filter((node) => {
    const before = previousNodes.get(node.id);
    return !before || !sameNode(before, node);
  });
  if (nodesUpserted.length > 0) delta.nodesUpserted = nodesUpserted;

  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const nodesRemoved = previous.nodes
    .filter((node) => !nextNodeIds.has(node.id))
    .map((node) => node.id);
  if (nodesRemoved.length > 0) delta.nodesRemoved = nodesRemoved;

  const previousEdgeIds = new Set(previous.edges.map((edge) => edge.id));
  const edgesAdded = next.edges.filter((edge) => !previousEdgeIds.has(edge.id));
  if (edgesAdded.length > 0) delta.edgesAdded = edgesAdded;

  const nextEdgeIds = new Set(next.edges.map((edge) => edge.id));
  const edgesRemoved = previous.edges
    .filter((edge) => !nextEdgeIds.has(edge.id))
    .map((edge) => edge.id);
  if (edgesRemoved.length > 0) delta.edgesRemoved = edgesRemoved;

  const previousDecisions = byId(previous.decisions);
  const decisionsUpserted = next.decisions.filter((decision) => {
    const before = previousDecisions.get(decision.id);
    return !before || !sameDecision(before, decision);
  });
  if (decisionsUpserted.length > 0) delta.decisionsUpserted = decisionsUpserted;

  const goal = goalDelta(previous.goal, next.goal);
  if (goal) delta.goal = goal;

  return Object.keys(delta).length > 0 ? delta : undefined;
};

const upsert = <T extends { id: string }>(items: T[], incoming: T[] | undefined): T[] => {
  if (!incoming?.length) return items;
  const merged = byId(items);
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
};

const remove = <T extends { id: string }>(items: T[], removed: string[] | undefined): T[] => {
  if (!removed?.length) return items;
  const gone = new Set(removed);
  return items.filter((item) => !gone.has(item.id));
};

/** Fold one delta onto a state. Pure — never mutates the input. */
export const applyGraphDelta = (state: GoalGraphState, delta?: GoalGraphDelta): GoalGraphState => {
  if (!delta) return state;

  const nodes = remove(upsert(state.nodes, delta.nodesUpserted), delta.nodesRemoved);
  const edges = remove(upsert<GoalTraceEdge>(state.edges, delta.edgesAdded), delta.edgesRemoved);

  return {
    decisions: upsert(state.decisions, delta.decisionsUpserted),
    edges,
    goal: delta.goal ? { ...state.goal, ...delta.goal } : state.goal,
    nodes,
  };
};

/**
 * The graph the coordinator read entering a given tick.
 *
 * Deltas are stored per tick as "what changed since the previous recorded
 * state", so folding the baseline through every tick up to and including the
 * target reproduces its decision input exactly — the same walk
 * `reconstructMessages` does over `messagesDelta`.
 */
export const reconstructGraphAt = (
  trajectory: GoalTrajectory,
  advanceSeq: number,
  tickIndex = 0,
): GoalGraphState => {
  let state = trajectory.graphBaseline;
  for (const advance of trajectory.advances) {
    if (advance.seq > advanceSeq) break;
    for (const tick of advance.ticks) {
      if (advance.seq === advanceSeq && tick.index > tickIndex) return state;
      state = applyGraphDelta(state, tick.graphDelta);
    }
  }
  return state;
};

/** Final graph state after every recorded tick. */
export const reconstructFinalGraph = (trajectory: GoalTrajectory): GoalGraphState =>
  trajectory.advances.reduce(
    (state, advance) =>
      advance.ticks.reduce((inner, tick) => applyGraphDelta(inner, tick.graphDelta), state),
    trajectory.graphBaseline,
  );

const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

/** Cheap shape metrics for one graph state. */
export const buildGraphShape = (state: GoalGraphState): GoalGraphShape => {
  const resolvedNodeIds = new Set(
    state.nodes.filter((node) => node.status === 'resolved').map((node) => node.id),
  );
  const work = state.nodes.filter((node) => node.kind === 'work');
  const open = work.filter((node) => !TERMINAL_NODE_STATUSES.has(node.status));

  const ready = open.filter((node) =>
    state.edges
      .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === node.id)
      .every((edge) => resolvedNodeIds.has(edge.targetNodeId)),
  );

  return {
    edgesTotal: state.edges.length,
    findings: state.nodes.filter((node) => node.kind === 'finding').length,
    gatesPending: state.decisions.filter((decision) => decision.status === 'pending').length,
    nodesTotal: state.nodes.length,
    tasksBlocked: open.length - ready.length,
    tasksOpen: open.length,
    tasksReady: ready.length,
    tasksCompleted: work.filter((node) => node.status === 'resolved').length,
  };
};
