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

/**
 * One gateway event reaches every mounted subscriber (sidebar, main conversation, thread
 * panel) in the same tick, and each used to refresh the list on its own: one notify cost three
 * list reads plus the details. Requests made in the same tick are merged into one refresh per
 * view; a reconnect refreshes the same way.
 */
let queuedList = false;
const queuedDetails = new Map<string, ChannelViewParams>();
export const queueChannelRefresh = (detail?: ChannelViewParams) => {
  if (detail) {
    const { before, channelId, threadId } = detail;
    queuedDetails.set(JSON.stringify([channelId, threadId ?? null, before ?? null]), detail);
  }
  if (queuedList) return;
  queuedList = true;
  queueMicrotask(() => {
    const details = [...queuedDetails.values()];
    queuedList = false;
    queuedDetails.clear();
    void Promise.allSettled([
      channelActions.refreshList(),
      ...details.map((params) => channelActions.refreshDetail(params)),
    ]);
  });
};

/** Public invalidations share the authenticated user socket, never an Agent's private stream. */
export const useChannelEvents = (params?: ChannelViewParams) => {
  const gatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);
  const enabled = useServerConfigStore((s) => s.serverConfig.agentGatewayProtocol === 2);
  const channelId = params?.channelId;
  const threadId = params?.threadId;
  const before = params?.before;
  useEffect(() => {
    if (!gatewayUrl || !enabled || !canUseGatewayProtocolV2()) return;
    const identity = { gatewayUrl };
    if (isGatewayMuxUnavailable(identity)) return;
    const mux = getGatewayMux(identity);
    const refresh = () =>
      queueChannelRefresh(channelId ? { before, channelId, threadId } : undefined);
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
