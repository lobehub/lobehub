import type { IntegrationState } from './initialState';
import { INTEGRATION_KEY } from './projection';

const scmConfig = (s: IntegrationState) => s.scmConfigMap[INTEGRATION_KEY];
const scmIdentity = (s: IntegrationState) => s.scmIdentityMap[INTEGRATION_KEY];
const scmInstallations = (s: IntegrationState) => s.scmInstallationsMap[INTEGRATION_KEY];

/**
 * The GitHub surfaces can render. A restored copy without installations may
 * predate a new connection, so it waits for the server before the page reads
 * as "not connected" (and the overview drops GitHub from its Enabled strip).
 */
const isGithubSettled = (s: IntegrationState) => {
  const installations = scmInstallations(s);
  if (!scmConfig(s) || !scmIdentity(s) || !installations) return false;
  return (
    installations.length > 0 ||
    s.scmInstallationsReplica.entries[INTEGRATION_KEY]?.source === 'server'
  );
};

export const integrationSelectors = {
  isGithubSettled,
  scmConfig,
  scmIdentity,
  scmInstallations,
};
