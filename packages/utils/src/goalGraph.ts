import type { GoalGraphNode, GoalGraphSnapshot, GoalNodeStatus } from '@lobechat/types';

type Graph = Pick<GoalGraphSnapshot, 'nodes' | 'edges'>;

/** Containment is a tree; reasoning/provenance edges remain a graph. */
export const experimentOwner = (graph: Graph, nodeId: string) =>
  graph.edges.find((edge) => edge.kind === 'contains' && edge.targetNodeId === nodeId)
    ?.sourceNodeId;

export const experimentMembers = (graph: Graph, scopeId: string, recursive = true): Set<string> => {
  const members = new Set<string>();
  const queue = [scopeId];
  const visited = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      if (
        edge.kind !== 'contains' ||
        edge.sourceNodeId !== current ||
        visited.has(edge.targetNodeId)
      )
        continue;
      members.add(edge.targetNodeId);
      visited.add(edge.targetNodeId);
      if (recursive) queue.push(edge.targetNodeId);
    }
  }
  return members;
};

/** Completion describes this candidate's work, never acceptance of its answer. */
export const experimentStatus = (graph: Graph, node: GoalGraphNode): GoalNodeStatus => {
  if (node.kind !== 'experiment' || ['retired', 'rejected'].includes(node.status))
    return node.status;
  const members = experimentMembers(graph, node.id);
  const work = graph.nodes.filter(
    (item) => members.has(item.id) && ['task', 'decision'].includes(item.kind),
  );
  if (!work.length) return 'proposed';
  const emptyBranch = graph.nodes.some(
    (item) =>
      members.has(item.id) &&
      item.kind === 'experiment' &&
      !['retired', 'rejected'].includes(item.status) &&
      !graph.nodes.some(
        (child) =>
          experimentMembers(graph, item.id).has(child.id) &&
          ['task', 'decision'].includes(child.kind),
      ),
  );
  const unanswered = graph.nodes.some(
    (item) =>
      members.has(item.id) &&
      item.kind === 'problem' &&
      !['resolved', 'retired', 'rejected'].includes(item.status) &&
      !graph.edges.some((edge) => edge.kind === 'answers' && edge.targetNodeId === item.id),
  );
  if (emptyBranch || unanswered) return 'active';
  if (work.some((item) => item.status === 'waiting')) return 'waiting';
  if (work.every((item) => ['resolved', 'retired', 'rejected'].includes(item.status))) {
    return work.some((item) => item.status === 'rejected') ? 'rejected' : 'resolved';
  }
  return work.some((item) => item.status !== 'proposed') ? 'active' : 'proposed';
};

/** Root and every drill level contain only direct members, with semantic edges between them. */
export const graphScopeIds = (graph: Graph, scopeId?: string): Set<string> => {
  if (scopeId) return experimentMembers(graph, scopeId, false);
  return new Set(
    graph.nodes.filter((node) => !experimentOwner(graph, node.id)).map((node) => node.id),
  );
};

/**
 * How many corrected protocols one experiment may take. Bounding them keeps a planner
 * that keeps "fixing" the same instrument from spending the goal's budget without ever
 * changing the question.
 */
export const MAX_PROTOCOL_REVISIONS = 2;

/** A node that replaces an earlier protocol, rather than opening a new branch. */
export const isProtocolRevision = (graph: Graph, nodeId: string): boolean =>
  graph.edges.some((edge) => edge.kind === 'revises' && edge.sourceNodeId === nodeId);

/**
 * Corrections already aimed at this experiment, following a standalone chain back to
 * its origin so revising the latest attempt cannot hand the budget back.
 */
export const protocolRevisionCount = (graph: Graph, targetId: string): number => {
  const revisions = graph.edges.filter((edge) => edge.kind === 'revises');
  const seen = new Set<string>();
  let cursor: string | undefined = targetId;
  let count = 0;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    count += revisions.filter((edge) => edge.targetNodeId === cursor).length;
    cursor = revisions.find((edge) => edge.sourceNodeId === cursor)?.targetNodeId;
  }
  return count;
};

/**
 * The experiment whose results a node's run should carry.
 *
 * A corrected protocol has its own provenance edge, so it must be preferred over the
 * container's: reading the container's would hand the run the results of the older
 * experiment that container was itself branched from.
 */
export const provenanceParentId = (graph: Graph, nodeId: string): string | undefined =>
  (
    graph.edges.find(
      (edge) =>
        (edge.kind === 'revises' || edge.kind === 'derived_from') && edge.sourceNodeId === nodeId,
    ) ??
    graph.edges.find(
      (edge) =>
        edge.kind === 'derived_from' &&
        edge.sourceNodeId === (experimentOwner(graph, nodeId) ?? nodeId),
    )
  )?.targetNodeId;

/**
 * Every node whose work belongs to this experiment: its container members plus the
 * corrections aimed at it. A correction re-runs the same question, so its findings and
 * produced versions are the experiment's evidence — without this the planner would
 * keep reading the pre-correction result and never see what the rerun found.
 */
export const experimentScope = (graph: Graph, nodeId: string): Set<string> => {
  const scope = experimentMembers(graph, nodeId);
  scope.add(nodeId);
  for (;;) {
    const next = graph.edges.filter(
      (edge) =>
        edge.kind === 'revises' && scope.has(edge.targetNodeId) && !scope.has(edge.sourceNodeId),
    );
    if (!next.length) return scope;
    for (const edge of next) {
      scope.add(edge.sourceNodeId);
      for (const member of experimentMembers(graph, edge.sourceNodeId)) scope.add(member);
    }
  }
};
