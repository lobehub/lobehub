import debug from 'debug';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { agentOperations } from '@/database/schemas/agentOperations';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import {
  isShareVisitorActor,
  resolveRunActor,
  resolveRunActorFromMetadata,
  RUN_IDENTITY_METADATA_KEY,
  type RunActorResolution,
} from '@/server/modules/AgentRuntime/runIdentity';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:subagent-callback');

/**
 * Sub-agent completion bridge webhook (queue mode).
 *
 * When a server sub-agent op — spawned by a parent parked on `callSubAgent` —
 * reaches a terminal state, its `onComplete` hook is delivered here via QStash
 * (in-memory handler hooks don't survive queue mode's cross-process steps).
 * Backfills the parent's placeholder tool message and barrier-resumes the
 * parked parent op via `completeSubAgentBridge`.
 *
 * Body: `{ operationId, reason, parentOperationId, threadId, toolMessageId, errorMessage? }`
 * — event fields from the hook dispatch plus the bridge params from
 * `webhook.body`. `errorMessage` is set by the watchdog abandon path, whose
 * child state never records the failure; without it the parent reads a bare
 * "Sub-agent did not complete (error).". `streamOwnerUserId` is forwarded by
 * the abandon paths for when the child's coordinator metadata is gone.
 *
 * Auth: `qstashAuth` on the route — QStash signature required.
 */
export async function subAgentCallback(c: Context): Promise<Response> {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    errorMessage,
    operationId,
    parentOperationId,
    reason,
    streamOwnerUserId,
    threadId,
    toolMessageId,
  } = body;

  log(
    'subagent-callback: operationId=%s, parentOperationId=%s, reason=%s, toolMessageId=%s',
    operationId,
    parentOperationId,
    reason,
    toolMessageId,
  );

  if (!operationId || !parentOperationId || !toolMessageId) {
    return c.json(
      { error: 'Missing required fields: operationId, parentOperationId, toolMessageId' },
      400,
    );
  }

  try {
    // Resolve the owner from the child operation's metadata — same trust chain
    // as /run: the body is QStash-signature-verified, the operation must exist.
    // An abandon path can resume the parent precisely because the child's
    // metadata is gone (runStep's orphan recovery), so fall back to the durable
    // operation row; otherwise every redelivery 401s and the parent stays
    // parked in `waiting_for_async_tool` forever.
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);
    const serverDB = await getServerDB();

    let owner: { runActor: RunActorResolution; userId: string; workspaceId?: string } | undefined;
    if (metadata?.userId) {
      owner = {
        runActor: resolveRunActorFromMetadata(metadata),
        userId: metadata.userId,
        workspaceId: metadata.workspaceId,
      };
    } else {
      const [row] = await serverDB
        .select({
          metadata: agentOperations.metadata,
          userId: agentOperations.userId,
          workspaceId: agentOperations.workspaceId,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId))
        .limit(1);
      if (row) {
        owner = {
          // The row keeps the run identity past the runtime metadata's TTL. Only
          // the abandon paths forward `streamOwnerUserId`, so its absence from
          // the body says nothing.
          runActor: resolveRunActor(row.metadata?.[RUN_IDENTITY_METADATA_KEY], {
            shareVisitorUserId:
              typeof streamOwnerUserId === 'string' && streamOwnerUserId
                ? streamOwnerUserId
                : undefined,
            userId: row.userId,
          }),
          userId: row.userId,
          workspaceId: row.workspaceId ?? undefined,
        };
      }
    }

    if (!owner) {
      log('subagent-callback: invalid operation or no userId found for %s', operationId);
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }
    // A run identity that contradicts its mirror, or comes from a newer build,
    // is refused rather than guessed at; QStash redelivers.
    if (!owner.runActor.ok) {
      log(
        'subagent-callback: unresolved run identity for %s (%s)',
        operationId,
        owner.runActor.reason,
      );
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }

    // Bridge through AiAgentService (like the /run step worker) so the
    // runtime's models stay workspace-scoped — a bare AgentRuntimeService
    // would be personal-scoped and the tool-message backfill / resume
    // barrier could miss workspace-scoped rows.
    // Opt into visitor rows only when a share visitor operates the run (it
    // executes as the creator). Ordinary creator ops keep the default
    // exclusion.
    const aiAgentService = new AiAgentService(serverDB, owner.userId, {
      includeShareVisitor: isShareVisitorActor(owner.runActor.actor),
      workspaceId: owner.workspaceId,
    });

    const resumed = await aiAgentService.completeSubAgentBridge({
      errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined,
      operationId,
      parentOperationId,
      reason: reason ?? 'done',
      threadId: threadId ?? '',
      toolMessageId,
    });

    return c.json({ operationId, parentOperationId, resumed, success: true });
  } catch (error) {
    console.error('subagent-callback error:', error);
    // Non-2xx → QStash redelivers, covering transient DB/Redis failures.
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
