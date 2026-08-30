import type { GoalGraphState, GoalTickSnapshot, GoalTrajectory } from '@lobechat/agent-tracing';
import { describe, expect, it } from 'vitest';

import { replayGoalAgainstCurrentCoordinator } from './replayCoordinator';

const work = (id: string, overrides: Partial<GoalGraphState['nodes'][number]> = {}) => ({
  createdAt: 1000,
  id,
  kind: 'task',
  priority: 0,
  status: 'proposed',
  taskId: null,
  title: id,
  ...overrides,
});

const graphState = (overrides: Partial<GoalGraphState> = {}): GoalGraphState => ({
  decisions: [],
  edges: [],
  goal: {
    id: 'goal_1',
    maxRounds: null,
    maxTotalCost: null,
    requirement: 'Prove it',
    status: 'running',
    title: 'Reproduce nanoGPT',
  },
  nodes: [],
  ...overrides,
});

const tick = (index: number, overrides: Partial<GoalTickSnapshot>): GoalTickSnapshot => ({
  at: 1000,
  branch: 'create_task',
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

/**
 * Two advances of a two-Work goal: the second Work depends on the first, so the
 * coordinator picks `a`, then picks `b` only once `a` resolves.
 */
const trajectory: GoalTrajectory = {
  advances: [
    {
      completedAt: 10,
      durationMs: 10,
      seq: 0,
      startedAt: 0,
      ticks: [
        tick(0, {
          candidates: [
            { blockedBy: [], nodeId: 'a', priority: 0, status: 'proposed', title: 'a' },
            { blockedBy: ['a'], nodeId: 'b', priority: 0, status: 'proposed', title: 'b' },
          ],
          chosenNodeId: 'a',
        }),
      ],
      trigger: 'create',
    },
    {
      completedAt: 30,
      durationMs: 10,
      seq: 1,
      startedAt: 20,
      ticks: [
        tick(0, {
          candidates: [{ blockedBy: [], nodeId: 'b', priority: 0, status: 'proposed', title: 'b' }],
          chosenNodeId: 'b',
          graphDelta: { nodesUpserted: [work('a', { status: 'resolved' })] },
        }),
      ],
      trigger: 'settle',
    },
  ],
  goalId: 'goal_1',
  graphBaseline: graphState({
    edges: [{ id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'a' }],
    nodes: [work('a'), work('b')],
  }),
  startedAt: 0,
  title: 'Reproduce nanoGPT',
  totalAdvances: 2,
  totalTicks: 2,
  traceId: 'goal_1',
};

describe('replayGoalAgainstCurrentCoordinator', () => {
  it('reproduces a recorded run against the live coordinator', () => {
    expect(replayGoalAgainstCurrentCoordinator(trajectory)).toMatchObject({
      divergences: [],
      matched: 2,
      ticks: 2,
    });
  });

  it('reports the advance and tick where the coordinator would now choose differently', () => {
    const altered: GoalTrajectory = {
      ...trajectory,
      advances: [
        trajectory.advances[0],
        {
          ...trajectory.advances[1],
          ticks: [{ ...trajectory.advances[1].ticks[0], chosenNodeId: 'a' }],
        },
      ],
    };

    expect(replayGoalAgainstCurrentCoordinator(altered).divergences).toEqual([
      { advanceSeq: 1, field: 'chosenNodeId', recorded: 'a', replayed: 'b', tickIndex: 0 },
    ]);
  });

  it('replays the dependency gate from the state at each tick, not the final one', () => {
    // Without folding the delta, `b` would look blocked at advance 1 and the
    // recorded choice would read as a divergence.
    const result = replayGoalAgainstCurrentCoordinator(trajectory);

    expect(result.matched).toBe(result.ticks);
  });

  it('carries the recorded budget into the decision', () => {
    const exhausted: GoalTrajectory = {
      ...trajectory,
      advances: [
        {
          ...trajectory.advances[0],
          ticks: [
            tick(0, {
              branch: 'budget_exhausted',
              budget: {
                costLimitReached: true,
                maxTotalCost: 1,
                roundLimitReached: false,
                runs: 4,
                totalCost: 2,
              },
              candidates: [
                { blockedBy: [], nodeId: 'a', priority: 0, status: 'proposed', title: 'a' },
                { blockedBy: ['a'], nodeId: 'b', priority: 0, status: 'proposed', title: 'b' },
              ],
              chosenNodeId: 'a',
              frontierTask: { id: 'task_1', status: 'backlog', updatedAt: 0 },
              outcome: 'no_progress',
            }),
          ],
        },
      ],
      graphBaseline: graphState({
        edges: [{ id: 'e1', kind: 'depends_on', sourceNodeId: 'b', targetNodeId: 'a' }],
        nodes: [work('a', { taskId: 'task_1' }), work('b')],
      }),
    };

    expect(replayGoalAgainstCurrentCoordinator(exhausted).divergences).toEqual([]);
  });
});
