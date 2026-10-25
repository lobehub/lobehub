import { getTrpcClient } from '../../api/client';
import { resolveAgentStreamAuthInfo } from '../../api/http';
import { resolveAgentGatewayUrl } from '../../settings';
import type { AgentRunOutcome } from '../../utils/agentRunOutcome';
import { streamAgentEvents } from '../../utils/agentStream';
import {
  AgentGatewayUnavailableError,
  AgentJournalUnsupportedError,
  AgentStreamHistoryError,
} from '../../utils/agentStreamTransport';
import { log } from '../../utils/logger';

interface FollowAgentRunOptions {
  json?: boolean;
  /** See `streamAgentEvents`; omit for runs where long silence is healthy. */
  onStall?: () => Promise<AgentRunOutcome | undefined>;
  verbose?: boolean;
}

/**
 * tRPC answers a procedure the server does not implement with `NOT_FOUND` and
 * the path in the message. The CLI ships independently of the server, so an
 * upgraded CLI against an older self-hosted server hits exactly this.
 */
const MISSING_PROCEDURE = /no procedure|not found on path/i;

const isMissingJournalProcedure = (error: unknown) =>
  MISSING_PROCEDURE.test(String((error as { message?: string })?.message ?? error));

/**
 * Follow a started operation until its terminal event and render it.
 *
 * An incomplete event history resolves as an `unknown` outcome (exit 3), never
 * a success. Other errors (no gateway configured, or a server without the
 * journal endpoint) reject so the caller can choose a fallback.
 */
export const followAgentRun = async (
  operationId: string,
  options: FollowAgentRunOptions = {},
): Promise<AgentRunOutcome> => {
  const gatewayUrl = resolveAgentGatewayUrl();
  if (!gatewayUrl) throw new Error('Agent gateway URL is not configured');

  try {
    const outcome = await streamAgentEvents({
      ...options,
      gatewayUrl,
      getAuth: () => resolveAgentStreamAuthInfo(),
      operationId,
      // The cached client resolves stored credentials per request, so pages
      // read after a token refresh still authenticate.
      readHistory: async (cursor, signal) => {
        try {
          return await (await getTrpcClient()).aiAgent.getOperationStreamHistory.query(
            { cursor, operationId },
            { signal },
          );
        } catch (error) {
          // Server predates the journal: no event stream can be produced, but the
          // run is still observable through status polling.
          if (isMissingJournalProcedure(error))
            throw new AgentJournalUnsupportedError(
              'This server has no agent event journal (getOperationStreamHistory); the CLI is newer than the server',
            );
          throw error;
        }
      },
    });
    return outcome ?? { kind: 'unknown' };
  } catch (error) {
    // A missing journal is a compatibility gap, not a lost history: let the
    // caller degrade to polling instead of exiting with an unknown outcome.
    if (error instanceof AgentJournalUnsupportedError) throw error;
    // The Gateway never came back while the run was quiet. The journal and the
    // status endpoint may still be healthy, so this is not an unconfirmable
    // history either — reject so the caller can keep polling instead of
    // reporting `unknown` and skipping its fallback.
    if (error instanceof AgentGatewayUnavailableError) throw error;
    if (!(error instanceof AgentStreamHistoryError)) throw error;
    log.error(error.message);
    return { kind: 'unknown' };
  }
};
