/** Which rows a workspace resource list shows: everything, only the caller's private rows, or only the shared ones. */
export type VisibilityFilterValue = 'all' | 'private' | 'workspace';

export const VISIBILITY_FILTER_VALUES: VisibilityFilterValue[] = ['all', 'private', 'workspace'];

export const matchesVisibilityFilter = (isPrivate: boolean, filter: VisibilityFilterValue) =>
  filter === 'all' || (filter === 'private') === isPrivate;
