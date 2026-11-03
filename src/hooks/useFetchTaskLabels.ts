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
  const useFetch = useTaskStore((s) => s.useFetchTaskLabels);
  const isInit = useTaskStore(taskLabelSelectors.isLabelsInit);
  const { error, isValidating, mutate } = useFetch(isLogin);

  return { error, isLoading: !isInit && isValidating, mutate };
};
