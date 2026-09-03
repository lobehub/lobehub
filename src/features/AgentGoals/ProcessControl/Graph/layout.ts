import type { GoalGraphEdge, GoalGraphNode } from '@lobechat/types';

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

/**
 * Which way an edge points on screen. `supports` / `contradicts` link a finding
 * back to the problem it answers, so they are drawn but never rank a node —
 * using them would fight the produce chain that put the finding there.
 */
const rankDirection = (edge: GoalGraphEdge): [string, string] | undefined => {
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

export const layoutGraph = (
  nodes: GoalGraphNode[],
  edges: GoalGraphEdge[],
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
