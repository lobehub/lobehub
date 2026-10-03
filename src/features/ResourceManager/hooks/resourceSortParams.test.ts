import { describe, expect, it } from 'vitest';

import { SortType } from '@/types/files';

import { getResourceSortParams } from './resourceSortParams';

describe('getResourceSortParams', () => {
  it('keeps supported sort settings from a bookmark', () => {
    expect(getResourceSortParams(new URLSearchParams('sorter=name&sortType=asc'))).toEqual({
      sorter: 'name',
      sortType: SortType.Asc,
    });
  });

  it('falls back to the defaults for unsupported URL values', () => {
    expect(getResourceSortParams(new URLSearchParams('sorter=invalid&sortType=invalid'))).toEqual({
      sorter: 'createdAt',
      sortType: SortType.Desc,
    });
  });

  it('ignores backend-only sorting in a resource bookmark', () => {
    expect(getResourceSortParams(new URLSearchParams('sorter=updatedAt'))).toEqual({
      sorter: 'createdAt',
      sortType: SortType.Desc,
    });
  });
});
