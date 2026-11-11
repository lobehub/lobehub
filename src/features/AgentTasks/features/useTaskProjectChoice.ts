import { useEffect, useState } from 'react';

import { useLoadedProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * The project a task composer will file its task under.
 *
 * `defaultProjectId` is the page's own project, prefilled and kept when nothing
 * is shown to change it. `active: false` is for a composer without a picker (a
 * subtask takes its parent's project on the server).
 */
export const useTaskProjectChoice = (defaultProjectId?: string, active = true) => {
  const enabled = useUserStore(labPreferSelectors.enableProjects) && active;
  const { error, isValidating } = useProjectStore((s) => s.useFetchProjectList)(enabled);
  const projects = useLoadedProjectList();
  const [projectChoice, setProjectChoice] = useState<string | null>(defaultProjectId ?? null);

  // A restored draft can name a project deleted since. Creating with it would
  // fail on the server, and the chip could not name it either, so let it go once
  // a fresh list proves it is gone. The page's own project is the server's call.
  const isStale =
    enabled &&
    !!projectChoice &&
    projectChoice !== defaultProjectId &&
    !!projects &&
    !isValidating &&
    !error &&
    !projects.some((project) => project.id === projectChoice);
  useEffect(() => {
    if (isStale) setProjectChoice(defaultProjectId ?? null);
  }, [defaultProjectId, isStale]);

  return {
    /** What to send on create. With the picker hidden, a draft's choice must not apply unseen. */
    createProjectId: enabled ? (projectChoice ?? undefined) : defaultProjectId,
    projectChoice,
    setProjectChoice,
  };
};
