import type { GoalGraphSnapshot } from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';
import { useMemo, useState } from 'react';

import { isContainerKind } from '../../Experiments/model';

type Graph = Pick<GoalGraphSnapshot, 'nodes' | 'edges'>;

/**
 * Expansion is presentation state; entering a group explicitly changes the viewing scope.
 *
 * An experiment folds — it is one candidate among several. A batch never does:
 * its trials, gate and waves are the whole point of the view, and it has no
 * frame to fold into. `toggled` records the experiments a person opened.
 */
const foldable = (node: Graph['nodes'][number]) => node.kind !== 'batch';

export const useExplorationNavigation = (goalId: string, graph: Graph) => {
  const [state, setState] = useState({ goalId, path: [] as string[], toggled: new Set<string>() });
  if (state.goalId !== goalId) setState({ goalId, path: [], toggled: new Set() });

  const path = state.path.filter((id) => graph.nodes.some((n) => n.id === id));
  const scopeId = path.at(-1);
  const scopeIds = scopeId ? experimentMembers(graph, scopeId) : undefined;
  const nodes = graph.nodes.filter((node) => !scopeIds || scopeIds.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
  );
  const containers = nodes.filter((node) => isContainerKind(node.kind));
  // The canvas refits whenever `collapsed` changes identity, so it must only
  // change when its contents do — a fresh Set per render refit the map on every
  // node click and every graph poll.
  const collapsedKey = containers
    .filter((n) => foldable(n) && !state.toggled.has(n.id))
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
      if (!containers.some((node) => node.id === id)) return;
      setState((previous) => ({ ...previous, path: [...path, id] }));
    },
    backTo: (depth: number) =>
      setState((previous) => ({ ...previous, path: path.slice(0, depth) })),
    toggle: (id: string) =>
      setState((previous) => {
        if (!containers.some((node) => node.id === id && foldable(node))) return previous;
        const toggled = new Set(previous.toggled);
        if (toggled.has(id)) toggled.delete(id);
        else toggled.add(id);
        return { ...previous, toggled };
      }),
    expandAll: (expand: boolean) =>
      setState((previous) => {
        const toggled = new Set(previous.toggled);
        for (const node of containers) {
          if (!foldable(node)) continue;
          if (expand) toggled.add(node.id);
          else toggled.delete(node.id);
        }
        return { ...previous, toggled };
      }),
  };
};
