import type { ProjectListItem } from '@/store/project';

export type ProjectListState = 'empty' | 'error' | 'loading' | 'ready';

interface ResolveProjectListStateParams {
  error: unknown;
  isHydrated: boolean;
  isValidating: boolean;
  projects: ProjectListItem[] | undefined;
}

export const resolveProjectListState = ({
  error,
  isHydrated,
  isValidating,
  projects,
}: ResolveProjectListStateParams): ProjectListState => {
  if (projects && projects.length > 0) return 'ready';
  if (error) return 'error';
  if (projects === undefined && (!isHydrated || isValidating)) return 'loading';
  return 'empty';
};
