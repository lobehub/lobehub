import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * Open the per-user gateway socket on app entry (lab `enableGatewayMux`),
 * instead of on the first send. Waits for the signed-in user state so the
 * mux can mint its token; re-runs when the lab toggle flips on.
 */
export const useGatewayMuxWarmup = (): void => {
  const isReady = useUserStore((s) => s.isUserStateInit && !!s.isSignedIn);
  const enabled = useUserStore(labPreferSelectors.enableGatewayMux);
  const warmupGatewayMux = useChatStore((s) => s.warmupGatewayMux);

  useEffect(() => {
    if (isReady && enabled) warmupGatewayMux();
  }, [isReady, enabled, warmupGatewayMux]);
};
