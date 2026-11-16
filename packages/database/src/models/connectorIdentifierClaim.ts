import type { SQL } from 'drizzle-orm';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { UserConnectorItem } from '../schemas';
import { userConnectors } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/**
 * The connector scope a base-row claim runs in: the {@link ConnectorModel}'s
 * user, workspace and row filter.
 */
export interface BaseIdentifierScope {
  ownership: () => SQL | undefined;
  userId: string;
  workspaceId?: string;
}

/** {@link ConnectorModel.create} of a base connector whose identifier a base row of the scope holds. */
export class ConnectorIdentifierHeldError extends Error {
  constructor(identifier: string) {
    super(`A connector with identifier "${identifier}" already exists`);
    this.name = 'ConnectorIdentifierHeldError';
  }
}

/**
 * Hold this scope's base-row lock on `identifier` until `tx` ends. A writer
 * that adds a base row (a create, a move out of an agent) takes it before
 * looking for a holder, so no two of them both find the identifier free.
 */
const lockBaseIdentifier = async (
  tx: Transaction,
  scope: BaseIdentifierScope,
  identifier: string,
) => {
  const scopeKey = scope.workspaceId ? `workspace:${scope.workspaceId}` : `user:${scope.userId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`user_connectors:${scopeKey}:${identifier}`}))`,
  );
};

const baseHolderFilter = (scope: BaseIdentifierScope, identifier: string) =>
  and(scope.ownership(), eq(userConnectors.identifier, identifier), isNull(userConnectors.agentId));

/**
 * The base rows of this scope holding `identifier`, oldest first, locked until
 * `tx` ends: the caller judges and may delete them as read, so a rewrite of
 * one ({@link ConnectorModel.update}, a re-add) either lands first, and is what
 * gets judged, or waits for the caller.
 */
const findBaseHolders = async (
  tx: Transaction,
  scope: BaseIdentifierScope,
  identifier: string,
): Promise<UserConnectorItem[]> =>
  tx
    .select()
    .from(userConnectors)
    .where(baseHolderFilter(scope, identifier))
    .orderBy(asc(userConnectors.createdAt))
    .for('update');

/**
 * The base rows of this scope holding `identifier`, oldest first, read without
 * the lock: rows written before it may duplicate the identifier, so a caller
 * judging the holder before (or after) a claim judges every one of them.
 */
export const queryBaseHolders = async (
  db: LobeChatDatabase,
  scope: BaseIdentifierScope,
  identifier: string,
): Promise<UserConnectorItem[]> =>
  db
    .select()
    .from(userConnectors)
    .where(baseHolderFilter(scope, identifier))
    .orderBy(asc(userConnectors.createdAt));

/**
 * Claim `identifier` for a new base row inside `tx`, under the identifier lock
 * every base-row writer takes: the identifier indexes are not unique, so two
 * concurrent callers would otherwise both find it free and both insert.
 * `canReplace` may let the holding rows go: they are deleted, with their tools,
 * in that step. Every holder is judged (rows written before the lock may
 * duplicate the identifier), and the first one that may not go is returned:
 * it keeps the identifier, and the caller inserts nothing.
 */
export const claimBaseIdentifier = async (
  tx: Transaction,
  scope: BaseIdentifierScope,
  identifier: string,
  canReplace?: (holder: UserConnectorItem) => boolean,
): Promise<UserConnectorItem | undefined> => {
  await lockBaseIdentifier(tx, scope, identifier);

  const holders = await findBaseHolders(tx, scope, identifier);
  const kept = holders.find((holder) => !canReplace?.(holder));
  if (kept) return kept;
  if (holders.length > 0) {
    await tx.delete(userConnectors).where(
      and(
        inArray(
          userConnectors.id,
          holders.map((holder) => holder.id),
        ),
        scope.ownership(),
      ),
    );
  }
  return undefined;
};

/**
 * Move an agent's connector into the base scope (`agent_id = NULL`) unless a
 * base row in this scope already holds its identifier: the lookup and the
 * move are one step, under the lock {@link claimBaseIdentifier} takes.
 * A connector already moved (by a retry, or an unbind running at the same
 * time) is reported as moved, not as holding its own identifier.
 */
export const moveToBaseUnlessIdentifierHeld = async (
  db: LobeChatDatabase,
  scope: BaseIdentifierScope,
  id: string,
  identifier: string,
): Promise<{ holder: UserConnectorItem } | { moved: true }> =>
  db.transaction(async (tx) => {
    await lockBaseIdentifier(tx, scope, identifier);

    const holders = await findBaseHolders(tx, scope, identifier);
    if (holders.some((holder) => holder.id === id)) return { moved: true as const };
    if (holders.length > 0) return { holder: holders[0] };

    await tx
      .update(userConnectors)
      .set({ agentId: null, updatedAt: new Date() })
      .where(
        and(
          eq(userConnectors.id, id),
          eq(userConnectors.identifier, identifier),
          scope.ownership(),
        ),
      );
    return { moved: true as const };
  });
