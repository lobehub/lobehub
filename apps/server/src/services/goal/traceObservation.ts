import type {
  FrontierCandidate,
  GoalAdvanceEffect,
  GoalBudgetState,
  GoalFrontierTaskState,
  GoalGraphState,
  GoalTickBranch,
  GoalTickOutcome,
} from '@lobechat/agent-tracing';
import type { GoalGraphSnapshot, GoalItem, TaskItem } from '@lobechat/types';

/**
 * What one tick read and what it did, handed to the trajectory recorder.
 *
 * Travels through a side channel rather than on `GoalTickResult` because the
 * graph payload is large and that result crosses tRPC to the client — the same
 * reason the context engine snapshot stays off the agent runtime's event array.
 */
export interface GoalTickObservation {
  at: number;
  branch: GoalTickBranch;
  budget?: GoalBudgetState;
  candidates: FrontierCandidate[];
  chosenNodeId?: string;
  effects: GoalAdvanceEffect[];
  frontierTask?: GoalFrontierTaskState;
  graphState: GoalGraphState;
  message: string;
  outcome: GoalTickOutcome;
  taskId?: string;
}

export interface GoalTickOptions {
  onDecision?: (observation: GoalTickObservation) => void;
}

/**
 * Project the server graph onto the trace format.
 *
 * Only what the coordinator actually reads is carried over: descriptions,
 * confidences and event history are not decision inputs, and a trajectory that
 * copied them would grow with the conversation rather than with the reasoning.
 */
export const toTraceGraphState = (graph: GoalGraphSnapshot): GoalGraphState => ({
  decisions: graph.decisions.map((decision) => ({
    id: decision.id,
    nodeId: decision.nodeId,
    question: decision.question,
    resolvedOptionId: decision.resolvedOptionId,
    status: decision.status,
  })),
  edges: graph.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
  })),
  goal: {
    agentId: graph.goal.agentId,
    id: graph.goal.id,
    maxRounds: graph.goal.maxRounds,
    maxTotalCost: graph.goal.maxTotalCost,
    requirement: graph.goal.requirement,
    status: graph.goal.status,
    title: graph.goal.title,
  },
  nodes: graph.nodes.map((node) => ({
    createdAt: node.createdAt.getTime(),
    id: node.id,
    kind: node.kind,
    priority: node.priority,
    status: node.status,
    taskId: node.taskId,
    title: node.title,
  })),
});

export const toFrontierTaskState = (task: TaskItem): GoalFrontierTaskState => ({
  error: task.error,
  id: task.id,
  identifier: task.identifier,
  status: task.status,
  updatedAt: new Date(task.updatedAt).getTime(),
});

export interface BudgetEvaluation {
  costLimitReached: boolean;
  roundLimitReached: boolean;
  runs: { length: number };
  totalCost: number;
}

export const toBudgetState = (goal: GoalItem, budget: BudgetEvaluation): GoalBudgetState => ({
  costLimitReached: budget.costLimitReached,
  maxRounds: goal.maxRounds,
  maxTotalCost: goal.maxTotalCost === null ? null : Number(goal.maxTotalCost),
  roundLimitReached: budget.roundLimitReached,
  runs: budget.runs.length,
  totalCost: budget.totalCost,
});
