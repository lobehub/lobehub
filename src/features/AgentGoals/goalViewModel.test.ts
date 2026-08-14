import type { TaskDetailActivity } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  formatGoalCost,
  formatGoalDuration,
  getGoalDescription,
  getGoalRunMetrics,
  getGoalRuns,
  getRecentGoalRuns,
  goalStatusToTaskStatus,
  shouldShowGoal,
} from './goalViewModel';

describe('goalViewModel', () => {
  it('formats compact run duration and cost metrics', () => {
    expect(formatGoalDuration(7500)).toBe('1m');
    expect(formatGoalDuration(3_900_000)).toBe('1h 5m');
    expect(formatGoalCost(0.0042)).toBe('$0.0042');
    expect(formatGoalCost(0)).toBe('—');
  });
  it('uses the persisted goal description before the execution instruction', () => {
    expect(
      getGoalDescription({
        description: 'Increase successful releases',
        instruction: 'Run the release checklist',
      }),
    ).toBe('Increase successful releases');
  });

  it('falls back to the instruction when no description exists', () => {
    expect(
      getGoalDescription({ description: null, instruction: 'Run the release checklist' }),
    ).toBe('Run the release checklist');
  });

  it('returns only Agent runs with the newest run first', () => {
    const activities = [
      { id: 'created', type: 'created' },
      { id: 'run-1', type: 'topic' },
      { id: 'comment', type: 'comment' },
      { id: 'run-2', type: 'topic' },
    ] as TaskDetailActivity[];

    expect(getGoalRuns(activities).map((activity) => activity.id)).toEqual(['run-2', 'run-1']);
  });

  it('limits the recent execution list to the latest 10 runs', () => {
    const activities = Array.from({ length: 12 }, (_, index) => ({
      id: `run-${index + 1}`,
      type: 'topic',
    })) as TaskDetailActivity[];

    expect(getRecentGoalRuns(activities).map((activity) => activity.id)).toEqual([
      'run-12',
      'run-11',
      'run-10',
      'run-9',
      'run-8',
      'run-7',
      'run-6',
      'run-5',
      'run-4',
      'run-3',
    ]);
  });

  it('hides achieved goals from the default active filter without hiding pending acceptance', () => {
    expect(shouldShowGoal('goalList.status.achieved', 'active')).toBe(false);
    expect(shouldShowGoal('goalList.status.review', 'active')).toBe(true);
    expect(shouldShowGoal('goalList.status.achieved', 'all')).toBe(true);
  });

  it('uses the Goal acceptance state for its status icon', () => {
    expect(goalStatusToTaskStatus('goalList.status.review')).toBe('paused');
    expect(goalStatusToTaskStatus('goalList.status.achieved')).toBe('completed');
    expect(goalStatusToTaskStatus('goalList.status.verifying')).toBe('running');
  });

  it('aggregates duration and cost from every topic run', () => {
    expect(
      getGoalRunMetrics([
        {
          completedAt: '2026-08-06T00:00:03.000Z',
          cost: 0.012,
          time: '2026-08-06T00:00:01.000Z',
          type: 'topic',
        },
        { content: 'comment', type: 'comment' },
        {
          completedAt: '2026-08-06T00:00:08.500Z',
          cost: 0.008,
          time: '2026-08-06T00:00:03.000Z',
          type: 'topic',
        },
      ]),
    ).toEqual({ cost: 0.02, duration: 7500 });
  });
});
