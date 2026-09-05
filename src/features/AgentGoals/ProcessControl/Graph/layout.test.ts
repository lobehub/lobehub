import type { GoalGraphEdge, GoalGraphNode } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { hideKinds, layoutGraph } from './layout';

const node = (id: string, kind: GoalGraphNode['kind'] = 'task'): GoalGraphNode => ({
  confidence: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  createdByAgentId: null,
  createdByUserId: null,
  description: null,
  goalId: 'g',
  id,
  kind,
  priority: 0,
  resolvedAt: null,
  status: 'proposed',
  taskId: null,
  title: id,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
});

const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  kind: GoalGraphEdge['kind'],
): GoalGraphEdge => ({
  createdAt: new Date('2026-08-01T00:00:00Z'),
  goalId: 'g',
  id: `${sourceNodeId}-${targetNodeId}`,
  kind,
  sourceNodeId,
  targetNodeId,
});

describe('layoutGraph', () => {
  it('puts a decomposed task below the problem it came from', () => {
    const boxes = layoutGraph(
      [node('p1', 'problem'), node('w1')],
      [edge('p1', 'w1', 'decomposes')],
    );

    expect(boxes.w1.y).toBeGreaterThan(boxes.p1.y);
  });

  it('puts a blocker above the task waiting on it', () => {
    const boxes = layoutGraph([node('w1'), node('w2')], [edge('w2', 'w1', 'depends_on')]);

    expect(boxes.w1.y).toBeLessThan(boxes.w2.y);
  });

  it('does not let a finding-to-problem support edge push the problem down', () => {
    const boxes = layoutGraph(
      [node('p1', 'problem'), node('w1'), node('f1', 'finding')],
      [edge('p1', 'w1', 'decomposes'), edge('w1', 'f1', 'produces'), edge('f1', 'p1', 'supports')],
    );

    expect(boxes.p1.y).toBeLessThan(boxes.w1.y);
    expect(boxes.w1.y).toBeLessThan(boxes.f1.y);
  });

  it('spreads siblings across one row instead of stacking them', () => {
    const boxes = layoutGraph(
      [node('p1', 'problem'), node('w1'), node('w2')],
      [edge('p1', 'w1', 'decomposes'), edge('p1', 'w2', 'decomposes')],
    );

    expect(boxes.w1.y).toBe(boxes.w2.y);
    expect(boxes.w1.x).not.toBe(boxes.w2.x);
  });

  it('terminates on a cycle instead of relaxing forever', () => {
    const boxes = layoutGraph(
      [node('w1'), node('w2')],
      [edge('w1', 'w2', 'leads_to'), edge('w2', 'w1', 'leads_to')],
    );

    expect(Object.keys(boxes)).toHaveLength(2);
  });
});

describe('hideKinds', () => {
  const chain = {
    edges: [edge('p1', 'w1', 'decomposes'), edge('w1', 'f1', 'produces')],
    nodes: [node('p1', 'problem'), node('w1'), node('f1', 'finding')],
  };

  it('keeps everything and bridges nothing when no kind is hidden', () => {
    const { bridges, visibleIds } = hideKinds(chain.nodes, chain.edges, new Set());

    expect([...visibleIds].sort()).toEqual(['f1', 'p1', 'w1']);
    expect(bridges).toEqual([]);
  });

  it('bridges the problem to the finding when the task between them is hidden', () => {
    const { bridges, visibleIds } = hideKinds(chain.nodes, chain.edges, new Set(['task']));

    expect(visibleIds.has('w1')).toBe(false);
    expect(bridges).toEqual([{ sourceNodeId: 'p1', targetNodeId: 'f1' }]);
  });

  it('keeps a bridged finding ranked below the problem', () => {
    const { bridges, visibleIds } = hideKinds(chain.nodes, chain.edges, new Set(['task']));
    const boxes = layoutGraph(
      chain.nodes.filter((n) => visibleIds.has(n.id)),
      bridges.map((bridge) => ({ ...bridge, kind: 'leads_to' as const })),
    );

    expect(boxes.f1.y).toBeGreaterThan(boxes.p1.y);
  });

  it('bridges through consecutive hidden hops', () => {
    const { bridges } = hideKinds(
      [node('p1', 'problem'), node('w1'), node('w2'), node('f1', 'finding')],
      [edge('p1', 'w1', 'decomposes'), edge('w1', 'w2', 'leads_to'), edge('w2', 'f1', 'produces')],
      new Set(['task']),
    );

    expect(bridges).toEqual([{ sourceNodeId: 'p1', targetNodeId: 'f1' }]);
  });

  it('does not add a bridge that duplicates a surviving direct edge', () => {
    const { bridges } = hideKinds(
      [node('p1', 'problem'), node('w1'), node('f1', 'finding')],
      [edge('p1', 'w1', 'decomposes'), edge('w1', 'f1', 'produces'), edge('p1', 'f1', 'leads_to')],
      new Set(['task']),
    );

    expect(bridges).toEqual([]);
  });

  it('survives a cycle among hidden nodes', () => {
    const { bridges } = hideKinds(
      [node('p1', 'problem'), node('w1'), node('w2'), node('f1', 'finding')],
      [
        edge('p1', 'w1', 'decomposes'),
        edge('w1', 'w2', 'leads_to'),
        edge('w2', 'w1', 'leads_to'),
        edge('w2', 'f1', 'produces'),
      ],
      new Set(['task']),
    );

    expect(bridges).toEqual([{ sourceNodeId: 'p1', targetNodeId: 'f1' }]);
  });
});
