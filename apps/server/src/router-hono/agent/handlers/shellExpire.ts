import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

import { resolveOperationOwner } from './resolveOperationOwner';

const log = debug('lobe-server:agent:shell-expire');

interface ShellExpireBody {
  operationId?: string;
  toolCallId?: string;
  toolMessageId?: string;
}

/**
 * Deadline for a parked shell command.
 *
 * Scheduled once when the operation parks, and delivered by QStash after the
 * configured wait. It is the only cost the wait carries besides its two ends:
 * the device normally reports completion long before this fires, and then this
 * message finds the placeholder already filled and does nothing.
 *
 * Auth: `qstashAuth` on the route.
 */
export async function shellExpire(c: Context): Promise<Response> {
  let body: ShellExpireBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { operationId, toolCallId } = body;
  if (!operationId || !toolCallId) {
    return c.json({ error: 'operationId and toolCallId are required' }, 400);
  }

  try {
    const coordinator = new AgentRuntimeCoordinator();
    const state: AgentState | null = await coordinator.loadAgentState(operationId);

    // Already resumed (the device won the race), interrupted, or reaped: there
    // is nothing left to fail. This is the common case, not an error.
    if (!state || state.status !== 'waiting_for_async_tool') {
      log('skip: op=%s is not parked (%s)', operationId, state?.status ?? 'no state');
      return c.json({ skipped: true });
    }

    const serverDB = await getServerDB();
    const owner = await resolveOperationOwner(serverDB, operationId);
    if (!owner) {
      log('skip: no owner for op=%s', operationId);
      return c.json({ skipped: true });
    }

    const aiAgentService = new AiAgentService(serverDB, owner.userId, {
      includeShareVisitor: Boolean(owner.streamOwnerUserId),
      workspaceId: owner.workspaceId,
    });

    const outcome = await aiAgentService.completeDeferredShell({
      operationId,
      reason: 'timeout',
      result: { content: null, success: false, toolCallId },
    });

    log('expired op=%s tool=%s handled=%s', operationId, toolCallId, String(outcome.handled));

    return c.json(outcome);
  } catch (error) {
    console.error('[agent/shell-expire] failed:', error);
    // Non-2xx → QStash redelivers; the backfill is idempotent.
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
