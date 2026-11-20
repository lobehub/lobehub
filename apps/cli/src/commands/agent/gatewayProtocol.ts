import type { TrpcClient } from '../../api/client';
import { normalizeUrl } from '../../settings';
import { formatError } from '../../utils/error';
import { log } from '../../utils/logger';

/** Bounds the capability lookup so it never holds up following the run. */
const LOOKUP_TIMEOUT_MS = 5000;

/**
 * Whether the multiplexed `/v2/ws` socket can be dialed on `gatewayUrl`.
 *
 * The server publishes which protocol its Gateway serves
 * (`serverConfig.agentGatewayProtocol`); a self-hosted Gateway only has `/ws`,
 * and there is no negotiation on the socket. The answer only describes the
 * server's own Gateway, so a CLI pointed at a different one stays on `/ws`.
 * Anything short of a clear "2" — an older server, a failed lookup — is
 * protocol 1, which every Gateway serves.
 */
export const supportsGatewayProtocolV2 = async (
  client: TrpcClient,
  gatewayUrl: string,
): Promise<boolean> => {
  try {
    const config = await client.config.getGlobalConfig.query(undefined, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const { agentGatewayProtocol, agentGatewayUrl } = config.serverConfig;
    if (agentGatewayProtocol !== 2) return false;

    return !agentGatewayUrl || normalizeUrl(agentGatewayUrl) === normalizeUrl(gatewayUrl);
  } catch (error) {
    log.debug(`Agent gateway protocol lookup failed, using /ws: ${formatError(error)}`);
    return false;
  }
};
