import type { ScmIdentityMetadata, ScmProvider } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { ScmIdentityItem } from '../../schemas';
import { scmIdentities } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

/** Plaintext shape stored (encrypted) in `scm_identities.credentials`. */
export interface ScmIdentityCredentials {
  accessToken: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}

export interface UpsertScmIdentityParams {
  /** Plaintext credentials; encrypted before writing. Omit to keep the stored ones. */
  credentials?: ScmIdentityCredentials | null;
  externalLogin: string;
  externalUserId: string;
  metadata?: ScmIdentityMetadata;
  provider: ScmProvider;
  tokenExpiresAt?: Date | null;
  userId: string;
}

export interface DecryptedScmIdentity extends Omit<ScmIdentityItem, 'credentials'> {
  credentials: ScmIdentityCredentials | null;
}

/**
 * CRUD for `scm_identities`: which provider account a LobeHub user is. The
 * identity is written by the install callback and read when a provider actor
 * (merger, reviewer) needs to resolve to a LobeHub user.
 */
export class ScmIdentityModel {
  static findByExternalUser = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    externalUserId: string,
  ): Promise<ScmIdentityItem | null> => {
    const [row] = await db
      .select()
      .from(scmIdentities)
      .where(
        and(eq(scmIdentities.provider, provider), eq(scmIdentities.externalUserId, externalUserId)),
      )
      .limit(1);

    return row ?? null;
  };

  static findByUser = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    userId: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedScmIdentity | null> => {
    const [row] = await db
      .select()
      .from(scmIdentities)
      .where(and(eq(scmIdentities.provider, provider), eq(scmIdentities.userId, userId)))
      .limit(1);

    if (!row) return null;
    return decryptRow(row, gateKeeper);
  };

  /**
   * Bind a provider account to a LobeHub user. The provider account is the
   * identity: re-authorizing from the same account updates the row in place
   * (fresh token, possibly a new login after a rename). A provider account
   * already bound to a *different* LobeHub user is a conflict the caller
   * must surface, so the unique index is left to throw.
   */
  static upsert = async (
    db: LobeChatDatabase,
    params: UpsertScmIdentityParams,
    gateKeeper?: GateKeeper,
  ): Promise<ScmIdentityItem> => {
    const encrypted =
      params.credentials === undefined
        ? undefined
        : params.credentials === null
          ? null
          : await encryptCredentials(params.credentials, gateKeeper);

    const values = {
      externalLogin: params.externalLogin,
      externalUserId: params.externalUserId,
      metadata: params.metadata ?? {},
      provider: params.provider,
      tokenExpiresAt: params.tokenExpiresAt ?? null,
      userId: params.userId,
      ...(encrypted === undefined ? {} : { credentials: encrypted }),
    };

    const [row] = await db
      .insert(scmIdentities)
      .values(values)
      .onConflictDoUpdate({
        set: { ...values, updatedAt: new Date() },
        target: [scmIdentities.provider, scmIdentities.externalUserId],
      })
      .returning();

    return row;
  };
}

const encryptCredentials = async (
  credentials: ScmIdentityCredentials,
  gateKeeper?: GateKeeper,
): Promise<string> => {
  const plaintext = JSON.stringify(credentials);
  return gateKeeper ? gateKeeper.encrypt(plaintext) : plaintext;
};

const decryptRow = async (
  row: ScmIdentityItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedScmIdentity> => {
  if (!row.credentials) return { ...row, credentials: null };

  const plaintext = gateKeeper
    ? (await gateKeeper.decrypt(row.credentials)).plaintext
    : row.credentials;

  try {
    return { ...row, credentials: JSON.parse(plaintext) as ScmIdentityCredentials };
  } catch {
    return { ...row, credentials: null };
  }
};
