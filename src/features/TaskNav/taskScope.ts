/** Query param the Tasks tab uses to scope `/tasks` to one project. */
export const TASK_PROJECT_PARAM = 'project';

export type TaskScope =
  { type: 'all' } | { type: 'goals' } | { projectId: string; type: 'project' };

/**
 * Which Tasks-tab list entry a location belongs to: a project scope
 * (`/tasks?project=<id>`), the goals pages, or every other task route.
 */
export const resolveTaskScope = (
  pathname: string,
  search: string,
  activeWorkspaceSlug: string | null,
): TaskScope => {
  const segments = pathname.split('/').filter(Boolean);
  const [root] =
    activeWorkspaceSlug && segments[0] === activeWorkspaceSlug ? segments.slice(1) : segments;

  if (root === 'goals' || root === 'goal') return { type: 'goals' };

  const projectId = new URLSearchParams(search).get(TASK_PROJECT_PARAM);
  if (root === 'tasks' && projectId) return { projectId, type: 'project' };

  return { type: 'all' };
};

export const taskScopeUrl = (projectId?: string) =>
  projectId ? `/tasks?${TASK_PROJECT_PARAM}=${encodeURIComponent(projectId)}` : '/tasks';
