import type {
  FrontierCandidate,
  GoalBudgetState,
  GoalTickBranch,
  GoalTickOutcome,
} from '@lobechat/agent-tracing';
import type { GoalGraphNode, GoalGraphSnapshot, TaskItem } from '@lobechat/types';

export const GOAL_ACCEPTANCE_TASK_TITLE = 'Complete full Goal acceptance';

/** Reason strings the recovery paths key off, written by the settle path. */
export const LEASE_EXPIRED_ERROR = 'Goal Work operation lease expired.';
export const VERIFICATION_FAILED_ERROR = 'Delivery did not pass verification.';

const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

export interface FrontierSelection {
  /** Every eligible work node, best first. */
  candidates: FrontierCandidate[];
  chosen?: GoalGraphNode;
}

/**
 * Rank the work nodes that could run right now.
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
  };
};

/**
 * Whether the coordinator would spend money on this task, and therefore whether
 * the budget has to be read before deciding.
 *
 * Every other task status resolves to a branch that costs nothing, so a goal
 * that is merely waiting on a running Work does not pay for a budget query on
 * every sweep.
 */
export const needsBudget = (task?: TaskItem | null): boolean => {
  if (!task) return false;
  return !['completed', 'failed', 'canceled', 'paused', 'running', 'scheduled'].includes(
    task.status,
  );
};

export interface GoalMoveInput {
  /** Required only when {@link needsBudget} says the branch could dispatch. */
  budget?: GoalBudgetState;
  frontier: FrontierSelection;
  /** The chosen work node's responsible task, when it already has one. */
  frontierTask?: TaskItem | null;
  graph: GoalGraphSnapshot;
}

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
  frontier,
  frontierTask,
  graph,
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

  if (!chosen) return decideWithoutFrontier(graph, candidates);

  if (!chosen.taskId) {
    return {
      ...base,
      branch: 'create_task',
      message: `Work "${chosen.title}" has no responsible task yet`,
      outcome: 'advanced',
    };
  }

  if (!frontierTask) {
    return {
      ...base,
      branch: 'missing_task',
      message: 'Responsible task is missing',
      outcome: 'failed',
    };
  }

  return decideForTask(base, frontierTask, budget, graph);
};

const decideWithoutFrontier = (
  graph: GoalGraphSnapshot,
  candidates: FrontierCandidate[],
): GoalMove => {
  const base = { candidates };
  const taskNodes = graph.nodes.filter((node) => node.kind === 'task');
  const allWorkTerminal =
    taskNodes.length > 0 && taskNodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status));

  if (!allWorkTerminal) {
    // Nothing here moves without a person: either there is no Work at all, or
    // every remaining Work is blocked and nothing is running to unblock it.
    return {
      ...base,
      branch: 'no_frontier',
      message:
        taskNodes.length === 0
          ? 'No work frontier exists; add a work node'
          : 'No work node is ready; resolve its dependencies first',
      outcome: 'no_progress',
    };
  }

  const acceptanceWork = taskNodes.find((node) => node.title === GOAL_ACCEPTANCE_TASK_TITLE);

  if (graph.goal.requirement && !acceptanceWork) {
    return {
      ...base,
      branch: 'terminal_acceptance',
      message: 'Every Work finished; the Goal-level acceptance contract is next',
      outcome: 'advanced',
    };
  }
  if (graph.goal.requirement && acceptanceWork?.status !== 'resolved') {
    return {
      ...base,
      branch: 'terminal_acceptance',
      focusNodeId: acceptanceWork?.id,
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
): GoalMove => {
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
    if (task.status === 'paused' && task.error === LEASE_EXPIRED_ERROR) {
      return {
        ...base,
        branch: 'recover_lease',
        message: `Task ${task.identifier} outlived its operation lease`,
        outcome: 'waiting_external',
      };
    }
    if (task.status === 'paused' && task.error === VERIFICATION_FAILED_ERROR) {
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

  if (task.status === 'paused') {
    return {
      ...base,
      branch: 'task_paused',
      message: `Task ${task.identifier} is paused`,
      outcome: 'waiting_human',
    };
  }

  if (task.status === 'running' || task.status === 'scheduled') {
    return {
      ...base,
      branch: 'task_running',
      message: `Task ${task.identifier} is ${task.status}`,
      outcome: 'waiting_external',
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

  return {
    ...base,
    branch: 'dispatch_task',
    message: `Task ${task.identifier} is ready to run`,
    outcome: 'waiting_external',
  };
};
