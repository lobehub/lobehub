import { integrationActions, integrationSelectors, useIntegrationStore } from '@/store/integration';

/**
 * Everything the GitHub integration surfaces need, read once and shared by the
 * overview card and the detail page. A reload paints the last local copy and
 * revalidates in the background. `enabled` is "at least one live
 * installation", which is what the overview's Enabled section keys on.
 */
export const useGithubIntegration = () => {
  const { error } = integrationActions.useFetchGithub();
  const config = useIntegrationStore(integrationSelectors.scmConfig);
  const identity = useIntegrationStore(integrationSelectors.scmIdentity);
  const installations = useIntegrationStore(integrationSelectors.scmInstallations);
  const isSettled = useIntegrationStore(integrationSelectors.isGithubSettled);

  return {
    config: config?.github,
    enabled: (installations?.length ?? 0) > 0,
    error,
    identity: identity?.identity ?? null,
    installations: installations ?? [],
    isInitialLoading: !isSettled,
    mutate: () => {
      void integrationActions.refreshGithub();
    },
  };
};
