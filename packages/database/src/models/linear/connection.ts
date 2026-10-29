import type {
  LinearConnectionCredentials,
  LinearConnectionMetadata,
  LinearConnectionView,
} from '@lobechat/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { LinearConnectionItem } from '../../schemas';
import { linearConnections } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface LinearConnectionScope {
  userId: string;
  workspaceId?: string | null;
}

export interface LinearUpsertConnectionParams extends LinearConnectionScope {
  actorExternalId: string;
  actorName: string;
  credentials: LinearConnectionCredentials;
  metadata?: LinearConnectionMetadata;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
  tokenExpiresAt?: Date | null;
}

export type LinearDecryptedConnection = Omit<LinearConnectionItem, 'credentials'> & {
  credentials: LinearConnectionCredentials | null;
};

/**
 * CRUD for `linear_connections`. Callers are server-side (the OAuth callback
 * and the settings router), so like the SCM models it exposes
 * static methods taking the db; the row's scope is who the connection
 * belongs to, not the caller's identity.
 */
export class LinearConnectionModel {
  static findById = async (
    db: LobeChatDatabase,
    id: string,
  ): Promise<LinearConnectionItem | null> => {
    const [row] = await db.select().from(linearConnections).where(eq(linearConnections.id, id));
    return row ?? null;
  };

  /** The row with its token decrypted, for the server code that calls Linear. */
  static findDecryptedById = async (
    db: LobeChatDatabase,
    id: string,
    gateKeeper?: GateKeeper,
  ): Promise<LinearDecryptedConnection | null> => {
    const row = await LinearConnectionModel.findById(db, id);
    return row ? decryptRow(row, gateKeeper) : null;
  };

  /** Active connections visible to a scope: the workspace's, or the user's personal ones. */
  static listByScope = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
  ): Promise<LinearConnectionItem[]> =>
    db
      .select()
      .from(linearConnections)
      .where(and(scopeCondition(scope), isNull(linearConnections.revokedAt)))
      .orderBy(desc(linearConnections.createdAt));

  /**
   * Store a fresh authorization. Re-authorizing an organization from the
   * same scope refreshes that row in place and clears an earlier disconnect.
   */
  static upsert = async (
    db: LobeChatDatabase,
    params: LinearUpsertConnectionParams,
    gateKeeper?: GateKeeper,
  ): Promise<LinearConnectionItem> => {
    const workspaceId = params.workspaceId ?? null;
    const values = {
      actorExternalId: params.actorExternalId,
      actorName: params.actorName,
      credentials: await encryptCredentials(params.credentials, gateKeeper),
      metadata: params.metadata ?? {},
      organizationId: params.organizationId,
      organizationName: params.organizationName,
      organizationUrlKey: params.organizationUrlKey,
      revokedAt: null,
      tokenExpiresAt: params.tokenExpiresAt ?? null,
      userId: params.userId,
      workspaceId,
    };

    const [existing] = await db
      .select({ id: linearConnections.id })
      .from(linearConnections)
      .where(
        and(
          eq(linearConnections.organizationId, params.organizationId),
          eq(linearConnections.userId, params.userId),
          workspaceId
            ? eq(linearConnections.workspaceId, workspaceId)
            : isNull(linearConnections.workspaceId),
        ),
      )
      .limit(1);

    if (existing) {
      const [row] = await db
        .update(linearConnections)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(linearConnections.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await db.insert(linearConnections).values(values).returning();
    return row;
  };

  /** Replace the token after a refresh. A revoked row keeps its revocation. */
  static updateCredentials = async (
    db: LobeChatDatabase,
    id: string,
    params: { credentials: LinearConnectionCredentials; tokenExpiresAt?: Date | null },
    gateKeeper?: GateKeeper,
  ): Promise<void> => {
    await db
      .update(linearConnections)
      .set({
        credentials: await encryptCredentials(params.credentials, gateKeeper),
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(linearConnections.id, id), isNull(linearConnections.revokedAt)));
  };

  /** Disconnect: drop the token and hide the row. A reconnect reuses it. */
  static revoke = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(linearConnections)
      .set({
        credentials: null,
        revokedAt: new Date(),
        tokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(linearConnections.id, id));
  };

  /** What the client may see: everything but the token. */
  static toView = (row: LinearConnectionItem): LinearConnectionView => ({
    actorExternalId: row.actorExternalId,
    actorName: row.actorName,
    createdAt: row.createdAt,
    id: row.id,
    metadata: row.metadata,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    organizationUrlKey: row.organizationUrlKey,
    userId: row.userId,
    workspaceId: row.workspaceId,
  });
}

const scopeCondition = (scope: LinearConnectionScope) =>
  scope.workspaceId
    ? eq(linearConnections.workspaceId, scope.workspaceId)
    : and(eq(linearConnections.userId, scope.userId), isNull(linearConnections.workspaceId));

const encryptCredentials = async (
  credentials: LinearConnectionCredentials,
  gateKeeper?: GateKeeper,
): Promise<string> => {
  const plaintext = JSON.stringify(credentials);
  return gateKeeper ? gateKeeper.encrypt(plaintext) : plaintext;
};

const decryptRow = async (
  row: LinearConnectionItem,
  gateKeeper?: GateKeeper,
): Promise<LinearDecryptedConnection> => {
  if (!row.credentials) return { ...row, credentials: null };

  const plaintext = gateKeeper
    ? (await gateKeeper.decrypt(row.credentials)).plaintext
    : row.credentials;

  try {
    return { ...row, credentials: JSON.parse(plaintext) as LinearConnectionCredentials };
  } catch {
    return { ...row, credentials: null };
  }
};
