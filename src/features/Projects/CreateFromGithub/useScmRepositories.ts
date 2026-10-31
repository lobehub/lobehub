import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { scmKeys } from '@/libs/swr/keys';
import { scmService } from '@/services/scm';

export type ScmRepositoriesState =
  'disconnected' | 'empty' | 'error' | 'loading' | 'ready' | 'unconfigured';

/**
 * Repositories the connected GitHub App installations can read. The state
 * keeps "nothing connected" apart from "connected, nothing granted": the first
 * is fixed by connecting, the second by changing access on GitHub. A failed
 * refresh keeps the list already loaded rather than replacing it with an error.
 */
export const useScmRepositories = () => {
  const workspaceId = useActiveWorkspaceId();
  const swr = useSWR(scmKeys.repositories(workspaceId), () => scmService.listRepositories(), {
    revalidateOnFocus: false,
  });

  const state: ScmRepositoriesState = !swr.data
    ? swr.error
      ? 'error'
      : 'loading'
    : !swr.data.configured
      ? 'unconfigured'
      : swr.data.installations === 0
        ? 'disconnected'
        : swr.data.repositories.length === 0
          ? 'empty'
          : 'ready';

  return {
    error: swr.error,
    isValidating: swr.isValidating,
    repositories: swr.data?.repositories,
    retry: () => swr.mutate(),
    state,
    truncated: swr.data?.truncated ?? false,
  };
};
