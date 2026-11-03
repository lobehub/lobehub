import { goalStatuses } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { goalStatusesForFilter } from './goalListFilter';

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
