import { GatewayMuxClient } from '@lobechat/agent-gateway-client';

import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';

export interface GatewayMuxIdentity {
  /**
   * Present on the agent-share visitor surface. The visitor's socket is
   * authenticated with a share-scoped user token, so it must not be shared
   * with the owner-scoped socket of the same page.
   */
  agentShareId?: string;
  /** Gateway URL base (e.g. https://agent-gateway.lobehub.com). */
  gatewayUrl: string;
}

const registry = new Map<string, GatewayMuxClient>();

const identityKey = ({ agentShareId, gatewayUrl }: GatewayMuxIdentity): string =>
  `${gatewayUrl}|${agentShareId ?? 'owner'}`;

/**
 * `getToken` is invoked before EVERY dial (initial connect, backoff retry,
 * 4401 refresh), so the mux never needs the v1 `auth_expired` → `updateToken`
 * round trip. Owners mint a user-level token; share visitors mint one scoped
 * to the share.
 */
const buildGetToken =
  ({ agentShareId }: GatewayMuxIdentity): (() => Promise<string>) =>
  async () => {
    const { token } = agentShareId
      ? await shareChatService.issueGatewayUserToken(agentShareId)
      : await aiAgentService.issueGatewayUserToken();
    return token;
  };

/**
 * One `GatewayMuxClient` per `${gatewayUrl}|${agentShareId ?? 'owner'}` for
 * the lifetime of the page. Every operation on the same identity multiplexes
 * over that single socket (protocol v2). The socket is dialed on app entry by
 * `warmupGatewayMux` (or lazily on the first `subscribe` if that never ran)
 * and is kept up across runs — `keepAlive` so a drop is redialed even while
 * nothing is subscribed.
 */
export const getGatewayMux = (identity: GatewayMuxIdentity): GatewayMuxClient => {
  const key = identityKey(identity);
  let mux = registry.get(key);
  if (!mux) {
    mux = new GatewayMuxClient({
      gatewayUrl: identity.gatewayUrl,
      getToken: buildGetToken(identity),
      keepAlive: true,
    });
    registry.set(key, mux);
  }
  return mux;
};

/**
 * Tear down every mux (they hold window listeners and the lifecycle → store
 * feed) and forget them. Called when the user-data context resets
 * (`stores.reset()`, e.g. the desktop app switching or disconnecting its
 * remote server) so a socket authenticated for the previous identity never
 * outlives it or keeps writing into the reset chat store; also a test seam.
 */
export const resetGatewayMuxRegistry = (): void => {
  for (const mux of registry.values()) mux.disconnect();
  registry.clear();
};
