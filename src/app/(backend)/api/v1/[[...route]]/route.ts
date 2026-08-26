import lobeOpenApi, {
  AGENT_SHARE_DELETE_SIGNAL_HEADER,
  AGENT_SHARE_RESET_SIGNAL_HEADER,
  type AgentShareDeleteSignal,
} from '@lobechat/openapi';

import { getServerDB } from '@/database/core/db-adaptor';
import { AiAgentService } from '@/server/services/aiAgent';
import { after } from '@/server/utils/scheduleAfterResponse';

/**
 * `packages/openapi` cannot import `AiAgentService`/`after()` (apps/server
 * layer) to interrupt an Agent Share visitor's in-flight run when a config
 * write resets a `link` share back to `private` — see
 * `AGENT_SHARE_RESET_SIGNAL_HEADER`'s JSDoc and LOBE-11930 hole 2. This is
 * the one place, on the actual server boundary, that CAN reach both sides:
 * read the signal `AgentController.updateAgent` left on the response, fire
 * the interrupt, and strip the header before the response reaches the API
 * caller (it is an internal wiring detail, not a documented API contract).
 */
const handleAgentShareResetSignal = (response: Response): Response => {
  const signal = response.headers.get(AGENT_SHARE_RESET_SIGNAL_HEADER);
  if (!signal) return response;

  const [ownerId, agentId] = signal.split(':');
  if (ownerId && agentId) {
    after(async () => {
      const serverDB = await getServerDB();
      await new AiAgentService(serverDB, ownerId)
        .interruptActiveShareRuns(agentId)
        .catch((error) => console.error('[openapi] interruptActiveShareRuns failed', error));
    });
  }

  const headers = new Headers(response.headers);
  headers.delete(AGENT_SHARE_RESET_SIGNAL_HEADER);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

/**
 * Sibling of `handleAgentShareResetSignal` for `AgentController.deleteAgent`
 * — see `AGENT_SHARE_DELETE_SIGNAL_HEADER`'s JSDoc for why the payload is a
 * pre-snapshotted run list (JSON-encoded) instead of just an agentId: the
 * delete already cascaded the topic rows away by the time this runs, so
 * `AiAgentService.interruptActiveShareRuns` (a re-query) would find nothing.
 * Calls `interruptTask` directly for each snapshotted operation instead. See
 * LOBE-11930.
 */
const handleAgentShareDeleteSignal = (response: Response): Response => {
  const signal = response.headers.get(AGENT_SHARE_DELETE_SIGNAL_HEADER);
  if (!signal) return response;

  try {
    const { activeShareRuns, ownerId }: AgentShareDeleteSignal = JSON.parse(signal);
    if (ownerId && activeShareRuns.length > 0) {
      after(async () => {
        const serverDB = await getServerDB();
        const aiAgentService = new AiAgentService(serverDB, ownerId);
        await Promise.all(
          activeShareRuns.map(({ operationId }) =>
            aiAgentService
              .interruptTask({ operationId })
              .catch((error) =>
                console.error('[openapi] interruptTask (agent delete) failed', error),
              ),
          ),
        );
      });
    }
  } catch (error) {
    console.error('[openapi] failed to parse agent share delete signal', error);
  }

  const headers = new Headers(response.headers);
  headers.delete(AGENT_SHARE_DELETE_SIGNAL_HEADER);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const handler = async (request: Request) => {
  const response = await lobeOpenApi.fetch(request);
  return handleAgentShareDeleteSignal(handleAgentShareResetSignal(response));
};

// Export all required HTTP method handlers
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;
