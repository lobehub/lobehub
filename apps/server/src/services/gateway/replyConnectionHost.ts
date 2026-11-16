import {
  isAnyMessageGatewayEnabled,
  isMessageGatewayHostConfigured,
  resolveMessageGatewayHost,
} from './MessageGatewayClient';

/**
 * Who holds the live connection of a platform flagged `repliesOverConnection` (WeCom), which
 * sends every reply on that connection: WeCom AI bots have no REST send API.
 *
 * - `in-process`: a long-running server without the external message gateway holds it itself.
 * - `message-gateway`: the Node message gateway holds it and sends on the server's behalf
 *   (`MessageGatewayClient.sendText` / `startTyping`). Only the Node gateway relays outbound
 *   frames, so the platform must be routed there (`MESSAGE_GATEWAY_NODE_PLATFORMS`).
 *
 * `undefined` when nothing can: serverless without a gateway (the connection would live in the
 * cron invocation, out of reach of the webhook and callback invocations that reply), or a gateway
 * deployment that leaves the platform on the default (Cloudflare) host.
 */
export type ReplyConnectionHost = 'in-process' | 'message-gateway';

export const resolveReplyConnectionHost = (platformId: string): ReplyConnectionHost | undefined => {
  if (isAnyMessageGatewayEnabled()) {
    return resolveMessageGatewayHost(platformId) === 'node' &&
      isMessageGatewayHostConfigured('node')
      ? 'message-gateway'
      : undefined;
  }
  return process.env.VERCEL_ENV ? undefined : 'in-process';
};

export const replyConnectionUnavailableMessage = (platformName: string): string =>
  `${platformName} replies over its own long connection, which this deployment cannot hold where it answers messages (it needs a single long-running server, or the Node message gateway with this platform in MESSAGE_GATEWAY_NODE_PLATFORMS)`;

/** Why a bot on `platform` cannot run on this deployment, or `undefined` when it can. */
export const getReplyConnectionUnavailableReason = (
  platform: { id: string; name: string; repliesOverConnection?: boolean } | undefined,
): string | undefined =>
  platform?.repliesOverConnection && !resolveReplyConnectionHost(platform.id)
    ? replyConnectionUnavailableMessage(platform.name)
    : undefined;
