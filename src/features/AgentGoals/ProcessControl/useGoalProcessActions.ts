import { useCallback, useMemo } from 'react';

import { goalService } from '@/services/goal';
import { useChatStore } from '@/store/chat';
import { useGoalStore } from '@/store/goal';

import { isExperiment } from '../Experiments/model';
import type { FrontierActions } from './Frontier';
import { type GoalGraphView, hasReviewableResult } from './goalGraphViewModel';

/**
 * Where a click on a goal graph node lands, shared by every host of the
 * process-control sections (goal page, conversation portal) and every link to
 * a node. A Task that has delivered — resolved, or done and under verification
 * — opens its result surface: the report, the verdict on it and the artifacts,
 * which is what the reader of a finished Task came for. A Task still waiting,
 * running or in trouble opens the original Task detail, where configuration,
 * runs and failure context live. Everything else opens the node drill-down.
 */
export const useGoalNodeSelect = (goalId: string, graph?: GoalGraphView) => {
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const openTaskResult = useChatStore((s) => s.openTaskResult);
  const openGoalNode = useChatStore((s) => s.openGoalNode);

  return useCallback(
    (nodeId: string) => {
      const view = graph?.byId[nodeId];
      const taskId = view?.node.taskId;
      if (!taskId || (graph && view && isExperiment(graph, view))) {
        openGoalNode(goalId, nodeId);
        return;
      }
      if (view && hasReviewableResult(view)) openTaskResult(taskId);
      else openTaskDetail(taskId);
    },
    [goalId, graph, openGoalNode, openTaskDetail, openTaskResult],
  );
};

/** The frontier's write actions — add a Task, resolve a decision gate. */
export const useFrontierActions = (goalId: string): FrontierActions => {
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);

  return useMemo(
    () => ({
      addTask: async (title: string, description?: string) => {
        await goalService.addNode({ description, id: goalId, kind: 'task', title });
        await refreshGoalGraph(goalId);
      },
      decide: (decisionId, optionId, resolution) =>
        decideGoal(goalId, { decisionId, optionId, resolution }),
    }),
    [decideGoal, goalId, refreshGoalGraph],
  );
};

/**
 * The coordinator is decomposing the problem into tasks. `running` with zero
 * Task counts too: the decomposition claim flips the status before the planner
 * returns, and a re-plan after all Tasks were removed is the same state.
 */
export const isGoalPlanning = (graph: GoalGraphView): boolean =>
  ['planning', 'running'].includes(graph.goal.status) &&
  !graph.nodes.some((view) => view.node.kind === 'task');

/**
 * A closed goal cannot move: the coordinator returns immediately for these, and
 * a Task added here would sit `proposed` forever.
 */
export const isGoalClosed = (graph: GoalGraphView): boolean =>
  ['achieved', 'canceled', 'failed'].includes(graph.goal.status);
