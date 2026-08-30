import { beforeEach, describe, expect, it } from 'vitest';

import { appendAdvanceToPartial, finalizeGoalTrace, type RecordTickInput } from '../recorder';
import type { IGoalTraceStore } from '../store/types';
import type { GoalGraphState, GoalTraceSummary, GoalTrajectory } from '../types';
import { graph, node } from './fixtures';

class MemoryStore implements IGoalTraceStore {
  partials = new Map<string, Partial<GoalTrajectory>>();
  saved = new Map<string, GoalTrajectory>();

  async get(goalId: string) {
    return this.saved.get(goalId) ?? null;
  }
  async list(): Promise<GoalTraceSummary[]> {
    return [];
  }
  async listPartials() {
    return [...this.partials.keys()];
  }
  async loadPartial(goalId: string) {
    return this.partials.get(goalId) ?? null;
  }
  async removePartial(goalId: string) {
    this.partials.delete(goalId);
  }
  async save(trajectory: GoalTrajectory) {
    this.saved.set(trajectory.goalId, trajectory);
  }
  async savePartial(goalId: string, partial: Partial<GoalTrajectory>) {
    this.partials.set(goalId, partial);
  }
}

const tick = (graphState: GoalGraphState, at = 0): RecordTickInput => ({
  at,
  branch: 'dispatch_task',
  budget: { costLimitReached: false, roundLimitReached: false, runs: 0, totalCost: 0 },
  candidates: [],
  effects: [],
  graphState,
  message: 'ok',
  outcome: 'advanced',
});

describe('appendAdvanceToPartial', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('seeds the baseline from the first tick and leaves its delta empty', async () => {
    const state = graph({ nodes: [node('a')] });

    const trajectory = await appendAdvanceToPartial(store, 'goal_1', {
      startedAt: 0,
      ticks: [tick(state)],
      trigger: 'create',
    });
    const advance = trajectory?.advances.at(-1);

    expect(advance?.seq).toBe(0);
    expect(advance?.ticks[0].graphDelta).toBeUndefined();
    expect(store.partials.get('goal_1')?.graphBaseline).toEqual(state);
  });

  it('diffs each tick against the previous recorded state, across advances', async () => {
    const first = graph({ nodes: [node('a')] });
    const second = graph({ nodes: [node('a', { status: 'active' })] });
    const third = graph({ nodes: [node('a', { status: 'resolved' })] });

    await appendAdvanceToPartial(store, 'goal_1', {
      startedAt: 0,
      ticks: [tick(first), tick(second)],
      trigger: 'create',
    });
    const next = (
      await appendAdvanceToPartial(store, 'goal_1', {
        startedAt: 5,
        ticks: [tick(third)],
        trigger: 'settle',
      })
    )?.advances.at(-1);

    expect(next?.seq).toBe(1);
    expect(next?.ticks[0].graphDelta).toEqual({
      nodesUpserted: [node('a', { status: 'resolved' })],
    });
  });

  it('captures a graph edit made between two advances', async () => {
    await appendAdvanceToPartial(store, 'goal_1', {
      startedAt: 0,
      ticks: [tick(graph({ nodes: [node('a')] }))],
      trigger: 'create',
    });

    // A work node added from the UI, with no advance in between.
    const withExtra = graph({ nodes: [node('a'), node('b')] });
    const next = (
      await appendAdvanceToPartial(store, 'goal_1', {
        startedAt: 5,
        ticks: [tick(withExtra)],
        trigger: 'manual',
      })
    )?.advances.at(-1);

    expect(next?.ticks[0].graphDelta).toEqual({ nodesUpserted: [node('b')] });
  });

  it('records nothing for an advance that ran no ticks', async () => {
    expect(
      await appendAdvanceToPartial(store, 'goal_1', {
        startedAt: 0,
        ticks: [],
        trigger: 'sweep',
      }),
    ).toBeNull();
    expect(store.partials.size).toBe(0);
  });

  it('computes shape per tick', async () => {
    const advance = (
      await appendAdvanceToPartial(store, 'goal_1', {
        startedAt: 0,
        ticks: [tick(graph({ nodes: [node('a'), node('b', { kind: 'finding' })] }))],
        trigger: 'create',
      })
    )?.advances.at(-1);

    expect(advance?.ticks[0].graphShape).toMatchObject({
      findings: 1,
      nodesTotal: 2,
      tasksOpen: 1,
    });
  });
});

describe('finalizeGoalTrace', () => {
  it('moves the partial into a finalized trajectory', async () => {
    const store = new MemoryStore();
    await appendAdvanceToPartial(store, 'goal_1', {
      startedAt: 0,
      ticks: [tick(graph({ nodes: [node('a')] }))],
      trigger: 'create',
    });

    const trajectory = await finalizeGoalTrace(store, 'goal_1', {
      completedAt: 99,
      completionReason: 'achieved',
    });

    expect(trajectory).toMatchObject({
      completedAt: 99,
      completionReason: 'achieved',
      goalId: 'goal_1',
      totalAdvances: 1,
      totalTicks: 1,
    });
    expect(store.partials.size).toBe(0);
    expect(await store.get('goal_1')).not.toBeNull();
  });

  it('is a no-op when the goal never recorded anything', async () => {
    expect(
      await finalizeGoalTrace(new MemoryStore(), 'goal_x', { completionReason: 'failed' }),
    ).toBeNull();
  });
});
