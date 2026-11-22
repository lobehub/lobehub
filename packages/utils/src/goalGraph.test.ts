import type { GoalGraphNode, GoalGraphSnapshot, GoalNodeKind } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  experimentMembers,
  experimentStatus,
  graphScopeIds,
  isBatchTemplate,
  isMarkKind,
  isProtocolRevision,
  protocolRevisionCount,
  provenanceParentId,
  withoutMarks,
} from './goalGraph';

const node = (
  id: string,
  kind: GoalNodeKind,
  status: GoalGraphNode['status'] = 'proposed',
): GoalGraphNode => ({
  id,
  kind,
  status,
  title: id,
  goalId: 'goal',
  description: null,
  confidence: null,
  taskId: null,
  priority: 0,
  createdByAgentId: null,
  createdByUserId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  resolvedAt: null,
});
const graph = (): Pick<GoalGraphSnapshot, 'nodes' | 'edges'> => ({
  nodes: [
    node('q', 'problem'),
    node('answer', 'experiment'),
    node('task', 'task', 'resolved'),
    node('finding', 'finding', 'resolved'),
    node('subq', 'problem'),
    node('nested', 'experiment'),
    node('gate', 'decision', 'waiting'),
  ],
  edges: [
    ['answer', 'q', 'answers'],
    ['answer', 'task', 'contains'],
    ['answer', 'finding', 'contains'],
    ['answer', 'subq', 'contains'],
    ['answer', 'nested', 'contains'],
    ['nested', 'subq', 'answers'],
    ['nested', 'gate', 'contains'],
  ].map(([sourceNodeId, targetNodeId, kind]) => ({
    id: sourceNodeId + targetNodeId,
    sourceNodeId,
    targetNodeId,
    kind: kind as GoalGraphSnapshot['edges'][number]['kind'],
    goalId: 'goal',
    createdAt: new Date(0),
  })),
});

describe('experiment containment', () => {
  it('shows the answer at root and only direct members at each nested level', () => {
    const g = graph();
    expect(graphScopeIds(g)).toEqual(new Set(['q', 'answer']));
    expect(graphScopeIds(g, 'answer')).toEqual(new Set(['task', 'finding', 'subq', 'nested']));
    expect(graphScopeIds(g, 'nested')).toEqual(new Set(['gate']));
    expect(experimentMembers(g, 'answer')).toEqual(
      new Set(['task', 'finding', 'subq', 'nested', 'gate']),
    );
  });
  it('keeps empty or unanswered branches open', () => {
    const g = graph();
    g.nodes.find((n) => n.id === 'gate')!.status = 'resolved';
    g.edges = g.edges.filter((e) => e.targetNodeId !== 'gate');
    expect(experimentStatus(g, g.nodes[1])).toBe('active');
    g.nodes = g.nodes.filter((n) => n.id !== 'nested');
    g.edges = g.edges.filter((e) => e.sourceNodeId !== 'nested' && e.targetNodeId !== 'nested');
    expect(experimentStatus(g, g.nodes[1])).toBe('active');
  });
  it('a completed task cannot complete its container while a nested decision is pending', () => {
    const g = graph();
    expect(experimentStatus(g, g.nodes[1])).toBe('waiting');
    g.nodes.find((n) => n.id === 'gate')!.status = 'resolved';
    expect(experimentStatus(g, g.nodes[1])).toBe('resolved');
    g.nodes.push(node('new-task', 'task'));
    g.edges.push({ ...g.edges[1], id: 'new-edge', targetNodeId: 'new-task' });
    expect(experimentStatus(g, g.nodes[1])).toBe('active');
  });
});

describe('provenance and protocol revisions', () => {
  const graph = {
    edges: [
      { kind: 'contains', sourceNodeId: 'exp', targetNodeId: 'run1' },
      { kind: 'contains', sourceNodeId: 'exp', targetNodeId: 'fix1' },
      { kind: 'derived_from', sourceNodeId: 'exp', targetNodeId: 'older' },
      { kind: 'derived_from', sourceNodeId: 'hand', targetNodeId: 'older' },
      { kind: 'contains', sourceNodeId: 'exp', targetNodeId: 'hand' },
      { kind: 'revises', sourceNodeId: 'fix1', targetNodeId: 'exp' },
    ],
    nodes: [
      { id: 'older', kind: 'experiment' },
      { id: 'exp', kind: 'experiment' },
      { id: 'run1', kind: 'task' },
      { id: 'hand', kind: 'task' },
      { id: 'fix1', kind: 'task' },
    ],
  } as any;

  it('gives a corrected protocol its own parent rather than its container’s', () => {
    // `fix1` corrects `exp`; reading the container would hand it `older` instead.
    expect(provenanceParentId(graph, 'fix1')).toBe('exp');
    // An ordinary member falls back to its container's branch parent.
    expect(provenanceParentId(graph, 'run1')).toBe('older');
    // A hand-authored provenance edge is preferred over the container's, and is
    // still not treated as a correction.
    expect(provenanceParentId(graph, 'hand')).toBe('older');
  });

  it('separates a correction from an ordinary branch when counting', () => {
    expect(isProtocolRevision(graph, 'fix1')).toBe(true);
    // `exp` also has a `derived_from` edge, but it is a branch, not a correction.
    expect(isProtocolRevision(graph, 'exp')).toBe(false);
    // A hand-authored task provenance edge is not a correction either.
    expect(isProtocolRevision(graph, 'hand')).toBe(false);
    expect(protocolRevisionCount(graph, 'exp')).toBe(1);
    expect(protocolRevisionCount(graph, 'older')).toBe(0);
  });
});

describe('marks', () => {
  const withMarks = () => {
    const base = graph();
    return {
      edges: [
        ...base.edges,
        ...[
          ['task', 'pattern', 'produces'],
          ['task', 'hazard', 'confirms'],
        ].map(([sourceNodeId, targetNodeId, kind]) => ({
          ...base.edges[0],
          id: sourceNodeId + targetNodeId,
          kind: kind as GoalGraphSnapshot['edges'][number]['kind'],
          sourceNodeId,
          targetNodeId,
        })),
      ],
      nodes: [...base.nodes, node('pattern', 'pattern', 'active'), node('hazard', 'hazard')],
    };
  };

  it('recognizes only the four mark kinds', () => {
    expect(['pattern', 'tool', 'hazard', 'dead_end'].every(isMarkKind)).toBe(true);
    expect(['finding', 'template', 'task'].some(isMarkKind)).toBe(false);
  });

  it('leaves marks and every edge touching them out of the planning view', () => {
    const view = withoutMarks(withMarks());
    expect(view.nodes.map((item) => item.id)).toEqual(graph().nodes.map((item) => item.id));
    expect(view.edges).toEqual(graph().edges);
  });

  it('returns the same graph when it holds no marks', () => {
    const plain = graph();
    expect(withoutMarks(plain)).toBe(plain);
  });

  it('reads a recipe from its own kind or from the titled finding older batches wrote', () => {
    expect(isBatchTemplate({ kind: 'template', title: 'anything' })).toBe(true);
    expect(isBatchTemplate({ kind: 'finding', title: 'Batch recipe' })).toBe(true);
    expect(isBatchTemplate({ kind: 'finding', title: 'Completed: probe 1' })).toBe(false);
  });
});
