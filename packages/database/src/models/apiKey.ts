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

    return db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash),
    });
  };

  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, apiKeys);

  /**
   * Restrict to the caller's own keys. `buildWorkspaceWhere` alone is
   * workspace-wide (the table has no visibility column), so a blanket
   * `deleteAll` would wipe every member's keys — pin `user_id` to the caller.
   */
  private mine = () => and(this.ownership(), eq(apiKeys.userId, this.userId));

  private async getGateKeeper() {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }

    return this.gateKeeperPromise;
  }

  create = async (params: Omit<NewApiKeyItem, 'userId' | 'id' | 'key' | 'keyHash'>) => {
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

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(apiKeys).where(and(eq(apiKeys.id, id), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(apiKeys).where(this.mine());
  };

  /**
   * List keys visible in the current scope. In workspace mode every member sees
   * every key row (with its creator) so owners can govern them, but the
   * decrypted plaintext is returned ONLY for the caller's own keys — other
   * members' (and owners') rows come back with an empty `key`. Managing
   * (rename/toggle/delete) is still gated to the creator or an owner at the
   * router via `assertWorkspaceRowManageable`.
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
      .where(this.ownership())
      .orderBy(desc(apiKeys.updatedAt));

    const gateKeeper = await this.getGateKeeper();

    return Promise.all(
      rows.map(async ({ creatorEmail, creatorFullName, creatorUsername, ...apiKey }) => {
        const isMine = apiKey.userId === this.userId;

        let key = '';
        if (isMine) {
          const decrypted = await gateKeeper.decrypt(apiKey.key);

          if (!decrypted.wasAuthentic) {
            throw new Error(
              'Failed to decrypt API key. Please check whether KEY_VAULTS_SECRET is correct.',
            );
          }

          key = decrypted.plaintext;
        }

        return {
          ...apiKey,
          creator: creatorFullName || creatorUsername || creatorEmail || null,
          isMine,
          key,
        };
      }),
    );
  };

  findByKey = async (key: string) => {
    return ApiKeyModel.findByKey(this.db, key);
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
      .where(and(eq(apiKeys.id, id), this.ownership()));
  };

  findById = async (id: string) => {
    return this.db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), this.ownership()),
    });
  };

  updateLastUsed = async (id: string) => {
    return this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.id, id), this.ownership()));
  };
}
