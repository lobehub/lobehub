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
 * Subscribe this tab to a one-shot relay channel as its executor: on the
 * page-wide multiplexed socket (protocol v2) when this tab uses it, else on a
 * v1 socket of its own (self-hosted Go gateway, v2 unavailable).
 *
 * `ready` resolves once the gateway has the subscription — v2 answers
 * `resume_complete` (pending: the server has not opened the channel yet), v1
 * authenticates the socket — so the server's dispatch cannot outrun it.
 */
/**
 * Muxes this module watches for `unavailable`. A tab that never started a
 * gateway run owns a mux no transport watches, and a mux only gives up on
 * protocol v2 when someone listens; marking it here sends later one-shot
 * calls to v1.
 */
const watchedMuxes = new WeakSet<object>();

export const subscribeLlmRelayChannel = async (
  gatewayUrl: string,
  channel: string,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<OneShotChannelSubscription> => {
  const identity = { gatewayUrl };

  if (canUseGatewayProtocolV2() && !isGatewayMuxUnavailable(identity)) {
    const mux = getGatewayMux(identity);
    if (!watchedMuxes.has(mux)) {
      watchedMuxes.add(mux);
      mux.on('unavailable', () => markGatewayMuxUnavailable(identity));
    }
    const subscription = mux.subscribe(channel, { executor: true });
    subscription.on('agent_event', onEvent);
    const ready = new Promise<void>((resolve) => {
      subscription.on('resume_complete', () => resolve());
    });
    return { close: () => subscription.unsubscribe(), ready };
  }

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
