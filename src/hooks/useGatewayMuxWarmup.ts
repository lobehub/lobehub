import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';

/**
 * Open the per-user gateway socket on app entry instead of on the first send,
 * so the session's first run never pays the WebSocket handshake on its critical
 * path. Waits for the signed-in user state so the mux can mint its token, and
 * re-runs when the rollout flag arrives with the server config.
 *
 * `warmupGatewayMux` re-checks the deployment capability and the flag itself —
 * this only decides when to ask.
 */
export const useGatewayMuxWarmup = (): void => {
  const isReady = useUserStore((s) => s.isUserStateInit && !!s.isSignedIn);
  const enabled = useServerConfigStore((s) => !!s.featureFlags.enableGatewayMux);
  const warmupGatewayMux = useChatStore((s) => s.warmupGatewayMux);

  useEffect(() => {
    if (isReady && enabled) warmupGatewayMux();
  }, [isReady, enabled, warmupGatewayMux]);
};
