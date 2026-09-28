import type { GoalGraphSnapshot, GoalNodeKind } from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';

import type { GoalGraphView, GoalNodeView } from '../ProcessControl/goalGraphViewModel';

export const isExperiment = (_graph: GoalGraphView, view: GoalNodeView) =>
  view.node.kind === 'experiment';

/** Provenance is independent of execution dependencies and retry attempts. */
export const experimentRelations = (graph: GoalGraphView, nodeId: string) => {
  const parents = new Set<string>();
  const children = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'derived_from') continue;
    if (edge.sourceNodeId === nodeId) parents.add(edge.targetNodeId);
    if (edge.targetNodeId === nodeId) children.add(edge.sourceNodeId);
  }
  return {
    children: graph.nodes.filter((view) => children.has(view.node.id) && isExperiment(graph, view)),
    parents: graph.nodes.filter((view) => parents.has(view.node.id) && isExperiment(graph, view)),
  };
};

export const experimentInputs = (snapshot: GoalGraphSnapshot, nodeId: string) => {
  const members = experimentMembers(snapshot, nodeId);
  members.add(nodeId);
  const versions = new Map(
    snapshot.workVersions
      .filter((link) => members.has(link.nodeId) && link.relation === 'input')
      .map((link) => [link.workVersionId, link]),
  );
  return [...versions.values()];
};

/** Graph semantics are persisted; presentation never reclassifies a Task. */
export type GoalGraphNodeKind = GoalNodeKind;

export const graphNodeKind = (graph: GoalGraphView, view: GoalNodeView): GoalGraphNodeKind =>
  isExperiment(graph, view) ? 'experiment' : view.node.kind;

export const graphNodeLabel = (kindLabel: string, title: string, sequence?: number) =>
  `${kindLabel}${sequence === undefined ? '' : ` #${sequence}`} · ${title}`;
