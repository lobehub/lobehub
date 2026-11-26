import { isMessageGatewayHostConfigured, resolveMessageGatewayHost } from './MessageGatewayClient';

/**
 * Whether the message gateway cannot hold `platform`'s persistent connection on this deployment.
 *
 * A `nodeMessageGatewayOnly` platform (DingTalk Stream) has a handler only on the Node message
 * gateway, so the gateway can host it only when the platform is routed there
 * (`MESSAGE_GATEWAY_NODE_PLATFORMS`) and the Node host is configured. Elsewhere only webhook mode
 * works and persistent modes are refused with an actionable error. Callers check this only with
 * the gateway enabled; in-process connections (gateway disabled) are unaffected.
 */
export const isMessageGatewayHostingUnavailable = (
  platform: { id: string; nodeMessageGatewayOnly?: boolean } | undefined,
): boolean =>
  !!platform?.nodeMessageGatewayOnly &&
  !(resolveMessageGatewayHost(platform.id) === 'node' && isMessageGatewayHostConfigured('node'));
