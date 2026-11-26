export type TaskCollection = 'mine' | 'scheduled' | 'tasks';
/** "My tasks" sub-view: assigned to me as a member, or created by me. */
export type MyTaskScope = 'assigned' | 'created';

/**
 * Where "My tasks" is offered it is the landing tab, so the bare URL opens it and
 * the ordinary list is addressed as `collection=all` (`collection=tasks` keeps
 * resolving for older links). Scopes without the tab keep the ordinary list as
 * their bare URL.
 */
export const resolveTaskCollection = (
  searchParams: URLSearchParams,
  options: { allowMine?: boolean } = {},
): TaskCollection => {
  const value = searchParams.get('collection');
  if (value === 'scheduled') return 'scheduled';
  if (value === 'all' || value === 'tasks') return 'tasks';
  // The "My tasks" tab is only offered where member assignment exists; a deep
  // link into it from a scope without the tab falls back to ordinary tasks.
  if (!options.allowMine) return 'tasks';
  return value === 'mine' || !value ? 'mine' : 'tasks';
};

/** The `collection` search param that addresses a tab; `undefined` is the bare URL. */
export const taskCollectionParam = (
  collection: TaskCollection,
  options: { allowMine?: boolean } = {},
): string | undefined => {
  if (collection === 'scheduled') return 'scheduled';
  if (!options.allowMine) return undefined;
  return collection === 'mine' ? undefined : 'all';
};

export const resolveMyTaskScope = (searchParams: URLSearchParams): MyTaskScope =>
  searchParams.get('scope') === 'created' ? 'created' : 'assigned';
