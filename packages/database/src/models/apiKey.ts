import { generateApiKey, isApiKeyExpired, validateApiKeyFormat } from '@lobechat/utils/apiKey';
import { hashApiKey } from '@lobechat/utils/server';
import { and, desc, eq } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { ApiKeyItem, NewApiKeyItem } from '../schemas';
import { apiKeys } from '../schemas';
import type { LobeChatDatabase } from '../type';

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
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

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
      .values({ ...params, key: encryptedKey, keyHash, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(apiKeys).where(eq(apiKeys.userId, this.userId));
  };

  query = async () => {
    const results = await this.db.query.apiKeys.findMany({
      orderBy: [desc(apiKeys.updatedAt)],
      where: eq(apiKeys.userId, this.userId),
    });

    const gateKeeper = await this.getGateKeeper();

    return Promise.all(
      results.map(async (apiKey) => {
        const decrypted = await gateKeeper.decrypt(apiKey.key);

        if (!decrypted.wasAuthentic) {
          throw new Error(
            'Failed to decrypt API key. Please check whether KEY_VAULTS_SECRET is correct.',
          );
        }

        return {
          ...apiKey,
          key: decrypted.plaintext,
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
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)));
  };

  findById = async (id: string) => {
    return this.db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)),
    });
  };

  updateLastUsed = async (id: string) => {
    return this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)));
  };
}
