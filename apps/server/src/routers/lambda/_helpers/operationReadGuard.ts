import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorTopicRef } from '@/database/utils/shareVisitor';
import { createAgentStateManager } from '@/server/modules/AgentRuntime/factory';

import { assertCanUseWorkspaceAgent } from './workspaceAgentGuard';

/**
 * The initial operation insert is deliberately non-fatal, so a live run can
 * exist only in runtime metadata. Accept its owner for a genuinely absent row,
 * never for a persisted visitor-topic operation the visibility guard filtered.
 */
const isUnpersistedRuntimeOwner = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
}) => {
  const [persisted] = await params.db
    .select({ id: agentOperations.id })
    .from(agentOperations)
    .where(eq(agentOperations.id, params.operationId))
    .limit(1);
  if (persisted) return false;

  const metadata = await createAgentStateManager().getOperationMetadata(params.operationId);
  return metadata?.userId === params.userId && !metadata.streamOwnerUserId;
};

/**
 * Ownership guard for operation-keyed READ endpoints (`getOperationStatus`,
 * `getPendingInterventions`). The runtime coordinator keys operations purely
 * by id and returns the raw operation metadata — including the executing
 * user's full `agentConfig` and `modelRuntimeConfig` — so the id itself must
 * not act as a bearer token.
 *
 * Historically that was inert: an operation id was only ever known to the
 * user who started it. Agent Share breaks the assumption on purpose — a share
 * run executes under the CREATOR's identity while the VISITOR receives the
 * `operationId` (to attach to the Gateway stream, which redacts creator
 * details). Without this guard the visitor could replay that id here and read
 * the unredacted creator config the stream path deliberately hides.
 *
 * Visible to: the operation's owner, or (workspace runs) a member with `use`
 * access to the operation's agent in the SAME workspace as the caller.
 * Everything else — share visitors, AND the creator looking at a visitor's
 * run — resolves as NOT_FOUND so the endpoint does not confirm which ids
 * exist.
 */
export const assertOperationVisibleToCaller = async (params: {
  allowRuntimeOwner?: boolean;
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, operationId, userId, workspaceId } = params;

  // Share-visitor runs are ALSO excluded (`notShareVisitorTopicRef`): they
  // execute under the creator's userId, so the owner shortcut below would
  // otherwise hand the creator the visitor's run metadata, history and
  // stream events — the same exclusion `findOwnOperationById` applies to
  // the trace reads.
  const [row] = await db
    .select({
      agentId: agentOperations.agentId,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(
      and(eq(agentOperations.id, operationId), notShareVisitorTopicRef(agentOperations.topicId)),
    )
    .limit(1);

  const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });

  if (!row) {
    if (params.allowRuntimeOwner && (await isUnpersistedRuntimeOwner({ db, operationId, userId })))
      return;
    throw notFound();
  }
  if (row.userId === userId) return;

  if (!row.workspaceId || !workspaceId || row.workspaceId !== workspaceId || !row.agentId) {
    throw notFound();
  }

  await assertCanUseWorkspaceAgent({ agentId: row.agentId, db, userId, workspaceId });
};
