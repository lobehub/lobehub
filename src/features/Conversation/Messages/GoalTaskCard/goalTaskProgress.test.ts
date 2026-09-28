import { describe, expect, it } from 'vitest';

import { buildGoalStepSegments, getGoalStepPointer, getGoalTaskProgress } from './goalTaskProgress';

describe('getGoalTaskProgress', () => {
  it('reports how much of the graph is closed while it runs', () => {
    expect(
      getGoalTaskProgress({ criteriaCount: 4, status: 'running', taskDone: 2, taskTotal: 3 }),
    ).toEqual({ passed: 2, phase: 'running', progress: 67, total: 3 });
  });

  it('falls back to the drafted criteria count before the graph is seeded', () => {
    expect(getGoalTaskProgress({ criteriaCount: 4, status: 'planning' })).toEqual({
      passed: 0,
      phase: 'running',
      progress: 0,
      total: 4,
    });
  });

  it('lets a waiting decision gate outrank the goal status', () => {
    // A goal keeps its `running` row while a gate is open; the card must still
    // read as blocked on the user, not as work in progress.
    expect(
      getGoalTaskProgress({ criteriaCount: 1, pendingDecisions: 1, status: 'running' }).phase,
    ).toBe('waiting');
  });

  it.each([
    ['achieved', 'achieved'],
    ['canceled', 'canceled'],
    ['failed', 'error'],
    ['paused', 'paused'],
    ['review', 'review'],
    ['verifying', 'verifying'],
  ] as const)('maps goal status %s to phase %s', (status, phase) => {
    expect(getGoalTaskProgress({ criteriaCount: 1, status }).phase).toBe(phase);
  });
});

describe('buildGoalStepSegments', () => {
  it('maps one segment per task in plan order', () => {
    expect(
      buildGoalStepSegments(['resolved', 'active', 'proposed', 'waiting', 'rejected']),
    ).toEqual(['done', 'active', 'pending', 'pending', 'done']);
  });

  it('retired tasks count as closed steps', () => {
    expect(buildGoalStepSegments(['retired', 'proposed'])).toEqual(['done', 'pending']);
  });

  it('slices graphs longer than the segment cap, keeping the least advanced state', () => {
    const statuses = Array.from({ length: 25 }, (_, index) =>
      index < 12 ? 'resolved' : 'proposed',
    );

    // ceil(25 / 12) = 3 tasks per segment: indices 0–11 done, 12–24 pending.
    expect(buildGoalStepSegments(statuses)).toEqual([
      ...Array.from({ length: 4 }, () => 'done'),
      ...Array.from({ length: 5 }, () => 'pending'),
    ]);
  });
});

describe('getGoalStepPointer', () => {
  const steps = [
    { status: 'resolved', title: 'Reproduce' },
    { status: 'active', title: 'Fix the parser' },
    { status: 'proposed', title: 'Add regression coverage' },
  ] as const;

  it('points at the first active task while one runs', () => {
    expect(getGoalStepPointer([...steps], 'running')).toEqual({
      kind: 'current',
      title: 'Fix the parser',
    });
  });

  it('falls back to the first open task as up next when nothing is active', () => {
    const paused = steps.map((step) =>
      step.status === 'active' ? { ...step, status: 'waiting' as const } : step,
    );

    expect(getGoalStepPointer(paused, 'paused')).toEqual({
      kind: 'next',
      title: 'Fix the parser',
    });
  });

  it('has no pointer once the goal reached a terminal phase', () => {
    expect(getGoalStepPointer([...steps], 'achieved')).toBeUndefined();
    expect(getGoalStepPointer([...steps], 'error')).toBeUndefined();
    expect(getGoalStepPointer([...steps], 'canceled')).toBeUndefined();
  });
});
