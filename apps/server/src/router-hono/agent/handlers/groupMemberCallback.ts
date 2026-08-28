import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:group-member-callback');

/**
 * Group-action member completion bridge webhook (queue mode).
 *
 * When a group member op — forked by a supervisor parked on a
 * `lobe-group-management` action (speak / broadcast / delegate /
 * executeAgentTask(s)) — reaches a terminal state, its `onComplete` hook is
 * delivered here via QStash (in-memory handler hooks don't survive queue mode's
 * cross-process steps). Backfills the member anchor, enforces the K=N member
 * barrier, then resumes/finishes the parked supervisor via
 * `completeGroupActionMember`.
 *
 * Body: `{ operationId, reason }` (event fields) plus the bridge params from
 * `webhook.body`: `{ anchorMessageId, expectedMembers, groupToolMessageId, mode,
 * onComplete, parentOperationId, threadId? }`.
 *
 * Auth: `qstashAuth` on the route — QStash signature required.
 */
export async function groupMemberCallback(c: Context): Promise<Response> {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    anchorMessageId,
    expectedMembers,
    groupToolMessageId,
    mode,
    onComplete,
    operationId,
    parentOperationId,
    reason,
    threadId,
  } = body;

  log(
    'group-member-callback: operationId=%s, parentOperationId=%s, reason=%s, anchor=%s, %d members',
    operationId,
    parentOperationId,
    reason,
    anchorMessageId,
    expectedMembers,
  );

  if (!operationId || !parentOperationId || !anchorMessageId || !groupToolMessageId) {
    return c.json(
      {
        error:
          'Missing required fields: operationId, parentOperationId, anchorMessageId, groupToolMessageId',
      },
      400,
    );
  }

  try {
    // Resolve userId from the child op's metadata — same trust chain as /run:
    // the body is QStash-signature-verified, the operation must exist.
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);

    if (!metadata?.userId) {
      log('group-member-callback: invalid operation or no userId found for %s', operationId);
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }

    const serverDB = await getServerDB();
    const aiAgentService = new AiAgentService(serverDB, metadata.userId, {
      workspaceId: metadata.workspaceId,
    });

    const resumed = await aiAgentService.completeGroupActionMember({
      anchorMessageId,
      expectedMembers: Number(expectedMembers) || 1,
      groupToolMessageId,
      mode: mode === 'isolated' ? 'isolated' : 'in_group',
      onComplete: onComplete === 'finish' ? 'finish' : 'resume',
      operationId,
      parentOperationId,
      reason: reason ?? 'done',
      threadId: threadId ?? undefined,
    });

    return c.json({ operationId, parentOperationId, resumed, success: true });
  } catch (error) {
    console.error('group-member-callback error:', error);
    // Non-2xx → QStash redelivers, covering transient DB/Redis failures.
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
