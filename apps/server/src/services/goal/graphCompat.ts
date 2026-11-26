import { GOAL_GRAPH_CAPABILITY } from '@lobechat/const/goal';
import type { GoalEdgeKind, GoalGraphSnapshot, GoalNodeKind } from '@lobechat/types';
import { isMarkKind } from '@lobechat/utils/goalGraph';

/** The edge kinds a client without the `marks` capability already draws. */
const LEGACY_MARK_EDGE: Partial<Record<GoalEdgeKind, GoalEdgeKind>> = {
  confirms: 'supports',
  refutes: 'contradicts',
};

/**
 * The graph as a client that declared `capabilities` can render it.
 *
 * A client released before the `batch` node kind has no style, icon or size
 * for it, and would crash or lay out garbage on a batched goal. Unless the
 * client declares the capability, a batch goes out as an `experiment` — the
 * container those clients already draw, holding the same members — and only a
 * client that knows batches sees the real kind.
 *
 * Marks and `template` go out as `finding` the same way: a recipe was a
 * `finding` before it had a kind of its own, so an older client still finds it
 * by its title, and a mark reads as the note it is. Their `confirms` /
 * `refutes` edges become `supports` / `contradicts`.
 */
export const graphForClient = (
  graph: GoalGraphSnapshot,
  capabilities: readonly string[] = [],
): GoalGraphSnapshot => {
  const batches = capabilities.includes(GOAL_GRAPH_CAPABILITY.batch);
  const marks = capabilities.includes(GOAL_GRAPH_CAPABILITY.marks);
  const legacyKind = (kind: GoalNodeKind): GoalNodeKind => {
    if (!batches && kind === 'batch') return 'experiment';
    if (!marks && (kind === 'template' || isMarkKind(kind))) return 'finding';
    return kind;
  };
  if (!graph.nodes.some((node) => legacyKind(node.kind) !== node.kind)) return graph;
  // Only marks carry `confirms` / `refutes`, so a graph with none keeps its edges.
  const downgradesMarks = !marks && graph.nodes.some((node) => isMarkKind(node.kind));
  return {
    ...graph,
    ...(downgradesMarks && {
      edges: graph.edges.map((edge) => {
        const kind = LEGACY_MARK_EDGE[edge.kind];
        return kind ? { ...edge, kind } : edge;
      }),
    }),
    nodes: graph.nodes.map((node) => {
      const kind = legacyKind(node.kind);
      return kind === node.kind ? node : { ...node, kind };
    }),
  };
};
