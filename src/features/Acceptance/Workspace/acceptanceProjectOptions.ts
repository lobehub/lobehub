import type { ProjectListItem } from '@/store/project';

export interface AcceptanceProjectOption {
  id: string;
  name: string;
  /** The project the acceptance is currently filed under. */
  selected: boolean;
}

/**
 * What the "file under a project" submenu shows for the state its project
 * fetch is in. Kept as data (not JSX) so the branch order — error before
 * loading, loading before empty — is testable without rendering a menu.
 *
 * Every state still offers "create a project", so the empty one is a starting
 * point rather than a dead end.
 */
export type AcceptanceProjectMenuState =
  | { type: 'error' }
  | { type: 'loading' }
  | { type: 'empty' }
  | { options: AcceptanceProjectOption[]; type: 'options' };

export const buildAcceptanceProjectMenuState = ({
  currentProjectId,
  error,
  projects,
}: {
  currentProjectId?: string | null;
  error?: unknown;
  projects?: Pick<ProjectListItem, 'id' | 'name'>[];
}): AcceptanceProjectMenuState => {
  // A failed fetch must never read as "you have no projects" — that would
  // invite the user to create a duplicate of one they already own.
  if (error) return { type: 'error' };
  if (!projects) return { type: 'loading' };
  if (projects.length === 0) return { type: 'empty' };

  return {
    options: projects.map(({ id, name }) => ({
      id,
      name,
      selected: id === currentProjectId,
    })),
    type: 'options',
  };
};
