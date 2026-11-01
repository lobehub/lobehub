import { describe, expect, it } from 'vitest';

import type { GoalTickSnapshot, GoalTrajectory } from '../types';
import { renderGoalAdvanceDetail, renderGoalTrajectory } from '../viewer';
import { graph, node } from './fixtures';

const tick = (overrides: Partial<GoalTickSnapshot> = {}): GoalTickSnapshot => ({
  at: 0,
  branch: 'dispatch_task',
  candidates: [
    { blockedBy: [], nodeId: 'aaaaaaaa-1111', priority: 1, status: 'proposed', title: 'Clone' },
    {
      blockedBy: ['aaaaaaaa-1111'],
      nodeId: 'bbbbbbbb-2222',
      priority: 0,
      status: 'proposed',
      title: 'Train',
    },
  ],
  chosenNodeId: 'aaaaaaaa-1111',
  effects: [],
  graphShape: {
    edgesTotal: 1,
    findings: 0,
    gatesPending: 0,
    nodesTotal: 2,
    tasksBlocked: 1,
    tasksOpen: 2,
    tasksReady: 1,
    tasksCompleted: 0,
  },
  index: 0,
  message: 'Task T-31 is ready to run',
  outcome: 'waiting_external',
  ...overrides,
});

const trajectory: GoalTrajectory = {
  advances: [
    {
      childOperationIds: ['op_1'],
      completedAt: 2000,
      durationMs: 2000,
      seq: 0,
      startedAt: 0,
      ticks: [
        tick({
          budget: {
            costLimitReached: false,
            maxRounds: null,
            maxTotalCost: 5,
            roundLimitReached: false,
            runs: 0,
            totalCost: 0,
          },
          effects: [{ operationId: 'op_1', targetId: 'task_A', type: 'started_run' }],
          candidateTasks: [
            {
              error: null,
              id: 'task_A',
              identifier: 'T-31',
              nodeId: 'aaaaaaaa-1111',
              status: 'backlog',
              updatedAt: 0,
            },
          ],
          concurrency: 3,
        }),
      ],
      trigger: 'create',
    },
  ],
  completedAt: 5000,
  completionReason: 'achieved',
  goalId: 'goal_1',
  graphBaseline: graph({ nodes: [node('aaaaaaaa-1111'), node('bbbbbbbb-2222')] }),
  startedAt: 0,
  title: 'Reproduce nanoGPT',
  totalAdvances: 1,
  totalTicks: 1,
  traceId: 'goal_1',
};

describe('renderGoalTrajectory', () => {
  it('leads with how the run ended and what drove it', () => {
    const output = renderGoalTrajectory(trajectory);

    expect(output).toContain('goal_1  Reproduce nanoGPT');
    expect(output).toContain('achieved');
    expect(output).toContain('by trigger: create=1');
    expect(output).toContain('1 operation(s)');
  });

  it('shows each advance with its ticks nested under it', () => {
    const output = renderGoalTrajectory(trajectory);

    expect(output).toContain('#0');
    expect(output).toContain('dispatch_task');
    expect(output).toContain('(+1 eligible)');
  });
});

describe('renderGoalAdvanceDetail', () => {
  it('shows the candidates that lost, not only the one that won', () => {
    const output = renderGoalAdvanceDetail(trajectory, 0);

    expect(output).toContain('▸ aaaaaaaa p1 proposed Clone');
    expect(output).toContain('bbbbbbbb p0 proposed Train blocked by aaaaaaaa');
  });

  it('shows the budget and task the decision was made against', () => {
    const output = renderGoalAdvanceDetail(trajectory, 0);

    expect(output).toContain('budget: rounds ∞  cost $0.0000/$5');
    expect(output).toContain('▸ task: T-31 backlog');
    expect(output).toContain('concurrency: 3');
    expect(output).toContain('effect: started_run task_A op=op_1');
  });

  it('shows the legacy frontier task when candidate tasks were not recorded yet', () => {
    const legacyTrajectory: GoalTrajectory = {
      ...trajectory,
      advances: [
        {
          ...trajectory.advances[0],
          ticks: [
            tick({
              candidateTasks: undefined,
              frontierTask: {
                error: 'Device offline',
                id: 'task_legacy',
                identifier: 'T-legacy',
                status: 'failed',
                updatedAt: 0,
              },
            }),
          ],
        },
      ],
    };

    const output = renderGoalAdvanceDetail(legacyTrajectory, 0);

    expect(output).toContain('task: T-legacy failed — Device offline');
  });

  it('says so rather than rendering an empty frame for an advance that is not there', () => {
    expect(renderGoalAdvanceDetail(trajectory, 9)).toBe('No advance #9 in goal_1');
  });
});
