import type {
  FrontierCandidate,
  GoalBudgetState,
  GoalTickBranch,
  GoalTickOutcome,
} from '@lobechat/agent-tracing';
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalGraphNode, GoalGraphSnapshot, TaskItem } from '@lobechat/types';

export { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';

/** Reason strings the recovery paths key off, written by the settle path. */
export const LEASE_EXPIRED_ERROR = 'Goal Task operation lease expired.';
export const VERIFICATION_FAILED_ERROR = 'Delivery did not pass verification.';

export const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

export interface FrontierSelection {
  /** Every eligible task node, best first — the trace-shaped view. */
  candidates: FrontierCandidate[];
  /** The first unblocked node, kept for callers that only need the head. */
  chosen?: GoalGraphNode;
  /** The same ranking, carrying the nodes the scheduler has to walk. */
  eligible: Array<{ blockedBy: string[]; node: GoalGraphNode }>;
}

/**
 * Rank the task nodes that could run right now.
 *
 * Split out of the decision so the caller can resolve the chosen node's task
 * before deciding, and exported so a trace keeps the whole ranking rather than
 * only the winner — "why not that node" is unanswerable from the winner alone.
 */
export const selectFrontier = (graph: GoalGraphSnapshot): FrontierSelection => {
  const resolvedNodeIds = new Set(
    graph.nodes.filter((node) => node.status === 'resolved').map((node) => node.id),
  );

  const eligible = graph.nodes
    .filter((node) => node.kind === 'task' && !TERMINAL_NODE_STATUSES.has(node.status))
    .map((node) => ({
      blockedBy: graph.edges
        .filter(
          (edge) =>
            edge.kind === 'depends_on' &&
            edge.sourceNodeId === node.id &&
            !resolvedNodeIds.has(edge.targetNodeId),
        )
        .map((edge) => edge.targetNodeId),
      node,
    }))
    .sort(
      (a, b) =>
        b.node.priority - a.node.priority ||
        a.node.createdAt.getTime() - b.node.createdAt.getTime(),
    );

  return {
    candidates: eligible.map(({ blockedBy, node }) => ({
      blockedBy,
      nodeId: node.id,
      priority: node.priority,
      status: node.status,
      title: node.title,
    })),
    chosen: eligible.find(({ blockedBy }) => blockedBy.length === 0)?.node,
    eligible,
  };
};

/**
 * Whether the coordinator would spend money on this task, and therefore whether
 * the budget has to be read before deciding.
 *
 * Every other task status resolves to a branch that costs nothing, so a goal
 * that is merely waiting on a running Task does not pay for a budget query on
 * every sweep.
 */
export const needsBudget = (task?: TaskItem | null): boolean => {
  // A candidate with no task yet will need one created and then dispatched.
  if (task === undefined) return true;
  if (task === null) return false;
  // A failure the coordinator can retry spends money too.
  if (task.status === 'paused') {
    return task.error === LEASE_EXPIRED_ERROR || task.error === VERIFICATION_FAILED_ERROR;
  }
  return !['completed', 'failed', 'canceled', 'running', 'scheduled'].includes(task.status);
};

/**
 * Whether *any* unblocked candidate could start paid work this tick.
 *
 * Asking only about the frontier's head was safe while the head was the only
 * thing that could be dispatched. Now that the scheduler walks past a running
 * head to start an independent task, keying the budget off the head would let a
 * goal spend past `maxRounds` / `maxTotalCost`: the head reports "no budget
 * needed", the budget is never read, and `budget_exhausted` cannot fire.
 */
export const frontierNeedsBudget = (
  frontier: FrontierSelection,
  tasksById: Map<string, TaskItem>,
): boolean =>
  frontier.eligible.some(({ blockedBy, node }) => {
    if (blockedBy.length > 0) return false;
    if (!node.taskId) return true;
    return needsBudget(tasksById.get(node.taskId) ?? null);
  });

export interface GoalMoveInput {
  /** Required only when {@link needsBudget} says the branch could dispatch or recover. */
  budget?: GoalBudgetState;
  /** How many of this goal's Tasks may be in flight at once. */
  concurrency: number;
  frontier: FrontierSelection;
  graph: GoalGraphSnapshot;
  /**
   * The responsible Task of every candidate that has one, keyed by task id.
   * A candidate whose task id is absent from the map has lost its row.
   */
  tasksById: Map<string, TaskItem>;
}

/** Task statuses that occupy a concurrency slot. */
const IN_FLIGHT_STATUSES = new Set(['running', 'scheduled']);

/**
 * Whether this candidate is one the coordinator is already waiting on, and so
 * neither actionable nor a reason to stop looking at the others.
 */
const isInFlight = (task: TaskItem | undefined): boolean =>
  Boolean(task && IN_FLIGHT_STATUSES.has(task.status));

export interface GoalMove {
  branch: GoalTickBranch;
  candidates: FrontierCandidate[];
  chosenNodeId?: string;
  /** The node this move is about when it is not the chosen frontier. */
  focusNodeId?: string;
  message: string;
  /**
   * The outcome this branch reports when it runs to completion. Recovery
   * branches can still end up elsewhere depending on how much budget is left,
   * which is why the trace records the actual outcome separately.
   */
  outcome: GoalTickOutcome;
  /** The responsible task this move is about, when it has one. */
  taskId?: string;
}

/**
 * The coordinator's decision, with no IO in it.
 *
 * `tick` used to interleave choosing and doing, so what it decided existed only
 * for as long as the call. Pulling the choice out means a trajectory can record
 * the decision surface and hand it back later: run this function over recorded
 * inputs and any change in coordinator policy shows up as a diff rather than as
 * a surprise on the next live goal.
 */
export const decideNextMove = ({
  budget,
  concurrency,
  frontier,
  graph,
  tasksById,
}: GoalMoveInput): GoalMove => {
  const { candidates, chosen } = frontier;
  const base = { candidates, chosenNodeId: chosen?.id };

  if (graph.goal.status === 'paused') {
    return { ...base, branch: 'goal_paused', message: 'Goal is paused', outcome: 'no_progress' };
  }
  if (graph.goal.status === 'achieved') {
    return {
      ...base,
      branch: 'goal_terminal',
      message: 'Goal is already achieved',
      outcome: 'achieved',
    };
  }
  if (graph.goal.status === 'failed' || graph.goal.status === 'canceled') {
    return {
      ...base,
      branch: 'goal_terminal',
      message: `Goal is ${graph.goal.status}`,
      outcome: 'failed',
    };
  }

  const pendingDecision = graph.decisions.find((decision) => decision.status === 'pending');
  if (pendingDecision) {
    return {
      ...base,
      branch: 'pending_decision',
      focusNodeId: pendingDecision.nodeId,
      message: pendingDecision.question,
      outcome: 'waiting_human',
    };
  }

  // Walk the whole ranked frontier rather than stopping at its head. Four bug
  // fixes that share no code have no reason to run one after another, and the
  // old single-node frontier made them: the running node stayed eligible, was
  // re-picked every tick, and reported `waiting_external`, which ends the
  // advance before anything behind it is even considered.
  const inFlight = graph.nodes.filter(
    (node) => node.kind === 'task' && isInFlight(tasksById.get(node.taskId ?? '')),
  ).length;

  let parked = false;
  let capacityBlocked = false;
  let waitingOn: { node: GoalGraphNode; task: TaskItem } | undefined;

  for (const candidate of frontier.eligible) {
    if (candidate.blockedBy.length > 0) continue;

    const task = candidate.node.taskId ? tasksById.get(candidate.node.taskId) : undefined;
    if (isInFlight(task)) {
      waitingOn ??= { node: candidate.node, task: task! };
      continue;
    }

    const move = decideForCandidate({
      budget,
      capacity: inFlight < concurrency,
      candidates,
      graph,
      node: candidate.node,
      task: candidate.node.taskId ? (task ?? null) : undefined,
    });

    if (move === 'needs-capacity') {
      capacityBlocked = true;
      continue;
    }
    if (move === 'parked') {
      parked = true;
      continue;
    }
    return move;
  }

  if (!chosen) return decideWithoutFrontier(graph, candidates);

  // Everything eligible is either running, parked on a person, or waiting for a
  // slot. Report which, so the row does not read as stalled when it is simply
  // saturated.
  if (waitingOn || capacityBlocked) {
    return {
      ...base,
      branch: 'task_running',
      chosenNodeId: waitingOn?.node.id ?? base.chosenNodeId,
      message: capacityBlocked
        ? `${inFlight} task(s) running at the concurrency limit of ${concurrency}`
        : `Task ${waitingOn!.task.identifier} is ${waitingOn!.task.status}`,
      outcome: 'waiting_external',
      taskId: waitingOn?.task.id,
    };
  }
  if (parked) {
    return {
      ...base,
      branch: 'task_paused',
      message: 'Every ready task is paused',
      outcome: 'waiting_human',
    };
  }

  return decideWithoutFrontier(graph, candidates);
};

/** What one candidate wants, or why it cannot be acted on right now. */
type CandidateMove = GoalMove | 'needs-capacity' | 'parked';

const decideForCandidate = ({
  budget,
  capacity,
  candidates,
  graph,
  node,
  task,
}: {
  budget?: GoalBudgetState;
  capacity: boolean;
  candidates: FrontierCandidate[];
  graph: GoalGraphSnapshot;
  node: GoalGraphNode;
  task: TaskItem | null | undefined;
}): CandidateMove => {
  const base = { candidates, chosenNodeId: node.id };

  if (task === undefined) {
    if (!capacity) return 'needs-capacity';
    return {
      ...base,
      branch: 'create_task',
      message: `Task "${node.title}" has no responsible task yet`,
      outcome: 'advanced',
    };
  }

  if (task === null) {
    return {
      ...base,
      branch: 'missing_task',
      message: 'Responsible task is missing',
      outcome: 'failed',
    };
  }

  return decideForTask(base, task, budget, graph, capacity);
};

const decideWithoutFrontier = (
  graph: GoalGraphSnapshot,
  candidates: FrontierCandidate[],
): GoalMove => {
  const base = { candidates };
  const taskNodes = graph.nodes.filter((node) => node.kind === 'task');

  // A goal with no tasks at all has not been planned yet — decompose it into
  // explorable directions before anything runs, instead of parking it.
  if (taskNodes.length === 0) {
    return {
      ...base,
      branch: 'plan_decomposition',
      message: 'Goal has no tasks yet; plan its exploration structure first',
      outcome: 'advanced',
    };
  }

  const allTasksTerminal = taskNodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status));

  if (!allTasksTerminal) {
    // Nothing here moves without a person: every remaining Task is blocked and
    // nothing is running to unblock it.
    return {
      ...base,
      branch: 'no_frontier',
      message: 'No task node is ready; resolve its dependencies first',
      outcome: 'no_progress',
    };
  }

  const acceptanceTask = taskNodes.find((node) => node.title === GOAL_ACCEPTANCE_TASK_TITLE);

  if (graph.goal.requirement && !acceptanceTask) {
    return {
      ...base,
      branch: 'terminal_acceptance',
      message: 'Every Task finished; the Goal-level acceptance contract is next',
      outcome: 'advanced',
    };
  }
  if (graph.goal.requirement && acceptanceTask?.status !== 'resolved') {
    return {
      ...base,
      branch: 'terminal_acceptance',
      focusNodeId: acceptanceTask?.id,
      message: 'Goal-level acceptance did not pass',
      outcome: 'no_progress',
    };
  }
  return {
    ...base,
    branch: 'terminal_acceptance',
    message: 'Goal-level acceptance passed',
    outcome: 'achieved',
  };
};

const decideForTask = (
  base: { candidates: FrontierCandidate[]; chosenNodeId?: string },
  task: TaskItem,
  budget: GoalBudgetState | undefined,
  graph: GoalGraphSnapshot,
  capacity = true,
): CandidateMove => {
  if (task.status === 'completed') {
    return {
      ...base,
      branch: 'consume_completed',
      message: `Task ${task.identifier} completed`,
      outcome: 'advanced',
    };
  }

  if (
    task.status === 'failed' ||
    task.status === 'canceled' ||
    (task.status === 'paused' && task.error)
  ) {
    if (
      budget?.deadlinePassed &&
      task.status === 'paused' &&
      (task.error === LEASE_EXPIRED_ERROR || task.error === VERIFICATION_FAILED_ERROR)
    ) {
      return {
        ...base,
        branch: 'budget_exhausted',
        message: `Deadline passed (${graph.goal.config?.schedule?.deadline ?? 'unknown'}); no new Task will be dispatched`,
        outcome: 'no_progress',
      };
    }
    if (task.status === 'paused' && task.error === LEASE_EXPIRED_ERROR) {
      if (!capacity) return 'needs-capacity';
      return {
        ...base,
        branch: 'recover_lease',
        message: `Task ${task.identifier} outlived its operation lease`,
        outcome: 'waiting_external',
      };
    }
    if (task.status === 'paused' && task.error === VERIFICATION_FAILED_ERROR) {
      if (!capacity) return 'needs-capacity';
      return {
        ...base,
        branch: 'recover_verification',
        message: `Task ${task.identifier} did not pass verification`,
        outcome: 'waiting_external',
      };
    }
    return {
      ...base,
      branch: 'failure_decision',
      message: task.error ?? `Task ${task.status}`,
      outcome: 'waiting_human',
    };
  }

  // Parked on a person, and holding no slot. The goal has other Tasks.
  if (task.status === 'paused') return 'parked';

  // Callers filter these out before they get here; kept so the classification
  // stays total if a status slips through.
  if (task.status === 'running' || task.status === 'scheduled') return 'parked';

  if (budget?.deadlinePassed) {
    return {
      ...base,
      branch: 'budget_exhausted',
      message: `Deadline passed (${graph.goal.config?.schedule?.deadline ?? 'unknown'}); no new Task will be dispatched`,
      outcome: 'no_progress',
    };
  }

  if (budget?.deadlinePassed) {
    return {
      ...base,
      branch: 'budget_exhausted',
      message: `Deadline passed (${graph.goal.config?.schedule?.deadline ?? 'unknown'}); no new Task will be dispatched`,
      outcome: 'no_progress',
    };
  }

  if (budget?.roundLimitReached || budget?.costLimitReached) {
    return {
      ...base,
      branch: 'budget_exhausted',
      message: budget.roundLimitReached
        ? `Round budget reached (${budget.runs}/${graph.goal.maxRounds})`
        : `Cost budget reached ($${budget.totalCost.toFixed(4)}/$${graph.goal.maxTotalCost})`,
      outcome: 'no_progress',
    };
  }

  if (!capacity) return 'needs-capacity';

  // Dispatching is progress, not a stopping point: the advance should carry on
  // and fill the remaining slots rather than end after starting one Task.
  return {
    ...base,
    branch: 'dispatch_task',
    message: `Task ${task.identifier} is ready to run`,
    outcome: 'advanced',
  };
};
