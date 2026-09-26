import { SortType } from '@/types/files';

import type { State } from '../store/initialState';

/** Only restore sorters the resource explorer can display and change. */
export const getResourceSortParams = (
  params: URLSearchParams,
): Pick<State, 'sorter' | 'sortType'> => {
  const sorter = params.get('sorter');
  const sortType = params.get('sortType');

  return {
    sorter: sorter === 'name' || sorter === 'size' ? sorter : 'createdAt',
    sortType: sortType === SortType.Asc ? SortType.Asc : SortType.Desc,
  };
};
