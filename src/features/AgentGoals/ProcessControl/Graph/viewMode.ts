import type { GoalStatus } from '@lobechat/types';

import type { GoalGraphView } from '../goalGraphViewModel';

export type GraphViewMode = 'stage' | 'all';

const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>(['achieved', 'failed', 'canceled']);

/** The nodes worth showing before the user asks for the whole map. */
export const stageNodeIds = (graph: GoalGraphView): Set<string> => {
  const active = new Set<string>();
  for (const view of graph.nodes)
    if (view.node.status !== 'proposed' || ['experiment', 'problem'].includes(view.node.kind))
      active.add(view.node.id);
  for (const item of graph.frontier) active.add(item.view.node.id);
  const visible = new Set(active);
  for (const view of graph.blocked)
    if (view.blockers.every((blocker) => active.has(blocker.id))) visible.add(view.node.id);
  return visible;
};

/**
 * Whether the stage/all switch has nothing to switch: a finished goal has no
 * "current stage" left, and once every node is in the stage the two views
 * render the same map.
 */
export const isStageWholeMap = (graph: GoalGraphView): boolean =>
  TERMINAL_GOAL_STATUSES.has(graph.goal.status) || stageNodeIds(graph).size >= graph.nodes.length;
