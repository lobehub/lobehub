import type { Edge, Node } from '@xyflow/react';

import type { FlowVersion } from './flowNavigation';
import { getFlowNodeState } from './flowNodeState';

export interface FlowGraphData extends Record<string, unknown> {
  collapsed?: boolean;
  onEnter?: () => void;
  onToggle?: () => void;
  passed?: number;
  reviewed?: number;
  state?: 'passed' | 'failed' | 'uncertain' | 'blocked' | 'partial';
  title: string;
  total?: number;
}

export interface FlowGraphView {
  id: string;
  roundIndex?: number;
  run?: FlowVersion['runs'][number];
  version: FlowVersion;
}

/**
 * The gutter between two columns. A branch caption sits in the middle of it, so
 * it has to fit prose AND leave the caption clear of the cards on either side.
 */
const COLUMN_GAP = 248;
const ROW_GAP = 64;
/** A business flow with a single state is its own header — a group box around it says nothing. */
const isSoloState = (view: FlowGraphView) =>
  view.version.nodes.length === 1 && !view.version.nodes[0].subFlowId;

export function buildFlowGraph(
  views: FlowGraphView[],
  collapsed: Set<string>,
  selected: string | undefined,
  onToggle: (id: string) => void,
  onEnter: (id: string) => void,
  focus?: string,
) {
  const nodes: Node<FlowGraphData>[] = [];
  const edges: Edge[] = [];
  const groups = new Map<string, { title: string; parent?: string }>();
  const checks = new Map<string, { view: FlowGraphView; node: FlowVersion['nodes'][number] }>();
  const transitions = new Map<
    string,
    { view: FlowGraphView; edge: FlowVersion['edges'][number] }
  >();
  const graphId = (view: FlowGraphView, id: string) => `${view.id}/${id}`;

  for (const view of views) {
    groups.set(view.id, { title: view.version.title });
    for (const node of view.version.nodes) {
      const id = graphId(view, node.id);
      if (node.subFlowId)
        groups.set(id, {
          title: node.title,
          parent: node.parentNodeId ? graphId(view, node.parentNodeId) : view.id,
        });
      else checks.set(id, { view, node });
    }
    for (const edge of view.version.edges) transitions.set(graphId(view, edge.id), { view, edge });
  }

  const aggregate = (view: FlowGraphView, ids: string[], required: string[]) => {
    const visits = (view.run?.attempts ?? []).filter((item) => ids.includes(item.checkItemId));
    const latest = new Map(visits.map((item) => [item.checkItemId, item]));
    const targets = new Set([...required, ...latest.keys()]);
    const states = [...targets].map((id) => latest.get(id)?.verdict);
    const state = states.includes('failed')
      ? 'failed'
      : states.includes('blocked')
        ? 'blocked'
        : states.includes('uncertain')
          ? 'uncertain'
          : states.length && states.every((s) => s === 'passed')
            ? 'passed'
            : states.some(Boolean)
              ? 'partial'
              : undefined;
    return {
      state,
      total: targets.size || ids.length,
      passed: states.filter((s) => s === 'passed').length,
      reviewed: visits.filter((v) => v.review === 'accepted').length,
    } as Pick<FlowGraphData, 'state' | 'total' | 'passed' | 'reviewed'>;
  };

  function layout(
    view: FlowGraphView,
    parentNodeId?: string,
    parentGraphId = view.id,
  ): { width: number; height: number; nodes: Node<FlowGraphData>[]; edges: Edge[] } {
    const siblings = view.version.nodes.filter((node) => node.parentNodeId === parentNodeId);
    const ids = new Set(siblings.map((node) => node.id));
    const links = view.version.edges.filter(
      (edge) => ids.has(edge.sourceNodeKey) && ids.has(edge.targetNodeKey),
    );
    const depths = new Map(siblings.map((node) => [node.id, 0]));
    const backEdges = new Set<string>();
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      visiting.add(id);
      for (const edge of links.filter((edge) => edge.sourceNodeKey === id)) {
        if (visiting.has(edge.targetNodeKey)) backEdges.add(edge.id);
        else visit(edge.targetNodeKey);
      }
      visiting.delete(id);
    };
    for (const node of [...siblings.filter((node) => node.isEntry), ...siblings]) visit(node.id);
    const forward = links.filter((edge) => !backEdges.has(edge.id));
    const incoming = new Map(
      siblings.map((node) => [
        node.id,
        forward.filter((edge) => edge.targetNodeKey === node.id).length,
      ]),
    );
    const queue = siblings.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    for (let i = 0; i < queue.length; i++)
      for (const edge of forward.filter((edge) => edge.sourceNodeKey === queue[i])) {
        depths.set(
          edge.targetNodeKey,
          Math.max(depths.get(edge.targetNodeKey)!, depths.get(queue[i])! + 1),
        );
        incoming.set(edge.targetNodeKey, incoming.get(edge.targetNodeKey)! - 1);
        if (incoming.get(edge.targetNodeKey) === 0) queue.push(edge.targetNodeKey);
      }
    // Expanded business flows form readable lanes; their internal checks remain left-to-right.
    const stacked = siblings.length > 1 && siblings.every((node) => node.subFlowId);
    const orderedSiblings = [...siblings].sort(
      (a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0),
    );
    if (stacked) for (const node of siblings) depths.set(node.id, 0);
    const parts = orderedSiblings.map((node) => {
      const id = graphId(view, node.id);
      // Two title lines, two expected lines and the footer; the card clamps to this box.
      if (!node.subFlowId) return { node, id, width: 260, height: 132 };
      const child = collapsed.has(id) ? undefined : layout(view, node.id, id);
      return { node, id, child, width: child?.width ?? 320, height: child?.height ?? 96 };
    });
    const columnWidths = new Map<number, number>();
    for (const part of parts) {
      const depth = depths.get(part.node.id) ?? 0;
      columnWidths.set(depth, Math.max(columnWidths.get(depth) ?? 0, part.width));
    }
    const columnX = new Map<number, number>();
    let x = 24;
    for (const depth of [...columnWidths.keys()].sort((a, b) => a - b)) {
      columnX.set(depth, x);
      x += columnWidths.get(depth)! + COLUMN_GAP;
    }
    const columnY = new Map<number, number>();
    const resultNodes: Node<FlowGraphData>[] = [];
    let bottom = 64;
    for (const part of parts) {
      const { node, id } = part;
      const depth = depths.get(node.id) ?? 0;
      const y = columnY.get(depth) ?? 64;
      columnY.set(depth, y + part.height + ROW_GAP);
      bottom = Math.max(bottom, y + part.height);
      const visits = (view.run?.attempts ?? []).filter((v) => v.nodeId === node.id);
      const data: FlowGraphData = node.subFlowId
        ? {
            title: node.title,
            ...aggregate(view, node.checkItemIds, node.requiredCheckItemIds),
            collapsed: collapsed.has(id),
            onToggle: () => onToggle(id),
            onEnter: () => onEnter(id),
          }
        : {
            title: node.title,
            expected: node.expected,
            selected:
              selected === id || transitions.get(selected ?? '')?.edge.targetNodeKey === node.id,
            state: getFlowNodeState(
              node.nodeKey,
              node.isEntry ? node.nodeKey : '',
              view.version.edges,
              visits,
              node.entryRequired,
            ),
            attempts: visits.length,
            evidence: visits.flatMap((v) => v.evidence.filter((e) => e.fileUrl)).length,
          };
      resultNodes.push({
        id,
        type: node.subFlowId ? 'flowGroup' : 'state',
        parentId: parentGraphId,
        position: { x: columnX.get(depth) ?? 24, y },
        width: part.width,
        height: part.height,
        data,
        style: node.subFlowId ? { width: part.width, height: part.height } : undefined,
      });
      if (part.child) resultNodes.push(...part.child.nodes);
    }
    const resultEdges: Edge[] = links.map((edge) => {
      const id = graphId(view, edge.id);
      const peers = links.filter(
        (other) =>
          other.sourceNodeKey === edge.sourceNodeKey && other.targetNodeKey === edge.targetNodeKey,
      );
      const distance =
        (depths.get(edge.targetNodeKey) ?? 0) - (depths.get(edge.sourceNodeKey) ?? 0);
      const returning = distance <= 0 || distance > 1;
      return {
        id,
        source: graphId(view, edge.sourceNodeKey),
        target: graphId(view, edge.targetNodeKey),
        type: 'transition',
        label: edge.trigger,
        sourceHandle: stacked ? 'stack-out' : returning ? 'return-out' : 'out',
        targetHandle: stacked ? 'stack-in' : returning ? 'return-in' : 'in',
        data: { laneOffset: (peers.indexOf(edge) - (peers.length - 1) / 2) * 64 },
      };
    });
    for (const part of parts) if (part.child) resultEdges.push(...part.child.edges);
    return {
      nodes: resultNodes,
      edges: resultEdges,
      width: Math.max(360, x - COLUMN_GAP + 24),
      height: bottom + 56,
    };
  }

  let top = 0;
  for (const view of views) {
    const focusedNode = view.version.nodes.find(
      (n) => graphId(view, n.id) === focus && n.subFlowId,
    );
    if (focus && focus !== view.id && !focusedNode) continue;
    const id = focus ?? view.id;
    // Inside a focused group the breadcrumb already names it, so render its members
    // directly on the canvas instead of wrapping them in the group container.
    if (focus) {
      const focused = layout(view, focusedNode?.id, id);
      for (const node of focused.nodes)
        nodes.push(node.parentId === id ? { ...node, parentId: undefined } : node);
      edges.push(...focused.edges);
      continue;
    }
    if (isSoloState(view)) {
      const [solo] = layout(view, undefined, id).nodes;
      nodes.push({ ...solo, parentId: undefined, position: { x: 0, y: top } });
      top += solo.height! + 48;
      continue;
    }
    const child = collapsed.has(id) ? undefined : layout(view, undefined, id);
    const leafNodes = view.version.nodes.filter((node) => !node.subFlowId);
    const summary = aggregate(
      view,
      leafNodes.flatMap((n) => n.checkItemIds),
      leafNodes.flatMap((n) => n.requiredCheckItemIds),
    );
    const height = child?.height ?? 96;
    nodes.push({
      id,
      type: 'flowGroup',
      position: { x: 0, y: top },
      width: child?.width ?? 360,
      height,
      style: { width: child?.width ?? 360, height },
      data: {
        title: view.version.title,
        ...summary,
        collapsed: !child,
        onToggle: () => onToggle(id),
        onEnter: () => onEnter(id),
      },
    });
    if (child) {
      nodes.push(...child.nodes);
      edges.push(...child.edges);
    }
    top += height + 48;
  }
  const visibleNodes = new Set(nodes.map((node) => node.id));
  const visibleEdges = new Set(edges.map((edge) => edge.id));
  return {
    nodes,
    edges,
    groups,
    checks: new Map([...checks].filter(([id]) => visibleNodes.has(id))),
    transitions: new Map([...transitions].filter(([id]) => visibleEdges.has(id))),
  };
}
