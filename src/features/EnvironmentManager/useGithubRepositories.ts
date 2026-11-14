import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { environmentService } from '@/services/environment';

/**
 * Keeps request failure distinct from a successful empty repository listing.
 * Keyed by workspace: the list comes from that workspace's GitHub App
 * installations, so another workspace's cached list would offer repositories
 * its builds cannot clone.
 */
export const useGithubRepositories = () => {
  const workspaceId = useActiveWorkspaceId();
  const swr = useSWR(['sandbox-github-repositories', workspaceId], () =>
    environmentService.listGithubRepositories(),
  );
  const state = swr.error
    ? 'error'
    : !swr.data
      ? 'loading'
      : swr.data.configured === false
        ? 'unconfigured'
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
