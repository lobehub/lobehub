import useSWR from 'swr';

import { environmentService } from '@/services/environment';

/** Keeps request failure distinct from a successful empty repository listing. */
export const useGithubRepositories = () => {
  const swr = useSWR('sandbox-github-repositories', () =>
    environmentService.listGithubRepositories(),
  );
  const state = swr.error
    ? 'error'
    : !swr.data
      ? 'loading'
      : !swr.data.connected
        ? 'disconnected'
        : swr.data.repositories.length === 0
          ? 'empty'
          : 'ready';

  return {
    ...swr,
    state,
    retry: () =>
      swr.mutate(undefined, { revalidate: true, populateCache: false, throwOnError: false }),
  };
};
