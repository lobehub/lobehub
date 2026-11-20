import type { ConnectorVisibility } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { UserConnectorItem } from '../schemas';
import { userConnectors } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { normalizeWorkspaceId } from '../utils/workspace';

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
 * In a workspace, the base rows of one visibility: the shared rows (default),
 * or the caller's own private rows. A base row holds its identifier within its
 * visibility only, so a member's private connector never blocks (or rewrites)
 * the shared one of the same identifier, nor the shared one a private one. A
 * personal scope has one visibility.
 */
export const sameBaseVisibility = (
  scope: BaseIdentifierScope,
  visibility: ConnectorVisibility = 'public',
) =>
  normalizeWorkspaceId(scope.workspaceId)
    ? visibility === 'private'
      ? and(eq(userConnectors.visibility, 'private'), eq(userConnectors.userId, scope.userId))
      : eq(userConnectors.visibility, 'public')
    : undefined;

/**
 * The advisory-lock key of `identifier`'s base rows in this scope. It names the
 * scope the rows are written to, so the workspace id is normalized as
 * `buildWorkspacePayload` stores it: a padded id is its trimmed workspace, and
 * a blank one is the user's personal scope.
 */
export const baseIdentifierLockKey = (
  scope: Pick<BaseIdentifierScope, 'userId' | 'workspaceId'>,
  identifier: string,
) => {
  const workspaceId = normalizeWorkspaceId(scope.workspaceId);
  const scopeKey = workspaceId ? `workspace:${workspaceId}` : `user:${scope.userId}`;
  return `user_connectors:${scopeKey}:${identifier}`;
};

/**
 * Hold this scope's base-row lock on `identifier` until `tx` ends. A writer
 * that adds a base row (a create, a move out of an agent) takes it before
 * looking for a holder, so no two of them both find the identifier free. One
 * lock covers every visibility of the identifier.
 */
const lockBaseIdentifier = async (
  tx: Transaction,
  scope: BaseIdentifierScope,
  identifier: string,
) => {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${baseIdentifierLockKey(scope, identifier)}))`,
  );
};

const baseHolderFilter = (
  scope: BaseIdentifierScope,
  identifier: string,
  visibility?: ConnectorVisibility,
) =>
  and(
    scope.ownership(),
    eq(userConnectors.identifier, identifier),
    isNull(userConnectors.agentId),
    sameBaseVisibility(scope, visibility),
  );

/**
 * The base rows of this scope holding `identifier` in `visibility`, oldest
 * first, locked until `tx` ends: the caller judges and may delete them as
 * read, so a rewrite of one ({@link ConnectorModel.update}, a re-add) either
 * lands first, and is what gets judged, or waits for the caller.
 */
const findBaseHolders = async (
  tx: Transaction,
  scope: BaseIdentifierScope,
  identifier: string,
  visibility?: ConnectorVisibility,
): Promise<UserConnectorItem[]> =>
  tx
    .select()
    .from(userConnectors)
    .where(baseHolderFilter(scope, identifier, visibility))
    .orderBy(asc(userConnectors.createdAt))
    .for('update');

/**
 * The base rows of this scope holding `identifier` in `visibility`, oldest
 * first, read without the lock: rows written before it may duplicate the
 * identifier, so a caller judging the holder before (or after) a claim judges
 * every one of them.
 */
export const queryBaseHolders = async (
  db: LobeChatDatabase,
  scope: BaseIdentifierScope,
  identifier: string,
  visibility?: ConnectorVisibility,
): Promise<UserConnectorItem[]> =>
  db
    .select()
    .from(userConnectors)
    .where(baseHolderFilter(scope, identifier, visibility))
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
  row: { identifier: string; visibility?: ConnectorVisibility },
  canReplace?: (holder: UserConnectorItem) => boolean,
): Promise<UserConnectorItem | undefined> => {
  await lockBaseIdentifier(tx, scope, row.identifier);

  const holders = await findBaseHolders(tx, scope, row.identifier, row.visibility);
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
 * move are one step, under the lock {@link claimBaseIdentifier} takes. The
 * holder is looked for in the connector's own visibility, which the move keeps.
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

    const [moving] = await tx
      .select({ visibility: userConnectors.visibility })
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), scope.ownership()))
      .limit(1);
    const holders = await findBaseHolders(tx, scope, identifier, moving?.visibility);
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

/**
 * Change a base connector's visibility unless the destination slot (a base row
 * of `identifier` in `visibility`) is held: the lookup and the change are one
 * step, under the lock {@link claimBaseIdentifier} takes, so two members
 * sharing private connectors of one identifier at once never both land in the
 * shared slot.
 */
export const changeBaseVisibilityUnlessHeld = async (
  db: LobeChatDatabase,
  scope: BaseIdentifierScope,
  id: string,
  identifier: string,
  visibility: ConnectorVisibility,
): Promise<{ changed: true } | { holder: UserConnectorItem }> =>
  db.transaction(async (tx) => {
    await lockBaseIdentifier(tx, scope, identifier);

    const holder = (await findBaseHolders(tx, scope, identifier, visibility)).find(
      (row) => row.id !== id,
    );
    if (holder) return { holder };

    await tx
      .update(userConnectors)
      .set({ updatedAt: new Date(), visibility })
      .where(
        and(
          eq(userConnectors.id, id),
          eq(userConnectors.identifier, identifier),
          isNull(userConnectors.agentId),
          scope.ownership(),
        ),
      );
    return { changed: true as const };
  });
