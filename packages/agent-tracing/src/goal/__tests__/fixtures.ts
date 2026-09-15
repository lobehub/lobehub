import type { GoalGraphState, GoalTraceEdge, GoalTraceNode } from '../types';

export const node = (id: string, overrides: Partial<GoalTraceNode> = {}): GoalTraceNode => ({
  createdAt: 1000,
  id,
  kind: 'task',
  priority: 0,
  status: 'proposed',
  title: id,
  ...overrides,
});

export const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  kind = 'depends_on',
): GoalTraceEdge => ({ id, kind, sourceNodeId, targetNodeId });

export const graph = (overrides: Partial<GoalGraphState> = {}): GoalGraphState => ({
  decisions: [],
  edges: [],
  goal: {
    id: 'goal_1',
    maxRounds: null,
    maxTotalCost: null,
    status: 'running',
    title: 'Reproduce nanoGPT',
  },
  nodes: [],
  ...overrides,
});
