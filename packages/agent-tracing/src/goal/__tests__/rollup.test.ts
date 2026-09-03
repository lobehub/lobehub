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

  it('dedupes child operations across advances', () => {
    // The same operation can be reported by the advance that started it and by
    // the one that consumed its result.
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'create', { childOperationIds: ['op_1', 'op_2'] }),
        advance(1, 'settle', { childOperationIds: ['op_2'] }),
      ]),
    );

    expect(rollup.operationsTotal).toBe(2);
  });

  it('counts a gate that a person answered between two advances', () => {
    // The resolving half is never an effect: `goal.decide` runs outside any
    // advance, so no tick is executing to report it. Both transitions are only
    // visible in the recorded graph.
    const gate = (status: string) => ({
      decisionsUpserted: [{ id: 'd1', nodeId: 'n1', question: 'Retry or retire?', status }],
    });

    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'settle', {
          ticks: [tick({ at: 1000, graphDelta: gate('pending'), outcome: 'waiting_human' })],
        }),
        advance(1, 'decide', {
          ticks: [tick({ at: 4000, graphDelta: gate('resolved') })],
        }),
      ]),
    );

    expect(rollup).toMatchObject({ gatesOpened: 1, gatesResolved: 1, humanWaitingMs: 3000 });
  });

  it('leaves a still-open gate counted as opened and unresolved', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'settle', {
          ticks: [
            tick({
              at: 1000,
              graphDelta: {
                decisionsUpserted: [
                  { id: 'd1', nodeId: 'n1', question: 'Retry?', status: 'pending' },
                ],
              },
              outcome: 'waiting_human',
            }),
          ],
        }),
      ]),
    );

    expect(rollup).toMatchObject({ gatesOpened: 1, gatesResolved: 0, humanWaitingMs: 0 });
  });

  it('does not count a gate from effects alone, which only cover half its life', () => {
    const rollup = buildGoalTraceRollup(
      trajectory([
        advance(0, 'sweep', { ticks: [tick({ effects: [{ type: 'opened_decision' }] })] }),
      ]),
    );

    expect(rollup).toMatchObject({ gatesOpened: 0, gatesResolved: 0 });
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

    expect(rollup).toMatchObject({ findingsTotal: 1, nodesTotal: 2, tasksCompleted: 1 });
  });
});
