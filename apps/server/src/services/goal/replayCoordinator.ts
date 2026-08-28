import type {
  GoalDecider,
  GoalDecision,
  GoalDecisionInput,
  GoalGraphState,
  GoalReplayResult,
  GoalTrajectory,
} from '@lobechat/agent-tracing';
import { replayGoalTrajectory } from '@lobechat/agent-tracing';
import type { GoalGraphSnapshot, TaskItem } from '@lobechat/types';

import { decideNextMove, selectFrontier } from './decideNextMove';

/**
 * Lift a recorded graph back into the shape the coordinator reads.
 *
 * The trace stores only what the decision depends on, so this fills the rest
 * with empty values rather than inventing content: `decideNextMove` never looks
 * at descriptions, events or work versions, and a replay that fabricated them
 * would be testing something the original run never saw.
 */
export const fromTraceGraphState = (state: GoalGraphState): GoalGraphSnapshot =>
  ({
    decisions: state.decisions.map((decision) => ({
      ...decision,
      options: null,
      recommendedOptionId: null,
    })),
    edges: state.edges,
    events: [],
    goal: { ...state.goal, config: null, projectId: null },
    nodes: state.nodes.map((node) => ({
      ...node,
      createdAt: new Date(node.createdAt),
      description: null,
    })),
    workVersions: [],
  }) as unknown as GoalGraphSnapshot;

const toTask = (input: GoalDecisionInput): TaskItem | undefined | null => {
  if (input.frontierTask === undefined) return undefined;
  return { ...input.frontierTask, updatedAt: new Date(input.frontierTask.updatedAt) } as TaskItem;
};

/**
 * The live coordinator, as a decider a recorded trajectory can be replayed
 * against.
 *
 * This is the whole payoff of splitting the decision out of `tick`: the
 * function under test here is the one production runs, not a model of it.
 */
export const coordinatorDecider: GoalDecider = (input): GoalDecision => {
  const graph = fromTraceGraphState(input.graph);
  const frontier = selectFrontier(graph);
  const move = decideNextMove({
    budget: input.budget,
    frontier,
    frontierTask: toTask(input),
    graph,
  });

  return { branch: move.branch, candidates: move.candidates, chosenNodeId: move.chosenNodeId };
};

/**
 * Replay a recorded goal against the current coordinator.
 *
 * An empty `divergences` means a rule change was inert on this run; every entry
 * is a real behavioural difference, with the advance and tick that produced it.
 */
export const replayGoalAgainstCurrentCoordinator = (trajectory: GoalTrajectory): GoalReplayResult =>
  replayGoalTrajectory(trajectory, coordinatorDecider);
