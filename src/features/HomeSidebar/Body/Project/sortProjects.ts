import type { ProjectListSortBy } from '@/store/global/initialState';

type SortableProject = {
  createdAt: Date | string;
  id: string;
  sortOrder?: number | null;
  updatedAt: Date | string;
};

const time = (value: Date | string) => new Date(value).getTime();

/**
 * Order the sidebar project list for the chosen view. `manual` follows the
 * shared `sort_order`, with projects never placed (null) first; the others —
 * and ties — put the newest first.
 */
export const sortProjects = <T extends SortableProject>(
  projects: T[],
  sortBy: ProjectListSortBy,
): T[] => {
  if (sortBy !== 'manual') return projects.toSorted((a, b) => time(b[sortBy]) - time(a[sortBy]));

  const position = (p: T) => p.sortOrder ?? -1;
  return projects.toSorted(
    (a, b) => position(a) - position(b) || time(b.updatedAt) - time(a.updatedAt),
  );
};
