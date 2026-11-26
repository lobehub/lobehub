import type { FavoriteTarget } from '@/features/Favorites';
import type { ProjectListItem } from '@/store/project';

/** A project's entry in the sidebar Favorites. */
export const projectFavoriteTarget = (
  project: Pick<ProjectListItem, 'avatar' | 'id' | 'name'>,
): FavoriteTarget => ({
  icon: project.avatar ?? null,
  // The slug can be renamed from Project Settings; the id link always resolves.
  path: `/project/${project.id}`,
  targetId: project.id,
  title: project.name,
  type: 'project',
});
