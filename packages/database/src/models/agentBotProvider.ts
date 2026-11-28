import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, lt, sql } from 'drizzle-orm';

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

  /**
   * Returns the rows it actually removed, so the caller can tell a real delete
   * from a no-op. The ownership filter and the `(platform, applicationId)`
   * unique index disagree about scope — the index is global, the filter is not
   * — so a binding that lives outside the caller's active scope matches
   * nothing here while still occupying the key that `create` collides with.
   * Silently returning "ok" in that case reads as "removed" and leaves the
   * application id permanently unbindable.
   */
  delete = async (id: string) => {
    return this.db
      .delete(agentBotProviders)
      .where(and(eq(agentBotProviders.id, id), this.ownership()))
      .returning({ id: agentBotProviders.id });
  };

  /**
   * Look a binding up by id with no scope filter, for the two cases where the
   * caller's active scope is the problem rather than a permission: explaining
   * which agent already holds an application id, and letting a creator delete
   * their own binding from the other scope. Authorization is the caller's job
   * — this returns rows belonging to anyone.
   */
  findByIdAcrossScopes = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentBotProviders)
      .where(eq(agentBotProviders.id, id))
      .limit(1);

    return result;
  };

  /** Delete by id with no scope filter. Call only after authorizing the row. */
  deleteAcrossScopes = async (id: string) => {
    return this.db
      .delete(agentBotProviders)
      .where(eq(agentBotProviders.id, id))
      .returning({ id: agentBotProviders.id });
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

  // --------------- Activity ---------------

  /**
   * Record that the owner's bot `platform`/`applicationId` was just used,
   * scoped to this model's owner. Returns the bot's activity before the write,
   * or `undefined` when no such bot is visible to the owner.
   *
   * `updatedAt` is kept as is: activity is not a configuration change, and
   * lists ordered by `updatedAt` must not reshuffle each time a bot replies.
   */
  markActive = async (
    platform: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<{ id: string; previousLastActiveAt: Date } | undefined> => {
    const [row] = await this.db
      .select({ id: agentBotProviders.id, lastActiveAt: agentBotProviders.lastActiveAt })
      .from(agentBotProviders)
      .where(
        and(
          eq(agentBotProviders.platform, platform),
          eq(agentBotProviders.applicationId, applicationId),
          this.ownership(),
        ),
      )
      .limit(1);
    if (!row) return;

    await this.db
      .update(agentBotProviders)
      .set({ lastActiveAt: now, updatedAt: sql`${agentBotProviders.updatedAt}` })
      .where(eq(agentBotProviders.id, row.id));

    return { id: row.id, previousLastActiveAt: row.lastActiveAt };
  };

  /**
   * Record activity for the bot `platform`/`applicationId`, whoever owns it
   * (the reply path knows the bot, not the owner).
   *
   * Throttled: a bot whose activity is younger than `minIntervalMs` is not
   * written again, so a busy bot costs one write per interval rather than one
   * per reply. Idle detection works in days, so an hour of slack is invisible.
   */
  static touchActivity = async (
    db: LobeChatDatabase,
    platform: string,
    applicationId: string,
    options: { minIntervalMs?: number; now?: Date } = {},
  ): Promise<boolean> => {
    const now = options.now ?? new Date();
    const staleBefore = new Date(now.getTime() - (options.minIntervalMs ?? 60 * 60 * 1000));

    const rows = await db
      .update(agentBotProviders)
      .set({ lastActiveAt: now, updatedAt: sql`${agentBotProviders.updatedAt}` })
      .where(
        and(
          eq(agentBotProviders.platform, platform),
          eq(agentBotProviders.applicationId, applicationId),
          lt(agentBotProviders.lastActiveAt, staleBefore),
        ),
      )
      .returning({ id: agentBotProviders.id });

    return rows.length > 0;
  };

  /**
   * Mark as active every enabled bot `userId` created whose activity is older
   * than `idleBefore`, and return them. For waking a returning owner's idle
   * bots in one statement; bots used more recently are left untouched.
   */
  static wakeIdleByUser = async (
    db: LobeChatDatabase,
    userId: string,
    idleBefore: Date,
    now: Date = new Date(),
  ): Promise<Array<Pick<AgentBotProviderItem, 'applicationId' | 'id' | 'platform'>>> =>
    db
      .update(agentBotProviders)
      .set({ lastActiveAt: now, updatedAt: sql`${agentBotProviders.updatedAt}` })
      .where(
        and(
          eq(agentBotProviders.userId, userId),
          eq(agentBotProviders.enabled, true),
          lt(agentBotProviders.lastActiveAt, idleBefore),
        ),
      )
      .returning({
        applicationId: agentBotProviders.applicationId,
        id: agentBotProviders.id,
        platform: agentBotProviders.platform,
      });

  /**
   * One page of enabled bots whose activity is older than `idleBefore` (and,
   * when given, no older than `idleAfter`),
   * ordered by id for keyset paging (`afterId` is the last id of the previous
   * page). Credentials are not loaded: most idle bots only need their owner
   * looked up.
   */
  static listIdleEnabled = async (
    db: LobeChatDatabase,
    params: { afterId?: string; idleAfter?: Date; idleBefore: Date; limit: number },
  ): Promise<Array<Omit<AgentBotProviderItem, 'credentials'>>> => {
    const { credentials: _credentials, ...columns } = getTableColumns(agentBotProviders);

    return db
      .select(columns)
      .from(agentBotProviders)
      .where(
        and(
          eq(agentBotProviders.enabled, true),
          lt(agentBotProviders.lastActiveAt, params.idleBefore),
          params.idleAfter ? gte(agentBotProviders.lastActiveAt, params.idleAfter) : undefined,
          params.afterId ? gt(agentBotProviders.id, params.afterId) : undefined,
        ),
      )
      .orderBy(asc(agentBotProviders.id))
      .limit(params.limit);
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
