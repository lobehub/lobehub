import type { GoalGraphEdge, GoalGraphNode, GoalNodeKind } from '@lobechat/types';

/**
 * Layered DAG layout for the exploration graph.
 *
 * The repo has no graph-layout library and the goal graph is small (tens of
 * nodes) and shaped like a tree, so ranking by longest path plus a barycenter
 * pass inside each rank is enough. Adding dagre/elk for this would be a new
 * dependency for a layout that fits in a screen of code.
 */

export const NODE_WIDTH = { decision: 250, finding: 240, problem: 230, task: 260 } as const;
export const NODE_HEIGHT = { decision: 76, finding: 76, problem: 76, task: 112 } as const;

const RANK_GAP = 56;
const COLUMN_GAP = 32;

/** The fields layout actually reads — lets callers pass synthetic bridge edges. */
export type LayoutEdge = Pick<GoalGraphEdge, 'kind' | 'sourceNodeId' | 'targetNodeId'>;

/**
 * Which way an edge points on screen. `supports` / `contradicts` link a finding
 * back to the problem it answers, so they are drawn but never rank a node —
 * using them would fight the produce chain that put the finding there.
 */
const rankDirection = (edge: LayoutEdge): [string, string] | undefined => {
  switch (edge.kind) {
    case 'decomposes':
    case 'investigates':
    case 'leads_to':
    case 'produces': {
      return [edge.sourceNodeId, edge.targetNodeId];
    }
    // A blocker sits above the node waiting on it.
    case 'depends_on': {
      return [edge.targetNodeId, edge.sourceNodeId];
    }
    default: {
      return undefined;
    }
  }
};

export interface LayoutBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** A synthetic edge standing in for a ranked chain that runs through hidden nodes. */
export interface GraphBridge {
  sourceNodeId: string;
  targetNodeId: string;
}

/**
 * Drop every node of a hidden kind, bridging the ranked chains that ran
 * through them (problem → hidden task → finding reads problem → finding), so
 * the survivors keep their depth instead of collapsing into one orphan row.
 */
export const hideKinds = (
  nodes: GoalGraphNode[],
  edges: LayoutEdge[],
  hidden: ReadonlySet<GoalNodeKind>,
): { bridges: GraphBridge[]; visibleIds: Set<string> } => {
  const visibleIds = new Set<string>();
  const hiddenIds = new Set<string>();
  for (const node of nodes) (hidden.has(node.kind) ? hiddenIds : visibleIds).add(node.id);

  const bridges: GraphBridge[] = [];
  if (hiddenIds.size === 0) return { bridges, visibleIds };

  const out = new Map<string, string[]>();
  // A bridge that mirrors a surviving direct edge would draw twice — seed the
  // dedupe set with the ranked pairs that stay on the map.
  const seen = new Set<string>();
  for (const edge of edges) {
    const link = rankDirection(edge);
    if (!link) continue;
    const inScope = (id: string) => visibleIds.has(id) || hiddenIds.has(id);
    if (!inScope(link[0]) || !inScope(link[1])) continue;
    out.set(link[0], [...(out.get(link[0]) ?? []), link[1]]);
    if (visibleIds.has(link[0]) && visibleIds.has(link[1])) seen.add(`${link[0]}→${link[1]}`);
  }

  for (const start of visibleIds) {
    const stack = (out.get(start) ?? []).filter((id) => hiddenIds.has(id));
    const visited = new Set(stack);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of out.get(current) ?? []) {
        if (visibleIds.has(next)) {
          const key = `${start}→${next}`;
          if (next !== start && !seen.has(key)) {
            seen.add(key);
            bridges.push({ sourceNodeId: start, targetNodeId: next });
          }
        } else if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
  }
  return { bridges, visibleIds };
};

export const layoutGraph = (
  nodes: GoalGraphNode[],
  edges: LayoutEdge[],
): Record<string, LayoutBox> => {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const links = edges.map(rankDirection).filter((link): link is [string, string] => {
    return !!link && index.has(link[0]) && index.has(link[1]);
  });

  // Longest-path ranking by relaxation. Bounded by node count so a cycle
  // introduced by a hand-authored edge cannot hang the render.
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of links) {
      const next = rank.get(from)! + 1;
      if (next > rank.get(to)!) {
        rank.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const parents = new Map<string, string[]>();
  for (const [from, to] of links) parents.set(to, [...(parents.get(to) ?? []), from]);

  const rows = new Map<number, GoalGraphNode[]>();
  for (const node of nodes) {
    const r = rank.get(node.id)!;
    rows.set(r, [...(rows.get(r) ?? []), node]);
  }

  const boxes: Record<string, LayoutBox> = {};
  const order = new Map<string, number>();
  let y = 0;
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(r)!;
    // Barycenter: sit under the average position of the parents already placed.
    row.sort(
      (a, b) =>
        barycenter(a, parents, order) - barycenter(b, parents, order) ||
        index.get(a.id)! - index.get(b.id)!,
    );
    const widths = row.map((node) => NODE_WIDTH[node.kind]);
    const total = widths.reduce((sum, w) => sum + w, 0) + COLUMN_GAP * (row.length - 1);
    let x = -total / 2;
    let height = 0;
    row.forEach((node, i) => {
      boxes[node.id] = { height: NODE_HEIGHT[node.kind], width: widths[i], x, y };
      order.set(node.id, x + widths[i] / 2);
      x += widths[i] + COLUMN_GAP;
      height = Math.max(height, NODE_HEIGHT[node.kind]);
    });
    y += height + RANK_GAP;
  }
  return boxes;
};

const barycenter = (
  node: GoalGraphNode,
  parents: Map<string, string[]>,
  placed: Map<string, number>,
) => {
  const known = (parents.get(node.id) ?? [])
    .map((id) => placed.get(id))
    .filter((v) => v !== undefined);
  return known.length === 0 ? 0 : known.reduce((sum, v) => sum + v!, 0) / known.length;
};
