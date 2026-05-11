import type { LobeChatDatabase } from '@lobechat/database';
import {
  oidcAccessTokens,
  oidcAuthorizationCodes,
  oidcDeviceCodes,
  oidcGrants,
  oidcRefreshTokens,
  oidcSessions,
  users,
} from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';

export const OIDC_USER_INACTIVE_ERROR_MESSAGE = 'OIDC user is no longer active';

export class OIDCUserInactiveError extends Error {
  readonly code = 'UNAUTHORIZED';

  constructor() {
    super(OIDC_USER_INACTIVE_ERROR_MESSAGE);
    this.name = 'OIDCUserInactiveError';
  }
}

export const isOIDCUserInactiveError = (error: unknown) => error instanceof OIDCUserInactiveError;

interface OIDCUserBanState {
  banExpires: Date | null;
  banned: boolean | null;
}

export const isOIDCUserBanned = (user: OIDCUserBanState, now = new Date()) => {
  if (!user.banned) return false;

  return !user.banExpires || user.banExpires > now;
};

const OIDC_USER_ARTIFACT_TABLES = [
  oidcAccessTokens,
  oidcAuthorizationCodes,
  oidcRefreshTokens,
  oidcDeviceCodes,
  oidcGrants,
  oidcSessions,
] as const;

type OIDCUserArtifactTable = (typeof OIDC_USER_ARTIFACT_TABLES)[number];

/**
 * Revokes database-backed OIDC artifacts for a user.
 *
 * JWT access tokens are stateless and remain valid until runtime user-status
 * checks reject them, but deleting these rows prevents refresh/session flows
 * from minting replacement tokens after the account is disabled.
 */
export const revokeOIDCArtifactsByUserId = async (db: LobeChatDatabase, userId: string) => {
  await db.transaction(async (tx) => {
    const deleteByUserId = async (table: OIDCUserArtifactTable) =>
      tx.delete(table).where(eq(table.userId, userId));

    await Promise.all(OIDC_USER_ARTIFACT_TABLES.map(deleteByUserId));
  });
};

/**
 * Rejects stateless OIDC access tokens once their subject is no longer active.
 */
export const assertOIDCUserActive = async (db: LobeChatDatabase, userId: string) => {
  const [user] = await db
    .select({ banExpires: users.banExpires, banned: users.banned, id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || isOIDCUserBanned(user)) {
    throw new OIDCUserInactiveError();
  }
};
