import type { GoalGraphEdge, GoalGraphNode, GoalNodeKind } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { explorationMap } from './explorationMap';

const node = (id: string, kind: GoalNodeKind): GoalGraphNode => ({
  id,
  kind,
  title: id,
  goalId: 'g',
  status: 'proposed',
  taskId: null,
  confidence: null,
  description: null,
  priority: 0,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByAgentId: null,
  createdByUserId: null,
});
const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  kind: GoalGraphEdge['kind'],
): GoalGraphEdge => ({
  id: `${sourceNodeId}/${targetNodeId}/${kind}`,
  goalId: 'g',
  sourceNodeId,
  targetNodeId,
  kind,
  createdAt: new Date(),
});
const nodes = [
  node('q', 'problem'),
  node('a', 'experiment'),
  node('b', 'experiment'),
  node('t', 'task'),
  node('f', 'finding'),
  node('sq', 'problem'),
  node('nested', 'experiment'),
  node('nt', 'task'),
];
const edges = [
  edge('a', 'q', 'answers'),
  edge('b', 'q', 'answers'),
  edge('a', 't', 'contains'),
  edge('a', 'f', 'contains'),
  edge('a', 'sq', 'contains'),
  edge('a', 'nested', 'contains'),
  edge('nested', 'sq', 'answers'),
  edge('nested', 'nt', 'contains'),
  edge('t', 'f', 'produces'),
  edge('b', 'a', 'derived_from'),
  edge('f', 'b', 'supports'),
];

describe('the complete exploration map', () => {
  it('shows every node and exploration edge by default, enclosing nested work', () => {
    const map = explorationMap(nodes, edges, new Set());
    expect(map.nodes).toHaveLength(nodes.length);
    expect(map.edges.map((e) => e.id)).toEqual(
      edges.filter((e) => e.kind !== 'contains').map((e) => e.id),
    );
    expect(map.parents.get('nt')).toBe('nested');
    for (const [child, parent] of map.parents) {
      expect(map.nodes.findIndex((n) => n.id === parent)).toBeLessThan(
        map.nodes.findIndex((n) => n.id === child),
      );
      const box = map.boxes[child];
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(80);
      expect(box.x + box.width).toBeLessThanOrEqual(map.boxes[parent].width);
      expect(box.y + box.height).toBeLessThanOrEqual(map.boxes[parent].height);
    }
  });
  it('collapses only contained nodes and retains history and cross-boundary provenance', () => {
    const map = explorationMap(nodes, edges, new Set(['a']));
    expect(map.nodes.map((n) => n.id)).toEqual(['q', 'a', 'b']);
    expect(map.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'a',
        targetNodeId: 'b',
        kind: 'supports',
        originalSource: 'f',
        projected: true,
      }),
    );
    expect(map.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'b',
        targetNodeId: 'a',
        kind: 'derived_from',
        projected: false,
      }),
    );
    expect(map.edges.every((e) => e.sourceNodeId !== e.targetNodeId)).toBe(true);
    expect(explorationMap(nodes, edges, new Set()).nodes).toHaveLength(8);
  });
  it('preserves sibling branches while independently collapsing a nested experiment', () => {
    const map = explorationMap(nodes, edges, new Set(['nested']));
    expect(map.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['a', 'b', 't', 'f', 'sq', 'nested']),
    );
    expect(map.nodes.some((n) => n.id === 'nt')).toBe(false);
    expect(map.parents.get('nested')).toBe('a');
  });
  it('keeps 200 experiments and their non-linear historical branches in the overview', () => {
    const many = Array.from({ length: 200 }, (_, i) => node(`e${i}`, 'experiment'));
    const history = many
      .slice(1)
      .map((n, i) => edge(n.id, `e${Math.floor(i / 3)}`, 'derived_from'));
    const map = explorationMap(many, history, new Set());
    expect(map.nodes).toHaveLength(200);
    expect(map.edges).toHaveLength(199);
    expect(Object.values(map.boxes).every((b) => Object.values(b).every(Number.isFinite))).toBe(
      true,
    );
    expect(explorationMap(many, history, new Set(many.map((n) => n.id))).nodes).toHaveLength(200);
  });
});
