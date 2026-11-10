import type { GoalGraphEdge, GoalGraphNode, GoalNodeKind } from '@lobechat/types';

import { type LayoutBox, layoutGraph } from './layout';

/**
 * A container that lays out its own members (an expanded batch): the frame
 * size, member boxes relative to the frame, and which members it shows.
 */
export interface ContainerLayout {
  /** The column links into the container land on; it is lined up under the parent. */
  anchorX?: number;
  boxes: Record<string, LayoutBox>;
  height: number;
  nodeIds: ReadonlySet<string>;
  width: number;
}

export interface ExplorationEdge extends GoalGraphEdge {
  originalSource: string;
  originalTarget: string;
  projected: boolean;
}

/** Collapse is a projection of one global graph, never navigation to another scope. */
export const explorationMap = (
  nodes: GoalGraphNode[],
  edges: GoalGraphEdge[],
  collapsed: ReadonlySet<string>,
  hiddenKinds: ReadonlySet<GoalNodeKind> = new Set(),
  containerLayouts: ReadonlyMap<string, ContainerLayout> = new Map(),
) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const owner = new Map(
    edges
      .filter((edge) => edge.kind === 'contains')
      .map((edge) => [edge.targetNodeId, edge.sourceNodeId]),
  );
  const representative = (id: string) => {
    let result: string | undefined = hiddenKinds.has(byId.get(id)!.kind) ? undefined : id;
    let current = owner.get(id);
    const seen = new Set([id]);
    while (current && !seen.has(current)) {
      seen.add(current);
      if (collapsed.has(current))
        result = hiddenKinds.has(byId.get(current)!.kind) ? undefined : current;
      current = owner.get(current);
    }
    return result;
  };
  // A container with its own layout shows only the members it placed, and
  // draws its own links between them.
  const custom = (id: string) => {
    const container = owner.get(id);
    return container && !collapsed.has(container) ? containerLayouts.get(container) : undefined;
  };
  const visible = nodes.filter(
    (node) =>
      representative(node.id) === node.id && (custom(node.id)?.nodeIds.has(node.id) ?? true),
  );
  const visibleIds = new Set(visible.map((node) => node.id));
  const parents = new Map<string, string>();
  for (const node of visible) {
    let parent = owner.get(node.id);
    const seen = new Set([node.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (visibleIds.has(parent)) {
        parents.set(node.id, parent);
        break;
      }
      parent = owner.get(parent);
    }
  }
  const links: ExplorationEdge[] = [];
  for (const edge of edges) {
    if (edge.kind === 'contains' || !byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId))
      continue;
    if (custom(edge.sourceNodeId) || custom(edge.targetNodeId)) continue;
    const sourceNodeId = representative(edge.sourceNodeId);
    const targetNodeId = representative(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
    links.push({
      ...edge,
      sourceNodeId,
      targetNodeId,
      originalSource: edge.sourceNodeId,
      originalTarget: edge.targetNodeId,
      projected: sourceNodeId !== edge.sourceNodeId || targetNodeId !== edge.targetNodeId,
    });
  }

  const boxes: Record<string, LayoutBox> = {};
  const ordered: GoalGraphNode[] = [];
  const children = (parent?: string) => visible.filter((node) => parents.get(node.id) === parent);
  const branchAt = (id: string, scope?: string): string | undefined => {
    let current: string | undefined = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (parents.get(current) === scope) return current;
      seen.add(current);
      current = parents.get(current);
    }
  };
  const measure = (scope?: string) => {
    const members = children(scope);
    const sizes: Record<string, Pick<LayoutBox, 'width' | 'height'>> = {};
    for (const node of members) {
      const own = collapsed.has(node.id) ? undefined : containerLayouts.get(node.id);
      if (own) {
        sizes[node.id] = { height: own.height, width: own.width };
        for (const id of own.nodeIds) if (own.boxes[id]) boxes[id] = own.boxes[id];
        continue;
      }
      if ((node.kind === 'experiment' || node.kind === 'batch') && !collapsed.has(node.id)) {
        const inner = measure(node.id);
        const values = Object.values(inner);
        const left = Math.min(0, ...values.map((box) => box.x));
        const right = Math.max(0, ...values.map((box) => box.x + box.width));
        const bottom = Math.max(0, ...values.map((box) => box.y + box.height));
        sizes[node.id] = {
          width: Math.max(400, right - left + 48),
          height: Math.max(156, bottom + 116),
        };
        for (const [id, box] of Object.entries(inner))
          boxes[id] = { ...box, x: box.x - left + 24, y: box.y + 92 };
      }
    }
    const ranking = links.flatMap((edge) => {
      const sourceNodeId = branchAt(edge.sourceNodeId, scope);
      const targetNodeId = branchAt(edge.targetNodeId, scope);
      return sourceNodeId && targetNodeId && sourceNodeId !== targetNodeId
        ? [{ ...edge, sourceNodeId, targetNodeId }]
        : [];
    });
    const placed = layoutGraph(members, ranking, sizes, { column: 64, rank: 96 });
    // A container with its own layout lands its incoming link on one column,
    // not its middle: slide it so that column sits under the parent and the
    // link runs straight — unless that would push into a neighbour.
    for (const node of members) {
      const own = collapsed.has(node.id) ? undefined : containerLayouts.get(node.id);
      const box = placed[node.id];
      if (own?.anchorX === undefined || !box) continue;
      const alone = !members.some((other) => other.id !== node.id && placed[other.id]?.y === box.y);
      if (alone) box.x += box.width / 2 - own.anchorX;
    }
    return placed;
  };
  Object.assign(boxes, measure());
  const visit = (parent?: string) => {
    for (const node of children(parent)) {
      ordered.push(node);
      visit(node.id);
    }
  };
  visit();
  return { boxes, edges: links, nodes: ordered, parents };
};
