import { describe, expect, it } from 'vitest';

import { resolveMainline } from '@/features/AgentGoals/ProcessControl/Graph/mainline';

import { sharedGoalToGraphView } from './sharedGoalGraph';
import type { SharedGoalData } from './sharedGoalTypes';

const view: SharedGoalData = {
  acceptance: null,
  edges: [
    { from: 'n1', id: 'e1', kind: 'decomposes', to: 'n2' },
    { from: 'n1', id: 'e2', kind: 'decomposes', to: 'n3' },
    { from: 'n1', id: 'e3', kind: 'decomposes', to: 'n9' },
  ],
  goal: { requirement: 'Ship the thing', status: 'achieved', title: 'Ship' },
  isOwner: false,
  nodes: [
    { dependsOn: [], id: 'n1', kind: 'problem', status: 'resolved', title: 'How to ship?' },
    { dependsOn: [], id: 'n2', kind: 'task', status: 'resolved', title: 'Build' },
    { dependsOn: [], id: 'n3', kind: 'task', status: 'retired', title: 'Detour' },
  ],
  report: {
    chapters: [
      {
        detours: [],
        findingIds: [],
        narrative: 'It shipped.',
        nodeIds: ['n1', 'n2'],
        title: 'Shipping',
      },
    ],
    headline: 'Shipped',
    mainline: { edgeIds: ['e1'], nodeIds: ['n1', 'n2'] },
    nextSteps: [],
  },
  visibility: 'link',
};

describe('sharedGoalToGraphView', () => {
  it('keeps the view-local node ids and drops edges that leave the shared graph', () => {
    const graph = sharedGoalToGraphView(view);

    expect(graph.nodes.map((item) => item.node.id)).toEqual(['n1', 'n2', 'n3']);
    expect(graph.edges.map((edge) => edge.id)).toEqual(['e1', 'e2']);
    expect(graph.goal.title).toBe('Ship');
  });

  it('carries the report mainline so the map can highlight it', () => {
    const mainline = resolveMainline(sharedGoalToGraphView(view));

    expect([...mainline!.nodeIds]).toEqual(['n1', 'n2']);
    expect([...mainline!.edgeIds]).toEqual(['e1']);
  });

  it('builds a plain map when the goal has no report', () => {
    const graph = sharedGoalToGraphView({ ...view, report: null });

    expect(graph.nodes).toHaveLength(3);
    expect(resolveMainline(graph)).toBeUndefined();
  });

  it('never exposes a real owner, task or cost on the nodes it builds', () => {
    const graph = sharedGoalToGraphView(view);

    for (const item of graph.nodes) {
      expect(item.node.taskId).toBeNull();
      expect(item.node.createdByUserId).toBeNull();
      expect(item.node.createdByAgentId).toBeNull();
    }
    expect(graph.goal.userId).toBe('');
  });
});
