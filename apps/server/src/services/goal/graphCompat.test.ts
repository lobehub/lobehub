import type { GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { graphForClient } from './graphCompat';

const graph = {
  nodes: [
    { id: 'p', kind: 'problem' },
    { id: 'b', kind: 'batch' },
    { id: 't', kind: 'task' },
  ],
} as unknown as GoalGraphSnapshot;

describe('graphForClient', () => {
  it('sends a batch as an experiment container to a client that does not declare batches', () => {
    // A cached web bundle or an installed desktop app predates the kind.
    expect(graphForClient(graph).nodes.map((node) => node.kind)).toEqual([
      'problem',
      'experiment',
      'task',
    ]);
    expect(graphForClient(graph, ['other']).nodes[1].kind).toBe('experiment');
  });

  it('keeps the real kind for a client that renders batches', () => {
    expect(graphForClient(graph, ['batch'])).toBe(graph);
  });
});

describe('graphForClient with marks', () => {
  const marked = {
    edges: [
      { id: 'e1', kind: 'confirms', sourceNodeId: 't', targetNodeId: 'm' },
      { id: 'e2', kind: 'refutes', sourceNodeId: 't', targetNodeId: 'h' },
      { id: 'e3', kind: 'produces', sourceNodeId: 't', targetNodeId: 'm' },
    ],
    nodes: [
      { id: 't', kind: 'task' },
      { id: 'm', kind: 'pattern' },
      { id: 'h', kind: 'hazard' },
      { id: 'r', kind: 'template' },
    ],
  } as unknown as GoalGraphSnapshot;

  it('sends marks and recipes as findings, and their judgements as supports / contradicts', () => {
    const legacy = graphForClient(marked, ['batch']);
    expect(legacy.nodes.map((node) => node.kind)).toEqual([
      'task',
      'finding',
      'finding',
      'finding',
    ]);
    expect(legacy.edges.map((edge) => edge.kind)).toEqual(['supports', 'contradicts', 'produces']);
  });

  it('keeps a recipe-only graph’s edges untouched', () => {
    const recipe = {
      edges: [{ id: 'e', kind: 'contains', sourceNodeId: 'b', targetNodeId: 'r' }],
      nodes: [
        { id: 'b', kind: 'batch' },
        { id: 'r', kind: 'template' },
      ],
    } as unknown as GoalGraphSnapshot;
    const legacy = graphForClient(recipe, ['batch']);
    expect(legacy.nodes[1].kind).toBe('finding');
    expect(legacy.edges).toBe(recipe.edges);
  });

  it('keeps the real kinds for a client that renders marks', () => {
    expect(graphForClient(marked, ['batch', 'marks'])).toBe(marked);
  });
});
