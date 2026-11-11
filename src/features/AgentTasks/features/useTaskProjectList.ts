import { useLoadedProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * The project list a task surface maps ids through. Callers share one cached
 * request; `projects` stays `undefined` until it first loads.
 */
export const useTaskProjectList = () => {
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const { error, revalidate } = useProjectStore((s) => s.useFetchProjectList)(enabled);
  const projects = useLoadedProjectList();

  return { enabled, error, projects, retry: revalidate };
};
