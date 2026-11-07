import { isAnyMessageGatewayEnabled } from './MessageGatewayClient';

/**
 * Whether this deployment can serve a platform flagged `requiresInProcessConnection` (WeCom):
 * one that replies only over its own live connection, so the process holding the connection must
 * also be the one answering the platform webhook and the agent callbacks.
 *
 * Only a long-lived server running connections in-process can. Two deployments cannot:
 * - external message gateway: the gateway holds the connection and forwards inbound events, but
 *   cannot relay outbound frames;
 * - serverless (Vercel) without a gateway: connections live in the gateway cron invocation, while
 *   webhooks and callbacks land in other invocations that cannot reach the socket.
 */
export const canHostInProcessConnections = (): boolean =>
  !isAnyMessageGatewayEnabled() && !process.env.VERCEL_ENV;

export const inProcessConnectionUnavailableMessage = (platformName: string): string =>
  `${platformName} replies over its own long connection, which this deployment cannot hold in the process that answers messages (it needs a single long-running server without the external message gateway)`;
