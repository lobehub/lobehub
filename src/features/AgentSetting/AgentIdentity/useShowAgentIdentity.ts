import { useAgentStore } from '@/store/agent';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { useAgentAccounts } from './useAgentIdentity';

/**
 * Whether the identity tab has anything to offer: the user opted into the Labs
 * experiment, and either this deployment can open an address (a provider is
 * configured) or the agent already owns one.
 *
 * Provider availability only decides whether new addresses can be opened. An
 * address that already exists must stay reachable after its provider's
 * credentials are removed, so it can still be read, copied and released.
 */
export const useShowAgentIdentity = (): boolean => {
  const enabled = useUserStore(labPreferSelectors.enableAgentIdentity);
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);
  const agentId = useAgentStore((s) => s.activeAgentId);

  // Only ask for the agent's accounts when they are what decides it.
  const needsAccounts = enabled && providers.length === 0 && !!agentId;
  const { data: accounts } = useAgentAccounts(needsAccounts ? agentId! : '');

  if (!enabled) return false;
  if (providers.length > 0) return true;

  return (accounts ?? []).some((account) => account.status !== 'revoked');
};
