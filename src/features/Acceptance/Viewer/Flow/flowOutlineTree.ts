import type { Edge, Node } from '@xyflow/react';

import type { FlowGraphData } from './flowGraph';

export interface OutlineBranch {
  edge: Edge;
  /** The step listed under this branch; null when the target is already listed elsewhere. */
  step: OutlineStep | null;
  target: Node<FlowGraphData>;
}

export interface OutlineStep {
  branches: OutlineBranch[];
  /** Members of a group node, in reading order. */
  members: OutlineStep[];
  node: Node<FlowGraphData>;
}

/**
 * Turns the flat canvas graph into a reading order: every check is listed once, the
 * first time a path from an entry reaches it, and the steps that depend on it hang
 * beneath its branches. Later paths to an already listed step become references.
 */
export function buildOutlineTree(
  nodes: Node<FlowGraphData>[],
  edges: Edge[],
  parentId?: string,
): OutlineStep[] {
  const siblings = nodes.filter((node) => (node.parentId ?? undefined) === parentId);
  const byId = new Map(siblings.map((node) => [node.id, node]));
  const links = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const incoming = new Set(links.map((edge) => edge.target));
  const visited = new Set<string>();
  const build = (node: Node<FlowGraphData>): OutlineStep => {
    visited.add(node.id);
    const branches: OutlineBranch[] = [];
    for (const edge of links) {
      if (edge.source !== node.id) continue;
      const target = byId.get(edge.target)!;
      branches.push({ edge, step: visited.has(target.id) ? null : build(target), target });
    }
    return {
      branches,
      members: node.type === 'flowGroup' ? buildOutlineTree(nodes, edges, node.id) : [],
      node,
    };
  };
  const roots: OutlineStep[] = [];
  const entries = siblings.filter((node) => !incoming.has(node.id));
  for (const node of entries.length ? entries : siblings)
    if (!visited.has(node.id)) roots.push(build(node));
  for (const node of siblings) if (!visited.has(node.id)) roots.push(build(node));
  return roots;
}
