import { eq } from 'drizzle-orm';

import type { NewSystemBotProvider, SystemBotProviderItem } from '../schemas';
import { systemBotProviders } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedSystemBotProvider extends Omit<SystemBotProviderItem, 'credentials'> {
  /** Decrypted credentials JSON. Shape varies per platform — narrow at the call site. */
  credentials: Record<string, unknown>;
}

interface UpsertParams {
  applicationId?: string | null;
  connectionMode?: string | null;
  /** Plaintext credentials JSON; the model encrypts before writing. */
  credentials: Record<string, unknown>;
  enabled?: boolean;
  platform: string;
  settings?: Record<string, unknown>;
}

interface UpdateParams {
  applicationId?: string | null;
  connectionMode?: string | null;
  /** Plaintext credentials JSON. Pass `undefined` to leave existing ciphertext untouched. */
  credentials?: Record<string, unknown>;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Static-method-style model for `system_bot_providers`.
 *
 * The table is system-wide (no per-user scoping), so unlike
 * `AgentBotProviderModel` there's no instance state — every method takes the
 * `db` connection and an optional `gateKeeper` for credential encryption.
 *
 * Mirrors `MessengerInstallationModel`'s shape (also system-level): static
 * methods, optional gateKeeper for tests, decryption errors swallowed to
 * `credentials = {}` so a corrupt row doesn't crash the whole router.
 */
export class SystemBotProviderModel {
  // --------------- Lookup ---------------

  static findEnabledByPlatform = async (
    db: LobeChatDatabase,
    platform: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedSystemBotProvider | null> => {
    const [result] = await db
      .select()
      .from(systemBotProviders)
      .where(eq(systemBotProviders.platform, platform))
      .limit(1);

    if (!result) return null;
    if (!result.enabled) return null;
    return decryptRow(result, gateKeeper);
  };

  static findByPlatform = async (
    db: LobeChatDatabase,
    platform: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedSystemBotProvider | null> => {
    const [result] = await db
      .select()
      .from(systemBotProviders)
      .where(eq(systemBotProviders.platform, platform))
      .limit(1);

    if (!result) return null;
    return decryptRow(result, gateKeeper);
  };

  static findById = async (
    db: LobeChatDatabase,
    id: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedSystemBotProvider | null> => {
    const [result] = await db
      .select()
      .from(systemBotProviders)
      .where(eq(systemBotProviders.id, id))
      .limit(1);

    if (!result) return null;
    return decryptRow(result, gateKeeper);
  };

  static listAll = async (
    db: LobeChatDatabase,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedSystemBotProvider[]> => {
    const rows = await db.select().from(systemBotProviders);
    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  // --------------- Mutation ---------------

  /**
   * Insert or update by `platform`. A row already exists for the platform →
   * its credentials / metadata / flags get overwritten; otherwise insert.
   * The unique index on `(platform)` makes this safe under concurrency.
   */
  static upsertByPlatform = async (
    db: LobeChatDatabase,
    params: UpsertParams,
    gateKeeper?: GateKeeper,
  ): Promise<SystemBotProviderItem> => {
    const credentialsCipher = await encryptCredentials(params.credentials, gateKeeper);

    const insertValue: NewSystemBotProvider = {
      applicationId: params.applicationId ?? null,
      connectionMode: params.connectionMode ?? null,
      credentials: credentialsCipher,
      enabled: params.enabled ?? true,
      platform: params.platform,
      settings: params.settings ?? {},
    };

    const [result] = await db
      .insert(systemBotProviders)
      .values(insertValue)
      .onConflictDoUpdate({
        set: {
          applicationId: insertValue.applicationId,
          connectionMode: insertValue.connectionMode,
          credentials: insertValue.credentials,
          enabled: insertValue.enabled,
          settings: insertValue.settings,
          updatedAt: new Date(),
        },
        target: systemBotProviders.platform,
      })
      .returning();
    return result;
  };

  /**
   * Partial update by id. Pass only the fields to change. `credentials` is
   * re-encrypted; omit it to leave the existing ciphertext alone.
   */
  static update = async (
    db: LobeChatDatabase,
    id: string,
    params: UpdateParams,
    gateKeeper?: GateKeeper,
  ): Promise<SystemBotProviderItem | undefined> => {
    const updateValue: Partial<SystemBotProviderItem> = {
      updatedAt: new Date(),
    };
    if (params.enabled !== undefined) updateValue.enabled = params.enabled;
    if (params.applicationId !== undefined) updateValue.applicationId = params.applicationId;
    if (params.settings !== undefined) updateValue.settings = params.settings;
    if (params.connectionMode !== undefined) updateValue.connectionMode = params.connectionMode;
    if (params.credentials !== undefined) {
      updateValue.credentials = await encryptCredentials(params.credentials, gateKeeper);
    }

    const [updated] = await db
      .update(systemBotProviders)
      .set(updateValue)
      .where(eq(systemBotProviders.id, id))
      .returning();
    return updated;
  };

  static setEnabled = async (
    db: LobeChatDatabase,
    id: string,
    enabled: boolean,
  ): Promise<SystemBotProviderItem | undefined> => {
    const [updated] = await db
      .update(systemBotProviders)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(systemBotProviders.id, id))
      .returning();
    return updated;
  };

  static delete = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db.delete(systemBotProviders).where(eq(systemBotProviders.id, id));
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
  row: SystemBotProviderItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedSystemBotProvider> {
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
