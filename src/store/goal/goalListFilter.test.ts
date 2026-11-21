import { goalStatuses } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { goalArchivedForFilter, goalStatusesForFilter } from './goalListFilter';

describe('goalStatusesForFilter', () => {
  it('asks the server for every status under All', () => {
    expect(goalStatusesForFilter('all')).toEqual([...goalStatuses]);
  });

  it('names exactly the tab state for a narrow tab, so the server decides emptiness', () => {
    expect(goalStatusesForFilter('review')).toEqual(['review']);
    expect(goalStatusesForFilter('running')).toEqual(['running']);
    expect(goalStatusesForFilter('achieved')).toEqual(['achieved']);
  });

  it('returns a fresh array for All, so a caller cannot mutate the shared status list', () => {
    const first = goalStatusesForFilter('all');
    first.push('achieved');

    expect(goalStatusesForFilter('all')).toEqual([...goalStatuses]);
  });
});

describe('goalArchivedForFilter', () => {
  it('lists archived goals, in any status, only under the Archived tab', () => {
    expect(goalArchivedForFilter('archived')).toBe(true);
    expect(goalStatusesForFilter('archived')).toEqual([...goalStatuses]);
  });

  it('leaves archived goals out of every other tab', () => {
    for (const filter of ['all', 'review', 'running', 'achieved'] as const) {
      expect(goalArchivedForFilter(filter)).toBeUndefined();
    }
  });
});
