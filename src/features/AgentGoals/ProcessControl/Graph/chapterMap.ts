import { type GoalGraphView, scopeGraphView } from '../goalGraphViewModel';
import type { GraphBridge } from './layout';
import { resolveMainline } from './mainline';

/**
 * A report chapter's local map: the chapter's nodes, every edge between them,
 * and whatever it takes to show where each detour forked off.
 */
export interface ChapterMap {
  /**
   * Schematic links for a stray part that reaches the rest only through a
   * longer chain of nodes left off the map. `hops` counts the nodes skipped.
   */
  bridges: GraphBridge[];
  /** Nodes outside the chapter, added only because the fork happens there. */
  contextIds: ReadonlySet<string>;
  graph: GoalGraphView;
}

const componentsOf = (
  ids: ReadonlySet<string>,
  links: { sourceNodeId: string; targetNodeId: string }[],
): Set<string>[] => {
  const parent = new Map([...ids].map((id) => [id, id]));
  const find = (id: string): string => {
    const up = parent.get(id)!;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  for (const link of links)
    if (ids.has(link.sourceNodeId) && ids.has(link.targetNodeId))
      parent.set(find(link.sourceNodeId), find(link.targetNodeId));
  const groups = new Map<string, Set<string>>();
  for (const id of ids) {
    const root = find(id);
    groups.set(root, (groups.get(root) ?? new Set()).add(id));
  }
  return [...groups.values()];
};

/**
 * Narrowing the goal graph to a chapter keeps only edges with both ends inside
 * it, and a detour usually forks from a node the chapter does not list — the
 * question both paths decompose from, or the task a retry continued. Left at
 * that, the map is loose cards with no way to tell where the stray path began.
 *
 * So the part holding the mainline (else the chapter's first node) is the
 * anchor, and every other part is joined to it by its shortest route through
 * the goal graph: one node in between is shown as the fork itself; a longer
 * route is drawn as one schematic link, anchor side first.
 */
export const chapterMap = (graph: GoalGraphView, nodeIds: readonly string[]): ChapterMap => {
  const links = graph.edges.filter(
    (edge) =>
      edge.kind !== 'contains' &&
      !!graph.byId[edge.sourceNodeId] &&
      !!graph.byId[edge.targetNodeId],
  );
  const neighbours = new Map<string, string[]>();
  for (const { sourceNodeId, targetNodeId } of links) {
    neighbours.set(sourceNodeId, [...(neighbours.get(sourceNodeId) ?? []), targetNodeId]);
    neighbours.set(targetNodeId, [...(neighbours.get(targetNodeId) ?? []), sourceNodeId]);
  }

  const chapterIds = nodeIds.filter((id) => graph.byId[id]);
  const members = new Set(chapterIds);
  const contextIds = new Set<string>();
  const bridges: GraphBridge[] = [];
  const mainline = resolveMainline(graph);

  // Every pass joins at least one part to the anchor, so this ends.
  for (;;) {
    const parts = componentsOf(members, [...links, ...bridges]);
    if (parts.length <= 1) break;
    const anchor =
      parts.find((part) => [...part].some((id) => mainline?.nodeIds.has(id))) ??
      parts.find((part) => part.has(chapterIds[0])) ??
      parts[0];

    const previous = new Map<string, string | undefined>([...anchor].map((id) => [id, undefined]));
    const queue = [...anchor];
    let reached: string | undefined;
    while (queue.length > 0 && !reached) {
      const current = queue.shift()!;
      for (const next of neighbours.get(current) ?? []) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        if (members.has(next)) {
          reached = next;
          break;
        }
        queue.push(next);
      }
    }
    // What is left has no route to the anchor at all; nothing honest to draw.
    if (!reached) break;

    const between: string[] = [];
    let step = previous.get(reached);
    while (step && !anchor.has(step)) {
      between.push(step);
      step = previous.get(step);
    }
    if (between.length === 1) {
      contextIds.add(between[0]);
      members.add(between[0]);
    } else {
      bridges.push({ hops: between.length, sourceNodeId: step!, targetNodeId: reached });
    }
  }

  return { bridges, contextIds, graph: scopeGraphView(graph, members) };
};
