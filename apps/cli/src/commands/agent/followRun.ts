import { getTrpcClient } from '../../api/client';
import { getAgentStreamAuthInfo } from '../../api/http';
import { resolveAgentGatewayUrl } from '../../settings';
import type { AgentRunOutcome } from '../../utils/agentRunOutcome';
import { streamAgentEventsViaWebSocket } from '../../utils/agentStream';
import { AgentStreamHistoryError } from '../../utils/agentStreamTransport';
import { log } from '../../utils/logger';

interface FollowAgentRunOptions {
  json?: boolean;
  /** See `streamAgentEventsViaWebSocket`; omit for runs where long silence is healthy. */
  onStall?: () => Promise<AgentRunOutcome | undefined>;
  verbose?: boolean;
}

/**
 * Follow a started operation until its terminal event and render it.
 *
 * An incomplete event history resolves as an `unknown` outcome (exit 3), never
 * a success. Other errors (no gateway configured) reject so the caller can
 * choose a fallback.
 */
export const followAgentRun = async (
  operationId: string,
  options: FollowAgentRunOptions = {},
): Promise<AgentRunOutcome> => {
  const gatewayUrl = resolveAgentGatewayUrl();
  if (!gatewayUrl) throw new Error('Agent gateway URL is not configured');

  try {
    const outcome = await streamAgentEventsViaWebSocket({
      ...options,
      gatewayUrl,
      getAuth: () => getAgentStreamAuthInfo(),
      operationId,
      // The cached client resolves stored credentials per request, so pages
      // read after a token refresh still authenticate.
      readHistory: async (cursor, signal) =>
        (await getTrpcClient()).aiAgent.getOperationStreamHistory.query(
          { cursor, operationId },
          { signal },
        ),
    });
    return outcome ?? { kind: 'unknown' };
  } catch (error) {
    if (!(error instanceof AgentStreamHistoryError)) throw error;
    log.error(error.message);
    return { kind: 'unknown' };
  }
};
