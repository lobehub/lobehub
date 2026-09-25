import type { GoalGraphEdge, GoalGraphNode, GoalItem, GoalStatus } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildGoalGraphView } from '../goalGraphViewModel';
import { isStageWholeMap, stageNodeIds } from './viewMode';

const T0 = new Date('2026-08-01T00:00:00Z');

const goal = (status: GoalStatus): GoalItem => ({
  agentId: 'agt',
  completedAt: null,
  config: {},
  createdAt: T0,
  id: 'goal-1',
  maxRounds: null,
  maxTotalCost: null,
  projectId: null,
  requirement: 'ship it',
  startedAt: T0,
  status,
  subjectId: null,
  subjectType: 'standalone',
  title: 'Goal',
  updatedAt: T0,
  userId: 'user-1',
  workspaceId: null,
});

const node = (id: string, status: GoalGraphNode['status']): GoalGraphNode => ({
  confidence: null,
  createdAt: T0,
  createdByAgentId: null,
  createdByUserId: null,
  description: null,
  goalId: 'goal-1',
  id,
  kind: 'task',
  priority: 0,
  resolvedAt: null,
  status,
  taskId: null,
  title: id,
  updatedAt: T0,
});

const dependsOn = (source: string, target: string): GoalGraphEdge => ({
  createdAt: T0,
  goalId: 'goal-1',
  id: `${source}-${target}`,
  kind: 'depends_on',
  sourceNodeId: source,
  targetNodeId: target,
});

/** w3 waits on w2, which waits on w1 — the stage view stops at w2. */
const graph = (status: GoalStatus, nodeStatus: GoalGraphNode['status']) =>
  buildGoalGraphView(
    {
      decisions: [],
      edges: [dependsOn('w2', 'w1'), dependsOn('w3', 'w2')],
      events: [],
      goal: goal(status),
      nodes: [node('w1', nodeStatus), node('w2', 'proposed'), node('w3', 'proposed')],
      workVersions: [],
    },
    T0.getTime(),
  );

describe('isStageWholeMap', () => {
  it('keeps the switch while the stage view hides part of a live goal', () => {
    const view = graph('running', 'proposed');
    expect(stageNodeIds(view).size).toBeLessThan(view.nodes.length);
    expect(isStageWholeMap(view)).toBe(false);
  });

  it('drops the switch once the goal has finished', () => {
    for (const status of ['achieved', 'failed', 'canceled'] as const)
      expect(isStageWholeMap(graph(status, 'proposed'))).toBe(true);
  });

  it('drops the switch when every node is already in the stage', () => {
    const view = buildGoalGraphView(
      {
        decisions: [],
        edges: [],
        events: [],
        goal: goal('paused'),
        nodes: [node('w1', 'resolved'), node('w2', 'resolved')],
        workVersions: [],
      },
      T0.getTime(),
    );
    expect(isStageWholeMap(view)).toBe(true);
  });
});
