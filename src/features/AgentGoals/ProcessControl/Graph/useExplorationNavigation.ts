import type { GoalGraphSnapshot } from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';
import { useMemo, useState } from 'react';

type Graph = Pick<GoalGraphSnapshot, 'nodes' | 'edges'>;

/** Expansion is presentation state; entering a group explicitly changes the viewing scope. */
export const useExplorationNavigation = (goalId: string, graph: Graph) => {
  const [state, setState] = useState({ goalId, expanded: new Set<string>(), path: [] as string[] });
  if (state.goalId !== goalId) setState({ goalId, expanded: new Set(), path: [] });

  const path = state.path.filter((id) => graph.nodes.some((n) => n.id === id));
  const scopeId = path.at(-1);
  const scopeIds = scopeId ? experimentMembers(graph, scopeId) : undefined;
  const nodes = graph.nodes.filter((node) => !scopeIds || scopeIds.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
  );
  const experiments = nodes.filter((node) => node.kind === 'experiment');
  // The canvas refits whenever `collapsed` changes identity, so it must only
  // change when its contents do — a fresh Set per render refit the map on every
  // node click and every graph poll.
  const collapsedKey = experiments
    .filter((n) => !state.expanded.has(n.id))
    .map((n) => n.id)
    .join('\n');
  const collapsed = useMemo(
    () => new Set(collapsedKey ? collapsedKey.split('\n') : []),
    [collapsedKey],
  );

  return {
    collapsed,
    edges,
    nodes,
    path,
    scopeId,
    enter: (id: string) => {
      if (!experiments.some((node) => node.id === id)) return;
      setState((previous) => ({ ...previous, path: [...path, id] }));
    },
    backTo: (depth: number) =>
      setState((previous) => ({ ...previous, path: path.slice(0, depth) })),
    toggle: (id: string) =>
      setState((previous) => {
        const expanded = new Set(previous.expanded);
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        return { ...previous, expanded };
      }),
    expandAll: (expand: boolean) =>
      setState((previous) => {
        const expanded = new Set(previous.expanded);
        for (const node of experiments) {
          if (expand) expanded.add(node.id);
          else expanded.delete(node.id);
        }
        return { ...previous, expanded };
      }),
  };
};
