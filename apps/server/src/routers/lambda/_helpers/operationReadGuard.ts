import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorTopicRef } from '@/database/utils/shareVisitor';
import { createAgentStateManager } from '@/server/modules/AgentRuntime/factory';

import { assertCanUseWorkspaceAgent } from './workspaceAgentGuard';

interface OperationReadParams {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
  workspaceId?: string | null;
}

const operationNotFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });

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
export const assertOperationVisibleToCaller = async (params: OperationReadParams) => {
  if (!(await isPersistedOperationVisible(params))) throw operationNotFound();
};

/**
 * Guard for the operation's stream event journal. Same visibility as
 * {@link assertOperationVisibleToCaller}, plus one fallback: the initial
 * operation insert is deliberately non-fatal, so a live run can exist only in
 * runtime metadata. Its owner may still read the journal — but only for a
 * genuinely absent row, never for a persisted visitor-topic operation the
 * visibility filter hid, and never for a Share run (`streamOwnerUserId`).
 */
export const assertOperationStreamReadable = async (params: OperationReadParams) => {
  const visible = await isPersistedOperationVisible(params);
  if (visible) return;
  if (visible === undefined && (await isUnpersistedRuntimeOwner(params))) return;
  throw operationNotFound();
};

/**
 * `true`/`false` for a visible/hidden persisted row; `undefined` when the
 * visibility filter found no row at all.
 */
const isPersistedOperationVisible = async ({
  db,
  operationId,
  userId,
  workspaceId,
}: OperationReadParams): Promise<boolean | undefined> => {
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

  if (!row) return undefined;
  if (row.userId === userId) return true;

  if (!row.workspaceId || !workspaceId || row.workspaceId !== workspaceId || !row.agentId) {
    return false;
  }

  await assertCanUseWorkspaceAgent({ agentId: row.agentId, db, userId, workspaceId });
  return true;
};

const isUnpersistedRuntimeOwner = async ({ db, operationId, userId }: OperationReadParams) => {
  const [persisted] = await db
    .select({ id: agentOperations.id })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);
  if (persisted) return false;

  const metadata = await createAgentStateManager().getOperationMetadata(operationId);
  return metadata?.userId === userId && !metadata.streamOwnerUserId;
};

/**
 * Whether the persisted operation was started by someone other than the caller.
 *
 * Workspace reads are member-wide (a teammate can open a topic another member's
 * run is still driving), but the Gateway stream and the run's terminal settle
 * stay with the user who started it: the gateway registers each operation under
 * that user's id and refuses every other `sub`. The initial insert is
 * non-fatal, so a live run may have no row; its runtime metadata then names the
 * starter, as in {@link isUnpersistedRuntimeOwner}.
 */
export const isOperationOwnedByAnotherUser = async ({
  db,
  operationId,
  userId,
}: Pick<OperationReadParams, 'db' | 'operationId' | 'userId'>): Promise<boolean> => {
  const [row] = await db
    .select({ userId: agentOperations.userId })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);

  if (row) return row.userId !== userId;

  const metadata = await createAgentStateManager().getOperationMetadata(operationId);
  return !!metadata?.userId && metadata.userId !== userId;
};
