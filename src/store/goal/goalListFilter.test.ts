import { goalStatuses } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { filterGoalsByStatus, goalStatusesForFilter } from './goalListFilter';

describe('goalStatusesForFilter', () => {
  it('asks the server for every status under All', () => {
    expect(goalStatusesForFilter('all')).toEqual([...goalStatuses]);
  });

  it('names exactly the tab state for a narrow tab, so the server decides emptiness', () => {
    expect(goalStatusesForFilter('review')).toEqual(['review']);
    expect(goalStatusesForFilter('running')).toEqual(['running']);
  });

  it('never widens a narrow tab into the terminal states it must not show', () => {
    for (const filter of ['review', 'running'] as const) {
      expect(goalStatusesForFilter(filter)).not.toContain('achieved');
      expect(goalStatusesForFilter(filter)).not.toContain('canceled');
    }
  });

  it('returns a fresh array for All, so a caller cannot mutate the shared status list', () => {
    const first = goalStatusesForFilter('all');
    first.push('achieved');

    expect(goalStatusesForFilter('all')).toEqual([...goalStatuses]);
  });
});

describe('filterGoalsByStatus', () => {
  const goals = [
    { goal: { id: 'planning', status: 'planning' } },
    { goal: { id: 'running', status: 'running' } },
    { goal: { id: 'review', status: 'review' } },
    { goal: { id: 'achieved', status: 'achieved' } },
  ] as const;
  const ids = (filter: 'all' | 'review' | 'running') =>
    filterGoalsByStatus([...goals], filter).map(({ goal }) => goal.id);

  it('keeps every goal under All, which is the default tab', () => {
    expect(ids('all')).toEqual(['planning', 'running', 'review', 'achieved']);
  });

  it('keeps only the goals sitting at the human acceptance gate under Needs review', () => {
    expect(ids('review')).toEqual(['review']);
  });

  it('keeps only the executing goal under In progress', () => {
    expect(ids('running')).toEqual(['running']);
  });

  it('leaves terminal goals to All — they are in neither of the two narrow tabs', () => {
    expect(ids('review')).not.toContain('achieved');
    expect(ids('running')).not.toContain('achieved');
  });

  it('keeps the instant client-side paint in step with what the server returns', () => {
    for (const filter of ['all', 'review', 'running'] as const) {
      const keptStatuses = goalStatusesForFilter(filter);

      expect(filterGoalsByStatus([...goals], filter)).toEqual(
        goals.filter(({ goal }) => keptStatuses.includes(goal.status)),
      );
    }
  });
});
