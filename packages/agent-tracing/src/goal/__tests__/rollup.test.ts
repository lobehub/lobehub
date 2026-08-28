import { describe, expect, it } from 'vitest';

import { buildGoalTraceRollup } from '../rollup';
import type {
  GoalAdvanceSnapshot,
  GoalAdvanceTrigger,
  GoalTickSnapshot,
  GoalTrajectory,
} from '../types';
import { graph, node } from './fixtures';

const tick = (overrides: Partial<GoalTickSnapshot> = {}): GoalTickSnapshot => ({
  at: 0,
  branch: 'dispatch_task',
  budget: { costLimitReached: false, roundLimitReached: false, runs: 0, totalCost: 0 },
  candidates: [],
  graphShape: {
    edgesTotal: 0,
    findings: 0,
    gatesPending: 0,
    nodesTotal: 0,
    workBlocked: 0,
    workOpen: 0,
    workReady: 0,
    workResolved: 0,
  },
  index: 0,
  message: '',
  outcome: 'advanced',
  ...overrides,
});

const advance = (
  seq: number,
  trigger: GoalAdvanceTrigger,
  overrides: Partial<GoalAdvanceSnapshot> = {},
): GoalAdvanceSnapshot => ({
  completedAt: seq * 10 + 5,
  durationMs: 5,
  effects: [],
  seq,
  startedAt: seq * 10,
  ticks: [tick()],
  trigger,
  ...overrides,
});

const trajectory = (advances: GoalAdvanceSnapshot[]): GoalTrajectory => ({
  advances,
  goalId: 'goal_1',
  graphBaseline: graph({ nodes: [node('a')] }),
  startedAt: 0,
  title: 'Reproduce nanoGPT',
  totalAdvances: advances.length,
  totalTicks: advances.reduce((sum, item) => sum + item.ticks.length, 0),
  traceId: 'goal_1',
});

describe('buildGoalTraceRollup', () => {
  it('buckets advances by trigger and by the outcome each stopped on', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'create'),
        advance(1, 'sweep', { ticks: [tick(), tick({ index: 1, outcome: 'no_progress' })] }),
        advance(2, 'sweep', { ticks: [tick({ outcome: 'no_progress' })] }),
      ]),
    );

    expect(rollup.advancesByTrigger).toEqual({ create: 1, sweep: 2 });
    expect(rollup.advancesByOutcome).toEqual({ advanced: 1, no_progress: 2 });
    expect(rollup.ticksTotal).toBe(4);
  });

  it('counts gates and dedupes child operations', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'create', {
          childOperationIds: ['op_1', 'op_2'],
          effects: [{ type: 'opened_decision' }],
        }),
        advance(1, 'decide', {
          childOperationIds: ['op_2'],
          effects: [{ type: 'resolved_decision' }],
        }),
      ]),
    );

    expect(rollup).toMatchObject({ gatesOpened: 1, gatesResolved: 1, workOperations: 2 });
  });

  it('measures the wall time a goal sat parked on a person', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'sweep', { completedAt: 100, effects: [{ type: 'opened_decision' }] }),
        advance(1, 'decide', { startedAt: 400 }),
      ]),
    );

    expect(rollup.humanWaitingMs).toBe(300);
  });

  it('reads the final graph shape through the delta chain', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'create', {
          ticks: [
            tick({ graphDelta: { nodesUpserted: [node('a', { status: 'resolved' })] } }),
            tick({ index: 1, graphDelta: { nodesUpserted: [node('b', { kind: 'finding' })] } }),
          ],
        }),
      ]),
    );

    expect(rollup).toMatchObject({ findingsTotal: 1, nodesTotal: 2, workResolved: 1 });
  });
});
