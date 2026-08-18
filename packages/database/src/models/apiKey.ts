import { generateApiKey, isApiKeyExpired, validateApiKeyFormat } from '@lobechat/utils/apiKey';
import { hashApiKey } from '@lobechat/utils/server';
import { and, desc, eq, getTableColumns } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { ApiKeyItem, NewApiKeyItem } from '../schemas';
import { apiKeys, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class ApiKeyModel {
  static findByKey = async (db: LobeChatDatabase, key: string) => {
    if (!validateApiKeyFormat(key)) {
      return null;
    }
    const keyHash = hashApiKey(key);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    return row;
  };

  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private canManageAll: boolean;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    options?: { canManageAll?: boolean },
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.canManageAll = options?.canManageAll ?? true;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, apiKeys);

  /**
   * Restrict to the caller's own keys. `buildWorkspaceWhere` alone is
   * workspace-wide (the table has no visibility column), so a blanket
   * `deleteAll` would wipe every member's keys — pin `user_id` to the caller.
   */
  private mine = () => and(this.ownership(), eq(apiKeys.userId, this.userId));

  private manageable = () =>
    this.workspaceId && !this.canManageAll ? this.mine() : this.ownership();

  private async getGateKeeper() {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }

    return this.gateKeeperPromise;
  }

  private createRecord = async (
    params: Omit<NewApiKeyItem, 'userId' | 'id' | 'key' | 'keyHash'>,
  ) => {
    const key = generateApiKey();
    const keyHash = hashApiKey(key);
    const gateKeeper = await this.getGateKeeper();
    const encryptedKey = await gateKeeper.encrypt(key);

    const [result] = await this.db
      .insert(apiKeys)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params, key: encryptedKey, keyHash },
        ),
      )
      .returning();

    return { key, record: result };
  };

  create = async (params: Omit<NewApiKeyItem, 'userId' | 'id' | 'key' | 'keyHash'>) =>
    (await this.createRecord(params)).record;

  /**
   * Create a key and reveal its plaintext exactly once to a trusted transport.
   * List/detail methods continue to return only the stored encrypted record.
   */
  createWithPlaintext = async (
    params: Omit<NewApiKeyItem, 'userId' | 'id' | 'key' | 'keyHash'>,
  ) => {
    const { key, record } = await this.createRecord(params);
    return { ...record, key };
  };

  delete = async (id: string) => {
    return this.db.delete(apiKeys).where(and(eq(apiKeys.id, id), this.manageable()));
  };

  deleteAll = async () => {
    return this.db
      .delete(apiKeys)
      .where(this.mine())
      .returning({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes });
  };

  /**
   * List keys visible in the current scope. In workspace mode the caller sees
   * every key row (with its creator) only when `canManageAll` is enabled.
   * Members see only their own keys. The decrypted plaintext is returned only
   * for the caller's own keys in either mode.
   */
  query = async () => {
    const rows = await this.db
      .select({
        ...getTableColumns(apiKeys),
        creatorEmail: users.email,
        creatorFullName: users.fullName,
        creatorUsername: users.username,
      })
      .from(apiKeys)
      .leftJoin(users, eq(users.id, apiKeys.userId))
      .where(this.manageable())
      .orderBy(desc(apiKeys.updatedAt));

    const gateKeeper = await this.getGateKeeper();

    return Promise.all(
      rows.map(
        async ({ creatorEmail, creatorFullName, creatorUsername, keyHash: _, ...apiKey }) => {
          const isMine = apiKey.userId === this.userId;

          let key = '';
          let keyDecryptionFailed = false;
          if (isMine) {
            const decrypted = await gateKeeper.decrypt(apiKey.key);

            if (!decrypted.wasAuthentic) {
              keyDecryptionFailed = true;
              console.error('Failed to decrypt API key; returning the key as unavailable', {
                apiKeyId: apiKey.id,
              });
            } else {
              key = decrypted.plaintext;
            }
          }

          return {
            ...apiKey,
            creator: creatorFullName || creatorUsername || creatorEmail || null,
            isMine,
            key,
            keyDecryptionFailed,
          };
        },
      ),
    );
  };

  /** Metadata-only list for public API transports that must never reveal keys. */
  queryMetadata = async () => {
    return this.db.query.apiKeys.findMany({
      orderBy: desc(apiKeys.updatedAt),
      where: this.ownership(),
    });
  };

  findByKey = async (key: string) => {
    if (!validateApiKeyFormat(key)) return null;

    const keyHash = hashApiKey(key);
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), this.manageable()))
      .limit(1);
    return row;
  };

  validateKey = async (key: string) => {
    const apiKey = await this.findByKey(key);

    if (!apiKey) return false;
    if (!apiKey.enabled) return false;
    if (isApiKeyExpired(apiKey.expiresAt)) return false;

    return true;
  };

  update = async (id: string, value: Partial<ApiKeyItem>) => {
    return this.db
      .update(apiKeys)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(apiKeys.id, id), this.manageable()));
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), this.manageable()))
      .limit(1);
    return row;
  };

  updateLastUsed = async (id: string) => {
    return this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.id, id), this.mine()));
  };
}
