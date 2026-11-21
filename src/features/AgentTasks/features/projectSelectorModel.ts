import type { ProjectListItem } from '@/store/project';

/** Case-insensitive name match; a blank search keeps every project. */
export const filterProjectsByName = <T extends Pick<ProjectListItem, 'name'>>(
  projects: T[],
  search: string,
): T[] => {
  const query = search.trim().toLowerCase();
  if (!query) return projects;
  return projects.filter((project) => project.name.toLowerCase().includes(query));
};

export type TaskProjectDisplay =
  | { kind: 'none' }
  /** The list has not loaded, so nothing can be said about this id yet. */
  | { kind: 'pending' }
  | { kind: 'project'; project: ProjectListItem }
  /** Filed under a project the caller cannot see: deleted, or private to someone else. */
  | { kind: 'unavailable' };

/**
 * What to show for a task's project. A name only ever comes from the row with
 * that exact id, so a project outside the list can never show another's name.
 */
export const resolveTaskProjectDisplay = (
  projectId: string | null | undefined,
  projects: ProjectListItem[] | undefined,
): TaskProjectDisplay => {
  if (!projectId) return { kind: 'none' };
  if (!projects) return { kind: 'pending' };
  const project = projects.find((item) => item.id === projectId);
  return project ? { kind: 'project', project } : { kind: 'unavailable' };
};
