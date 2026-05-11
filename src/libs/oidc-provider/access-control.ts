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
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

export const OIDC_USER_INACTIVE_ERROR_MESSAGE = 'OIDC user is no longer active';

export const isOIDCUserInactiveError = (error: unknown) =>
  error instanceof TRPCError &&
  error.code === 'UNAUTHORIZED' &&
  error.message === OIDC_USER_INACTIVE_ERROR_MESSAGE;

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
    .select({ banned: users.banned, id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.banned) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: OIDC_USER_INACTIVE_ERROR_MESSAGE,
    });
  }
};
