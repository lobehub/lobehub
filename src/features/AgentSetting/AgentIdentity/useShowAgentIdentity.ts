import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * Whether the identity tab has anything to offer: the user opted into the Labs
 * experiment, and this deployment has at least one identity provider to open
 * an address with. Without a provider the tab would only show offers that fail.
 */
export const useShowAgentIdentity = (): boolean => {
  const enabled = useUserStore(labPreferSelectors.enableAgentIdentity);
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);

  return enabled && providers.length > 0;
};
