import { MARKETPLACE_INSTALLED_CONNECTORS_PATH } from '@/features/Marketplace/paths';
import {
  encodeMobileSelection,
  MOBILE_SELECTION_PARAM,
} from '@/features/Settings/skill/mobileSelection';

const GITHUB_CONNECTOR_ID = 'github';

/** What the GitHub App install callback reports back in the query. */
export const GITHUB_INSTALL_RESULT_PARAMS = ['installed', 'error', 'account', 'pending'] as const;

export const isGithubConnector = (identifier: string) => identifier === GITHUB_CONNECTOR_ID;

/**
 * GitHub's page in the Marketplace. The install callback still returns to
 * `/settings/integrations/github`, so its result is carried over from `search`
 * for the page to report; nothing else from the old URL follows.
 */
export const buildGithubConnectorPath = (search = ''): string => {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams({
    [MOBILE_SELECTION_PARAM]: encodeMobileSelection({
      identifier: GITHUB_CONNECTOR_ID,
      type: 'lobehub-connector',
    }),
  });
  for (const key of GITHUB_INSTALL_RESULT_PARAMS) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  return `${MARKETPLACE_INSTALLED_CONNECTORS_PATH}?${params}`;
};
