import { GOAL_GRAPH_CAPABILITY } from '@lobechat/const/goal';
import type { GoalGraphSnapshot } from '@lobechat/types';

/**
 * The graph as a client that declared `capabilities` can render it.
 *
 * A client released before the `batch` node kind has no style, icon or size
 * for it, and would crash or lay out garbage on a batched goal. Unless the
 * client declares the capability, a batch goes out as an `experiment` — the
 * container those clients already draw, holding the same members — and only a
 * client that knows batches sees the real kind.
 */
export const graphForClient = (
  graph: GoalGraphSnapshot,
  capabilities: readonly string[] = [],
): GoalGraphSnapshot => {
  if (capabilities.includes(GOAL_GRAPH_CAPABILITY.batch)) return graph;
  if (!graph.nodes.some((node) => node.kind === 'batch')) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.kind === 'batch' ? { ...node, kind: 'experiment' as const } : node,
    ),
  };
};
