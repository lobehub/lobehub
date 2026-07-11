import { and, desc, eq, inArray } from 'drizzle-orm';

import type { AgentBotProviderItem, NewAgentBotProvider } from '../schemas';
import { agentBotProviders } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export interface DecryptedBotProvider extends Omit<AgentBotProviderItem, 'credentials'> {
  credentials: Record<string, string>;
}

export class AgentBotProviderModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private gateKeeper?: GateKeeper;

  constructor(db: LobeChatDatabase, userId: string, gateKeeper?: GateKeeper, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.gateKeeper = gateKeeper;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentBotProviders);

  // --------------- User-scoped CRUD ---------------

  create = async (
    params: Omit<NewAgentBotProvider, 'credentials' | 'userId'> & {
      credentials: Record<string, string>;
    },
  ) => {
    const credentials = await this.encrypt(params.credentials);

    const [result] = await this.db
      .insert(agentBotProviders)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params, credentials },
        ),
      )
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db
      .delete(agentBotProviders)
      .where(and(eq(agentBotProviders.id, id), this.ownership()));
  };

  query = async (params?: { agentId?: string; platform?: string }) => {
    const conditions = [this.ownership()];

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
      .where(and(eq(agentBotProviders.id, id), this.ownership()))
      .limit(1);

    if (!result) return result;

    return this.decryptRow(result);
  };

  findByAgentId = async (agentId: string) => {
    const results = await this.db
      .select()
      .from(agentBotProviders)
      .where(and(eq(agentBotProviders.agentId, agentId), this.ownership()))
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
      .where(and(eq(agentBotProviders.id, id), this.ownership()));
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
          this.ownership(),
          eq(agentBotProviders.enabled, true),
        ),
      )
      .limit(1);

    if (!result) return null;

    return this.decryptRow(result);
  };

  // --------------- System-wide static methods ---------------

  /**
   * System-wide lookup of an enabled provider by platform + applicationId.
   *
   * `(platform, applicationId)` is globally unique, so this returns the single
   * matching row regardless of which user / workspace owns it. Use only from
   * post-authorization runtime layers (gateway service / manager / connect-queue
   * cron) where the caller has already been authorized at the router boundary —
   * never as an authorization check itself.
   */
  static findEnabledByPlatformAndAppId = async (
    db: LobeChatDatabase,
    platform: string,
    applicationId: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedBotProvider | null> => {
    const [result] = await db
      .select()
      .from(agentBotProviders)
      .where(
        and(
          eq(agentBotProviders.platform, platform),
          eq(agentBotProviders.applicationId, applicationId),
          eq(agentBotProviders.enabled, true),
        ),
      )
      .limit(1);

    if (!result) return null;

    if (!result.credentials) return { ...result, credentials: {} };

    try {
      const credentials = gateKeeper
        ? JSON.parse((await gateKeeper.decrypt(result.credentials)).plaintext)
        : JSON.parse(result.credentials);

      return { ...result, credentials };
    } catch {
      return { ...result, credentials: {} };
    }
  };

  /**
   * System-wide lookup of all providers under an agent.
   *
   * An agent belongs to a single owner / workspace, so this returns every row
   * for the agent regardless of scope. Same authorization caveat as
   * {@link findEnabledByPlatformAndAppId}: runtime-layer use only.
   */
  static findByAgentId = async (
    db: LobeChatDatabase,
    agentId: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedBotProvider[]> => {
    const results = await db
      .select()
      .from(agentBotProviders)
      .where(eq(agentBotProviders.agentId, agentId))
      .orderBy(desc(agentBotProviders.updatedAt));

    const decrypted: DecryptedBotProvider[] = [];

    for (const r of results) {
      if (!r.credentials) {
        decrypted.push({ ...r, credentials: {} });
        continue;
      }

      try {
        const credentials = gateKeeper
          ? JSON.parse((await gateKeeper.decrypt(r.credentials)).plaintext)
          : JSON.parse(r.credentials);

        decrypted.push({ ...r, credentials });
      } catch {
        decrypted.push({ ...r, credentials: {} });
      }
    }

    return decrypted;
  };

  /**
   * Look up providers by connection id across all users, without decrypting
   * credentials. Used by the gateway reconciliation sync to map stale gateway
   * connections back to their (possibly disabled) provider rows.
   *
   * Non-UUID ids are filtered out before querying: the gateway also tracks
   * connection ids that are not provider rows (e.g. system-bot registrations),
   * and a single non-UUID value in `inArray` on the uuid column fails the
   * whole query with a Postgres cast error.
   */
  static findByIds = async (
    db: LobeChatDatabase,
    ids: string[],
  ): Promise<
    Array<Pick<AgentBotProviderItem, 'applicationId' | 'enabled' | 'id' | 'platform' | 'settings'>>
  > => {
    const uuidIds = ids.filter((id) => UUID_RE.test(id));
    if (uuidIds.length === 0) return [];

    return db
      .select({
        applicationId: agentBotProviders.applicationId,
        enabled: agentBotProviders.enabled,
        id: agentBotProviders.id,
        platform: agentBotProviders.platform,
        settings: agentBotProviders.settings,
      })
      .from(agentBotProviders)
      .where(inArray(agentBotProviders.id, uuidIds));
  };

  static findEnabledByPlatform = async (
    db: LobeChatDatabase,
    platform: string,
    gateKeeper?: GateKeeper,
    options?: {
      /**
       * Keep rows whose credentials are missing or fail to decrypt, with
       * `credentials: {}`. The reconciliation sync needs the full enabled set
       * to decide which gateway connections are stale — silently dropping
       * undecryptable rows (e.g. during a KEY_VAULTS_SECRET mishap) would make
       * every healthy connection look stale and mass-disconnect them.
       */
      includeUndecryptable?: boolean;
    },
  ): Promise<DecryptedBotProvider[]> => {
    const results = await db
      .select()
      .from(agentBotProviders)
      .where(and(eq(agentBotProviders.platform, platform), eq(agentBotProviders.enabled, true)));

    const decrypted: DecryptedBotProvider[] = [];

    for (const r of results) {
      if (!r.credentials) {
        if (options?.includeUndecryptable) decrypted.push({ ...r, credentials: {} });
        continue;
      }

      try {
        const credentials = gateKeeper
          ? JSON.parse((await gateKeeper.decrypt(r.credentials)).plaintext)
          : JSON.parse(r.credentials);

        decrypted.push({ ...r, credentials });
      } catch {
        // Invalid / undecryptable credentials.
        if (options?.includeUndecryptable) decrypted.push({ ...r, credentials: {} });
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
