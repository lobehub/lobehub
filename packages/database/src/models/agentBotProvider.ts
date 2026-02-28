import { and, desc, eq } from 'drizzle-orm';

import type { AgentBotProviderItem, NewAgentBotProvider } from '../schemas';
import { agentBotProviders } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedBotProvider extends Omit<AgentBotProviderItem, 'credentials'> {
  credentials: Record<string, string>;
}

export class AgentBotProviderModel {
  private userId: string;
  private db: LobeChatDatabase;
  private gateKeeper?: GateKeeper;

  constructor(db: LobeChatDatabase, userId: string, gateKeeper?: GateKeeper) {
    this.userId = userId;
    this.db = db;
    this.gateKeeper = gateKeeper;
  }

  // --------------- User-scoped CRUD ---------------

  create = async (
    params: Omit<NewAgentBotProvider, 'credentials' | 'userId'> & {
      credentials: Record<string, string>;
    },
  ) => {
    const credentials = await this.encrypt(params.credentials);

    const [result] = await this.db
      .insert(agentBotProviders)
      .values({ ...params, credentials, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(agentBotProviders)
      .where(and(eq(agentBotProviders.id, id), eq(agentBotProviders.userId, this.userId)));
  };

  query = async (params?: { agentId?: string; platform?: string }) => {
    const conditions = [eq(agentBotProviders.userId, this.userId)];

    if (params?.agentId) {
      conditions.push(eq(agentBotProviders.agentId, params.agentId));
    }
    if (params?.platform) {
      conditions.push(eq(agentBotProviders.platform, params.platform));
    }

    const results = await this.db
      .select()
      .from(agentBotProviders)
      .where(and(...conditions))
      .orderBy(desc(agentBotProviders.updatedAt));

    return Promise.all(results.map((r) => this.decryptRow(r)));
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentBotProviders)
      .where(and(eq(agentBotProviders.id, id), eq(agentBotProviders.userId, this.userId)))
      .limit(1);

    if (!result) return result;

    return this.decryptRow(result);
  };

  findByAgentId = async (agentId: string) => {
    const results = await this.db
      .select()
      .from(agentBotProviders)
      .where(and(eq(agentBotProviders.agentId, agentId), eq(agentBotProviders.userId, this.userId)))
      .orderBy(desc(agentBotProviders.updatedAt));

    return Promise.all(results.map((r) => this.decryptRow(r)));
  };

  update = async (
    id: string,
    value: Partial<Omit<AgentBotProviderItem, 'credentials'>> & {
      credentials?: Record<string, string>;
    },
  ) => {
    const { credentials, ...rest } = value;
    const updateValue: Partial<AgentBotProviderItem> = { ...rest };

    if (credentials) {
      updateValue.credentials = await this.encrypt(credentials);
    }

    return this.db
      .update(agentBotProviders)
      .set({ ...updateValue, updatedAt: new Date() })
      .where(and(eq(agentBotProviders.id, id), eq(agentBotProviders.userId, this.userId)));
  };

  // --------------- System-wide static methods ---------------

  static findByPlatformAndAppId = async (
    db: LobeChatDatabase,
    platform: string,
    applicationId: string,
  ) => {
    const [result] = await db
      .select()
      .from(agentBotProviders)
      .where(
        and(
          eq(agentBotProviders.platform, platform),
          eq(agentBotProviders.applicationId, applicationId),
        ),
      )
      .limit(1);

    return result;
  };

  findEnabledByApplicationId = async (
    platform: string,
    applicationId: string,
  ): Promise<DecryptedBotProvider | null> => {
    const [result] = await this.db
      .select()
      .from(agentBotProviders)
      .where(
        and(
          eq(agentBotProviders.platform, platform),
          eq(agentBotProviders.applicationId, applicationId),
          eq(agentBotProviders.userId, this.userId),
          eq(agentBotProviders.enabled, true),
        ),
      )
      .limit(1);

    if (!result) return null;

    return this.decryptRow(result);
  };

  // --------------- System-wide static methods ---------------

  static findEnabledByPlatform = async (
    db: LobeChatDatabase,
    platform: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedBotProvider[]> => {
    const results = await db
      .select()
      .from(agentBotProviders)
      .where(and(eq(agentBotProviders.platform, platform), eq(agentBotProviders.enabled, true)));

    const decrypted: DecryptedBotProvider[] = [];

    for (const r of results) {
      if (!r.credentials) continue;

      try {
        const credentials = gateKeeper
          ? JSON.parse((await gateKeeper.decrypt(r.credentials)).plaintext)
          : JSON.parse(r.credentials);

        if (!credentials.botToken || !credentials.publicKey) continue;

        decrypted.push({ ...r, credentials });
      } catch {
        // skip rows with invalid / undecryptable credentials
      }
    }

    return decrypted;
  };

  // --------------- Private helpers ---------------

  private encrypt = async (credentials: Record<string, string>): Promise<string> => {
    const json = JSON.stringify(credentials);
    if (!this.gateKeeper) return json;
    return this.gateKeeper.encrypt(json);
  };

  private decryptRow = async (row: AgentBotProviderItem): Promise<DecryptedBotProvider> => {
    if (!row.credentials) return { ...row, credentials: {} };

    try {
      const credentials = this.gateKeeper
        ? JSON.parse((await this.gateKeeper.decrypt(row.credentials)).plaintext)
        : JSON.parse(row.credentials);

      return { ...row, credentials };
    } catch {
      return { ...row, credentials: {} };
    }
  };
}
