import type { GoalEdgeKind, GoalGraphSnapshot } from '@lobechat/types';
import { experimentMembers, experimentOwner } from '@lobechat/utils/goalGraph';

/**
 * Reject a `contains` / `answers` edge that would break experiment scoping.
 * Every other kind is unconstrained here.
 */
export const assertContainerEdge = (
  graph: Pick<GoalGraphSnapshot, 'edges' | 'nodes'>,
  sourceNodeId: string,
  targetNodeId: string,
  kind: GoalEdgeKind,
) => {
  if (kind !== 'contains' && kind !== 'answers') return;
  const { edges, nodes } = graph;
  const source = nodes.find((node) => node.id === sourceNodeId);
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!source || !target || source.id === target.id)
    throw new Error('Invalid experiment relationship');
  // Two kinds are containers: an `experiment` (a candidate answer under
  // test) and a `batch` (one repeated mould delivered as a class). The
  // single-owner and cycle rules below are about containment itself, so
  // they hold for both; only the question-scope rules are experiment-only.
  if (source.kind !== 'experiment' && source.kind !== 'batch')
    throw new Error('Only a container can contain nodes or answer a question');
  if (kind === 'answers' && source.kind !== 'experiment')
    throw new Error('Only an experiment can answer a question');
  if (kind === 'contains') {
    const owner = experimentOwner(graph, target.id);
    if (owner && owner !== source.id) throw new Error('A node can belong to only one experiment');
    if (experimentMembers(graph, target.id).has(source.id))
      throw new Error('Experiment containment cannot form a cycle');
    const questionId = edges.find(
      (edge) => edge.kind === 'answers' && edge.sourceNodeId === target.id,
    )?.targetNodeId;
    if (
      source.kind === 'experiment' &&
      edges.some(
        (edge) =>
          edge.kind === 'answers' &&
          edge.targetNodeId === target.id &&
          experimentOwner(graph, edge.sourceNodeId) !== source.id,
      )
    )
      throw new Error('A question must share its answer scope');
    if (
      source.kind === 'experiment' &&
      questionId &&
      experimentOwner(graph, questionId) !== source.id
    )
      throw new Error('An answer must share its question scope');
    return;
  }
  if (target.kind !== 'problem') throw new Error('An experiment must answer a question');
  if (experimentOwner(graph, source.id) !== experimentOwner(graph, target.id))
    throw new Error('An answer must share its question scope');
  if (
    edges.some(
      (edge) =>
        edge.kind === 'answers' &&
        edge.sourceNodeId === source.id &&
        edge.targetNodeId !== target.id,
    )
  )
    throw new Error('An experiment answers one question');
};
