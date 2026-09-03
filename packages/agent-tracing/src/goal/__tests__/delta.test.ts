import { describe, expect, it } from 'vitest';

import { applyGraphDelta, buildGraphShape, computeGraphDelta, reconstructGraphAt } from '../delta';
import type { GoalTickSnapshot, GoalTrajectory } from '../types';
import { edge, graph, node } from './fixtures';

describe('computeGraphDelta', () => {
  it('returns undefined when nothing moved', () => {
    const state = graph({ nodes: [node('a')] });
    expect(computeGraphDelta(state, { ...state, nodes: [node('a')] })).toBeUndefined();
  });

  it('emits only the entities that changed', () => {
    const before = graph({ nodes: [node('a'), node('b')] });
    const after = graph({
      nodes: [node('a'), node('b', { status: 'resolved' })],
    });

    expect(computeGraphDelta(before, after)).toEqual({
      nodesUpserted: [node('b', { status: 'resolved' })],
    });
  });

  it('records removals and goal-level changes', () => {
    const before = graph({ edges: [edge('e1', 'a', 'b')], nodes: [node('a')] });
    const after = graph({ goal: { ...before.goal, status: 'achieved' }, nodes: [] });

    expect(computeGraphDelta(before, after)).toEqual({
      edgesRemoved: ['e1'],
      goal: { status: 'achieved' },
      nodesRemoved: ['a'],
    });
  });
});

describe('applyGraphDelta', () => {
  it('round-trips a diff', () => {
    const before = graph({ nodes: [node('a')] });
    const after = graph({
      edges: [edge('e1', 'a', 'b')],
      nodes: [node('a', { status: 'active' }), node('b')],
    });

    expect(applyGraphDelta(before, computeGraphDelta(before, after))).toEqual(after);
  });

  it('leaves the input untouched', () => {
    const before = graph({ nodes: [node('a')] });
    applyGraphDelta(before, { nodesUpserted: [node('b')] });
    expect(before.nodes).toHaveLength(1);
  });
});

const tick = (index: number, overrides: Partial<GoalTickSnapshot> = {}): GoalTickSnapshot => ({
  at: 0,
  branch: 'dispatch_task',
  budget: { costLimitReached: false, roundLimitReached: false, runs: 0, totalCost: 0 },
  candidates: [],
  effects: [],
  graphShape: {
    edgesTotal: 0,
    findings: 0,
    gatesPending: 0,
    nodesTotal: 0,
    tasksBlocked: 0,
    tasksOpen: 0,
    tasksReady: 0,
    tasksCompleted: 0,
  },
  index,
  message: '',
  outcome: 'advanced',
  ...overrides,
});

describe('reconstructGraphAt', () => {
  it('replays the state the coordinator read entering a tick', () => {
    const trajectory = {
      advances: [
        {
          completedAt: 2,
          durationMs: 2,
          seq: 0,
          startedAt: 0,
          ticks: [
            tick(0),
            tick(1, { graphDelta: { nodesUpserted: [node('a', { status: 'active' })] } }),
          ],
          trigger: 'create' as const,
        },
        {
          completedAt: 4,
          durationMs: 1,
          seq: 1,
          startedAt: 3,
          ticks: [tick(0, { graphDelta: { nodesUpserted: [node('a', { status: 'resolved' })] } })],
          trigger: 'settle' as const,
        },
      ],
      goalId: 'goal_1',
      graphBaseline: graph({ nodes: [node('a')] }),
      startedAt: 0,
      title: 'Reproduce nanoGPT',
      totalAdvances: 2,
      totalTicks: 3,
      traceId: 'goal_1',
    } satisfies GoalTrajectory;

    expect(reconstructGraphAt(trajectory, 0, 0).nodes[0].status).toBe('proposed');
    expect(reconstructGraphAt(trajectory, 0, 1).nodes[0].status).toBe('active');
    expect(reconstructGraphAt(trajectory, 1, 0).nodes[0].status).toBe('resolved');
  });
});

describe('buildGraphShape', () => {
  it('splits open tasks into ready and blocked by unresolved dependencies', () => {
    const state = graph({
      edges: [edge('e1', 'b', 'a')],
      nodes: [
        node('a', { status: 'active' }),
        node('b'),
        node('c', { kind: 'finding', status: 'resolved' }),
      ],
    });

    expect(buildGraphShape(state)).toMatchObject({
      findings: 1,
      nodesTotal: 3,
      tasksBlocked: 1,
      tasksOpen: 2,
      tasksReady: 1,
      tasksCompleted: 0,
    });
  });

  it('counts a task ready once its dependency resolves', () => {
    const state = graph({
      edges: [edge('e1', 'b', 'a')],
      nodes: [node('a', { status: 'resolved' }), node('b')],
    });

    expect(buildGraphShape(state)).toMatchObject({
      tasksBlocked: 0,
      tasksReady: 1,
      tasksCompleted: 1,
    });
  });
});
