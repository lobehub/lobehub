import useSWR from 'swr';

import { scmKeys } from '@/libs/swr/keys';
import { scmService } from '@/services/scm';

/**
 * Everything the GitHub integration surfaces need, fetched once and shared
 * by the overview card and the detail page. `enabled` is "at least one live
 * installation", which is what the overview's Enabled section keys on.
 */
export const useGithubIntegration = () => {
  const config = useSWR(scmKeys.config(), () => scmService.getConfig());
  const identity = useSWR(scmKeys.identity('github'), () => scmService.getIdentity('github'));
  const installations = useSWR(scmKeys.installations(null), () => scmService.listInstallations());

  const isInitialLoading =
    config.data === undefined || installations.data === undefined || identity.data === undefined;
  const error = config.error ?? installations.error ?? identity.error;
  const mutate = () => {
    void config.mutate();
    void identity.mutate();
    void installations.mutate();
  };

  return {
    config: config.data?.github,
    enabled: (installations.data?.length ?? 0) > 0,
    error,
    identity: identity.data ?? null,
    installations: installations.data ?? [],
    isInitialLoading,
    mutate,
  };
};
