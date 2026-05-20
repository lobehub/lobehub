import { and, eq, gt, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';

import type { MessengerInstallationItem, NewMessengerInstallation } from '../schemas';
import { messengerInstallations } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedMessengerInstallation extends Omit<
  MessengerInstallationItem,
  'credentials'
> {
  /** Decrypted credentials JSON. Shape varies per platform — narrow in the store layer. */
  credentials: Record<string, unknown>;
}

interface UpsertParams {
  accountId?: string | null;
  applicationId: string;
  /** Plaintext credentials JSON; the model encrypts before writing. */
  credentials: Record<string, unknown>;
  installedByPlatformUserId?: string | null;
  installedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  platform: string;
  tenantId: string;
  tokenExpiresAt?: Date | null;
}

interface RotatedTokenParams {
  /** New plaintext credentials JSON; the model encrypts before writing. */
  credentials: Record<string, unknown>;
  tokenExpiresAt?: Date | null;
}

/**
 * CRUD for `messenger_installations`. All callers are server-side (router /
 * OAuth callback / rotation job), so the model exposes static methods rather
 * than a per-user-scoped instance — there is no "user-owned install" notion;
 * `installed_by_user_id` is just provenance.
 */
export class MessengerInstallationModel {
  // --------------- Lookup ---------------

  static findByTenant = async (
    db: LobeChatDatabase,
    platform: string,
    tenantId: string,
    applicationId?: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedMessengerInstallation | null> => {
    const conditions: SQL[] = [
      eq(messengerInstallations.platform, platform),
      eq(messengerInstallations.tenantId, tenantId),
      isNull(messengerInstallations.revokedAt),
    ];
    if (applicationId) {
      conditions.push(eq(messengerInstallations.applicationId, applicationId));
    }

    const [result] = await db
      .select()
      .from(messengerInstallations)
      .where(and(...conditions))
      .limit(1);

    if (!result) return null;
    return decryptRow(result, gateKeeper);
  };

  static findById = async (
    db: LobeChatDatabase,
    id: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedMessengerInstallation | null> => {
    const [result] = await db
      .select()
      .from(messengerInstallations)
      .where(eq(messengerInstallations.id, id))
      .limit(1);

    if (!result) return null;
    return decryptRow(result, gateKeeper);
  };

  static listByInstallerUserId = async (
    db: LobeChatDatabase,
    userId: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedMessengerInstallation[]> => {
    const rows = await db
      .select()
      .from(messengerInstallations)
      .where(
        and(
          eq(messengerInstallations.installedByUserId, userId),
          isNull(messengerInstallations.revokedAt),
        ),
      );
    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  // --------------- Mutation ---------------

  /**
   * Insert or update by `(platform, application_id, tenant_id)`. Re-installing
   * the same workspace overwrites credentials / metadata / expiry but keeps
   * the row id (and `created_at`).
   */
  static upsert = async (
    db: LobeChatDatabase,
    params: UpsertParams,
    gateKeeper?: GateKeeper,
  ): Promise<MessengerInstallationItem> => {
    const credentialsCipher = await encryptCredentials(params.credentials, gateKeeper);

    const insertValue: NewMessengerInstallation = {
      accountId: params.accountId ?? null,
      applicationId: params.applicationId,
      credentials: credentialsCipher,
      installedByPlatformUserId: params.installedByPlatformUserId ?? null,
      installedByUserId: params.installedByUserId ?? null,
      metadata: params.metadata ?? {},
      platform: params.platform,
      revokedAt: null,
      tenantId: params.tenantId,
      tokenExpiresAt: params.tokenExpiresAt ?? null,
    };

    const [result] = await db
      .insert(messengerInstallations)
      .values(insertValue)
      .onConflictDoUpdate({
        set: {
          accountId: insertValue.accountId,
          credentials: insertValue.credentials,
          installedByPlatformUserId: insertValue.installedByPlatformUserId,
          installedByUserId: insertValue.installedByUserId,
          metadata: insertValue.metadata,
          // Re-install clears any previous revoke
          revokedAt: null,
          tokenExpiresAt: insertValue.tokenExpiresAt,
          updatedAt: new Date(),
        },
        target: [
          messengerInstallations.platform,
          messengerInstallations.applicationId,
          messengerInstallations.tenantId,
        ],
      })
      .returning();
    return result;
  };

  static markRevoked = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(messengerInstallations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(messengerInstallations.id, id));
  };

  /**
   * Atomic write of a freshly-rotated bot token. Caller already has the new
   * plaintext credentials JSON and the new expiry; this just writes both in
   * one round-trip so a rotation never leaves the row in a torn state.
   */
  static updateRotatedToken = async (
    db: LobeChatDatabase,
    id: string,
    params: RotatedTokenParams,
    gateKeeper?: GateKeeper,
  ): Promise<MessengerInstallationItem | undefined> => {
    const credentialsCipher = await encryptCredentials(params.credentials, gateKeeper);

    const [updated] = await db
      .update(messengerInstallations)
      .set({
        credentials: credentialsCipher,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(messengerInstallations.id, id))
      .returning();
    return updated;
  };

  /**
   * Returns active installs whose token expires within `withinMs` from now.
   * Used by the rotation background job to refresh proactively.
   */
  static listExpiringSoon = async (
    db: LobeChatDatabase,
    withinMs: number,
  ): Promise<MessengerInstallationItem[]> => {
    const cutoff = new Date(Date.now() + withinMs);
    return db
      .select()
      .from(messengerInstallations)
      .where(
        and(
          isNotNull(messengerInstallations.tokenExpiresAt),
          isNull(messengerInstallations.revokedAt),
          lte(messengerInstallations.tokenExpiresAt, cutoff),
          // Skip rows that already expired long ago — nothing to refresh.
          gt(messengerInstallations.tokenExpiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      );
  };
}

// --------------- Private helpers ---------------

async function encryptCredentials(
  credentials: Record<string, unknown>,
  gateKeeper?: GateKeeper,
): Promise<string> {
  const json = JSON.stringify(credentials);
  if (!gateKeeper) return json;
  return gateKeeper.encrypt(json);
}

async function decryptRow(
  row: MessengerInstallationItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedMessengerInstallation> {
  if (!row.credentials) return { ...row, credentials: {} };

  try {
    const credentials = gateKeeper
      ? JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext)
      : JSON.parse(row.credentials);
    return { ...row, credentials };
  } catch {
    return { ...row, credentials: {} };
  }
}
