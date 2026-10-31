import { useEffect } from 'react';

import { canUseGatewayProtocolV2 } from '@/helpers/gatewayProtocol';
import type { ChannelViewParams } from '@/services/channel';
import { channelActions } from '@/store/channel';
import {
  getGatewayMux,
  isGatewayMuxUnavailable,
  markGatewayMuxUnavailable,
} from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';
import { useServerConfigStore } from '@/store/serverConfig';

/** Public invalidations share the authenticated user socket, never an Agent's private stream. */
export const useChannelEvents = (params?: ChannelViewParams) => {
  const gatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);
  const enabled = useServerConfigStore((s) => s.featureFlags.enableGatewayMux);
  const channelId = params?.channelId;
  const threadId = params?.threadId;
  const before = params?.before;
  useEffect(() => {
    if (!gatewayUrl || !enabled || !canUseGatewayProtocolV2()) return;
    const identity = { gatewayUrl };
    if (isGatewayMuxUnavailable(identity)) return;
    const mux = getGatewayMux(identity);
    const refresh = () => {
      void Promise.allSettled([
        channelActions.refreshList(),
        ...(channelId ? [channelActions.refreshDetail({ channelId, threadId, before })] : []),
      ]);
    };
    const remove = [
      mux.on('channel_changed', (event) => {
        if (!channelId || event.channelId === channelId) refresh();
      }),
      // Notifications are ephemeral: every reconnect reloads the durable view.
      mux.on('connected', refresh),
      mux.on('unavailable', () => markGatewayMuxUnavailable(identity)),
    ];
    mux.connect();
    return () => remove.forEach((unsubscribe) => unsubscribe());
  }, [gatewayUrl, enabled, channelId, threadId, before]);
};
