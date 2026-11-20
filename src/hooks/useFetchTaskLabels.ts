import { useLayoutEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useTaskStore } from '@/store/task';
import { taskLabelSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Sync the task label registry into the task store, read through
 * `taskLabelSelectors`. Mounted by every surface that renders or picks task
 * labels; SWR dedupes concurrent mounts.
 *
 * @returns isLoading - not loaded yet and a fetch is in flight
 * @returns error / mutate - for a failure state with Retry
 */
export const useFetchTaskLabels = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const workspaceId = useActiveWorkspaceId();
  const useFetch = useTaskStore((s) => s.useFetchTaskLabels);
  const resetScope = useTaskStore((s) => s.internal_resetTaskLabelsScope);
  const isInit = useTaskStore(
    (s) => taskLabelSelectors.isLabelsInit(s) && s.taskLabelsScope === workspaceId,
  );

  // Before paint, so a workspace switch never shows the previous registry —
  // including when the new workspace's request fails.
  useLayoutEffect(() => {
    resetScope(workspaceId);
  }, [resetScope, workspaceId]);

  const { error, isValidating, mutate } = useFetch(!!isLogin, workspaceId);

  return { error, isLoading: !isInit && isValidating, mutate };
};
