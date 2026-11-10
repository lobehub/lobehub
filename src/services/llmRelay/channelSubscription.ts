import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { AgentStreamClient } from '@lobechat/agent-gateway-client';

import { canUseGatewayProtocolV2 } from '@/helpers/gatewayProtocol';
import { aiAgentService } from '@/services/aiAgent';
import {
  getGatewayMux,
  isGatewayMuxUnavailable,
  markGatewayMuxUnavailable,
} from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';

import { getLlmRelayClientId } from './clientId';
import type { OneShotChannelSubscription } from './oneShot';

/**
 * Muxes this module watches for `unavailable`. A tab that never started a
 * gateway run owns a mux no transport watches, and a mux only gives up on
 * protocol v2 when someone listens; marking it here sends later one-shot
 * calls to v1.
 */
const watchedMuxes = new WeakSet<object>();

/** Subscribe on a v1 socket of its own; `ready` once the socket authenticated. */
const subscribeV1 = async (
  gatewayUrl: string,
  channel: string,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<OneShotChannelSubscription> => {
  const { token } = await aiAgentService.issueGatewayUserToken();
  const client = new AgentStreamClient({
    clientId: getLlmRelayClientId(),
    gatewayUrl,
    operationId: channel,
    token,
  });
  client.on('agent_event', onEvent);
  const ready = new Promise<void>((resolve) => {
    client.on('connected', () => resolve());
  });
  client.connect();
  return { close: () => client.disconnect(), ready };
};

/**
 * Subscribe this tab to a one-shot relay channel as its executor: on the
 * page-wide multiplexed socket (protocol v2) when this tab uses it, else on a
 * v1 socket of its own (self-hosted Go gateway, v2 unavailable).
 *
 * `ready` resolves once the gateway has the subscription — v2 answers
 * `resume_complete` (pending: the server has not opened the channel yet), v1
 * authenticates the socket — so the server's dispatch cannot outrun it. A mux
 * that gives up on v2 while the channel is live hands it to a v1 socket.
 */
export const subscribeLlmRelayChannel = async (
  gatewayUrl: string,
  channel: string,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<OneShotChannelSubscription> => {
  const identity = { gatewayUrl };

  if (!canUseGatewayProtocolV2() || isGatewayMuxUnavailable(identity)) {
    return subscribeV1(gatewayUrl, channel, onEvent);
  }

  const mux = getGatewayMux(identity);
  if (!watchedMuxes.has(mux)) {
    watchedMuxes.add(mux);
    mux.on('unavailable', () => markGatewayMuxUnavailable(identity));
  }

  const subscription = mux.subscribe(channel, { executor: true });
  subscription.on('agent_event', onEvent);

  let closed = false;
  let release = () => subscription.unsubscribe();
  let stopWatching = () => {};
  const ready = new Promise<void>((resolve) => {
    subscription.on('resume_complete', () => resolve());
    // The mux leaves its subscriptions for their owner to move.
    stopWatching = mux.on('unavailable', () => {
      stopWatching();
      subscription.unsubscribe();
      subscribeV1(gatewayUrl, channel, onEvent).then(
        (fallback) => {
          if (closed) return fallback.close();
          release = fallback.close;
          void fallback.ready.then(resolve);
        },
        // No v1 either: the request goes ahead and the server reports it.
        () => resolve(),
      );
    });
  });

  return {
    close: () => {
      closed = true;
      stopWatching();
      release();
    },
    ready,
  };
};
