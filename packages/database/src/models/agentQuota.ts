import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type {
  AgentProviderAccountItem,
  NewAgentAccountBinding,
  NewAgentProviderAccount,
  NewAgentQuotaCalibration,
  NewAgentQuotaUsageLedger,
  NewAgentQuotaWindow,
} from '../schemas';
import {
  agentAccountBindings,
  agentDeviceAccountBindings,
  agentOperations,
  agentProviderAccountLogins,
  agentProviderAccounts,
  agentQuotaCalibrations,
  agentQuotaSnapshots,
  agentQuotaUsageLedger,
  agentQuotaWindows,
  agents,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import {
  type QuotaAccountCredentials,
  QuotaBindingRole,
  QuotaCredentialMode,
} from '../types/agentQuota';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

// ─────────────────────────────────────────────────────────────────────────────
// Accounts — identity + credential vault
// ─────────────────────────────────────────────────────────────────────────────

/** Fields safe to expose without decrypting anything. */
export type SafeAccount = Omit<AgentProviderAccountItem, 'credentials'>;

const stripCredentials = ({ credentials: _c, ...rest }: AgentProviderAccountItem): SafeAccount =>
  rest;

/** Identity fields resolved from local CLI config, used to dedupe accounts. */
export interface AccountIdentityInput {
  displayName?: string;
  email?: string;
  externalAccountId?: string;
  organizationId?: string;
  planTier?: string;
  rateLimitTier?: string;
}

export class AgentProviderAccountModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private async getGateKeeper() {
    if (!this.gateKeeperPromise) this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    return this.gateKeeperPromise;
  }

  /**
   * The rows this member may see and use: public workspace accounts and their
   * own private ones. A login does not widen this — the server cannot verify
   * that a reporting device really holds the provider login, so a reported
   * login is no proof of access. Sharing a private account is its creator's
   * call (`setVisibility`). Personal scope ignores visibility.
   */
  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentProviderAccounts,
    );

  /** Every row of the scope regardless of visibility: one real account is one row per workspace. */
  private scope = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: agentProviderAccounts.userId,
        workspaceId: agentProviderAccounts.workspaceId,
      },
    );

  create = async (
    params: Omit<NewAgentProviderAccount, 'userId' | 'credentials'> & {
      credentials?: QuotaAccountCredentials;
    },
  ): Promise<SafeAccount> => {
    const { credentials, ...rest } = params;
    let encrypted: string | null = null;
    let tokenExpiresAt = rest.tokenExpiresAt ?? null;
    if (credentials) {
      const gateKeeper = await this.getGateKeeper();
      encrypted = await gateKeeper.encrypt(JSON.stringify(credentials));
      if (credentials.expiresAt) tokenExpiresAt = new Date(credentials.expiresAt);
    }

    const [row] = await this.db
      .insert(agentProviderAccounts)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...rest, credentials: encrypted, tokenExpiresAt },
        ),
      )
      .returning();
    return stripCredentials(row);
  };

  /**
   * Insert-or-update by real identity. The provider account UUID is the natural
   * dedupe key, so the same login observed on multiple devices collapses to one
   * row (that is exactly what lets multi-device usage merge).
   *
   * Dedupe looks past visibility: a teammate's private row for the same
   * identity is still that account, and inserting a second one would collide
   * with the workspace identity index. Finding such a row grants nothing —
   * knowing an external id is not holding the login — so it is neither updated
   * nor returned, and `undefined` comes back. A new workspace row starts
   * `private`: a login reported from a member's machine is theirs until they
   * publish it.
   */
  upsertByIdentity = async (
    provider: string,
    identity: AccountIdentityInput,
    defaults: Partial<NewAgentProviderAccount> = {},
  ): Promise<SafeAccount | undefined> => {
    if (identity.externalAccountId) {
      const existing = await this.db.query.agentProviderAccounts.findFirst({
        columns: { id: true },
        where: and(
          this.scope(),
          eq(agentProviderAccounts.provider, provider),
          eq(agentProviderAccounts.externalAccountId, identity.externalAccountId),
        ),
      });
      if (existing) {
        const [row] = await this.db
          .update(agentProviderAccounts)
          .set({ ...identity, lastValidatedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(agentProviderAccounts.id, existing.id), this.mine()))
          .returning();
        return row ? stripCredentials(row) : undefined;
      }
    }

    return this.create({
      ...(this.workspaceId && { visibility: 'private' as const }),
      ...defaults,
      ...identity,
      credentialMode: defaults.credentialMode ?? QuotaCredentialMode.referenced,
      provider,
    } as Omit<NewAgentProviderAccount, 'userId' | 'credentials'>);
  };

  list = async (): Promise<SafeAccount[]> => {
    const rows = await this.db
      .select()
      .from(agentProviderAccounts)
      .where(this.mine())
      .orderBy(desc(agentProviderAccounts.updatedAt));
    return rows.map(stripCredentials);
  };

  findById = async (id: string): Promise<SafeAccount | null> => {
    const row = await this.db.query.agentProviderAccounts.findFirst({
      where: and(eq(agentProviderAccounts.id, id), this.mine()),
    });
    return row ? stripCredentials(row) : null;
  };

  /** Look up the row for a real provider account (usage → account attribution). */
  findByExternalId = async (
    provider: string,
    externalAccountId: string,
  ): Promise<SafeAccount | null> => {
    const row = await this.db.query.agentProviderAccounts.findFirst({
      where: and(
        this.mine(),
        eq(agentProviderAccounts.provider, provider),
        eq(agentProviderAccounts.externalAccountId, externalAccountId),
      ),
    });
    return row ? stripCredentials(row) : null;
  };

  /** Decrypt the managed OAuth credential for spawn-time injection. */
  getCredentials = async (id: string): Promise<QuotaAccountCredentials | null> => {
    const row = await this.db.query.agentProviderAccounts.findFirst({
      where: and(eq(agentProviderAccounts.id, id), this.mine()),
    });
    if (!row?.credentials) return null;
    const gateKeeper = await this.getGateKeeper();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(row.credentials);
    if (!wasAuthentic) return null;
    try {
      return JSON.parse(plaintext) as QuotaAccountCredentials;
    } catch {
      return null;
    }
  };

  /** Store/rotate the managed credential (re-encrypts, promotes expiry). */
  setCredentials = async (id: string, credentials: QuotaAccountCredentials) => {
    const gateKeeper = await this.getGateKeeper();
    const encrypted = await gateKeeper.encrypt(JSON.stringify(credentials));
    return this.db
      .update(agentProviderAccounts)
      .set({
        credentialMode: QuotaCredentialMode.managed,
        credentials: encrypted,
        tokenExpiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentProviderAccounts.id, id), this.mine()));
  };

  update = async (
    id: string,
    patch: Partial<Omit<NewAgentProviderAccount, 'credentials' | 'visibility'>>,
  ) =>
    this.db
      .update(agentProviderAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(agentProviderAccounts.id, id), this.mine()));

  /**
   * Publish or hide a workspace account. Only its creator decides: another
   * login holder hiding it would take it away from the rest of the team, and
   * publishing it would expose someone else's subscription. Returns whether a
   * row changed.
   */
  setVisibility = async (id: string, visibility: 'private' | 'public'): Promise<boolean> => {
    if (!this.workspaceId) return false;
    const rows = await this.db
      .update(agentProviderAccounts)
      .set({ updatedAt: new Date(), visibility })
      .where(
        and(
          eq(agentProviderAccounts.id, id),
          this.scope(),
          eq(agentProviderAccounts.userId, this.userId),
        ),
      )
      .returning({ id: agentProviderAccounts.id });
    return rows.length > 0;
  };

  delete = async (id: string) =>
    this.db.delete(agentProviderAccounts).where(and(eq(agentProviderAccounts.id, id), this.mine()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Bindings — agent → account pool (LB + switch)
// ─────────────────────────────────────────────────────────────────────────────

export class AgentAccountBindingModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentAccountBindings,
    );

  listByAgent = async (agentId: string) =>
    this.db
      .select()
      .from(agentAccountBindings)
      .where(and(this.mine(), eq(agentAccountBindings.agentId, agentId)))
      .orderBy(agentAccountBindings.priority);

  upsert = async (
    params: Omit<NewAgentAccountBinding, 'userId'> & { agentId: string; accountId: string },
  ) => {
    const [row] = await this.db
      .insert(agentAccountBindings)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .onConflictDoUpdate({
        set: {
          enabled: params.enabled ?? true,
          priority: params.priority ?? 0,
          role: params.role ?? QuotaBindingRole.pool,
          updatedAt: new Date(),
          weight: params.weight ?? 1,
        },
        target: [agentAccountBindings.agentId, agentAccountBindings.accountId],
      })
      .returning();
    return row;
  };

  /**
   * Pin one account for an agent (UI "switch account"): the chosen binding
   * becomes `pinned`, any previously-pinned sibling drops back to `pool` — the
   * partial unique index guarantees at most one pinned per agent.
   */
  pin = async (agentId: string, accountId: string) => {
    await this.db
      .update(agentAccountBindings)
      .set({ role: QuotaBindingRole.pool, updatedAt: new Date() })
      .where(
        and(
          this.mine(),
          eq(agentAccountBindings.agentId, agentId),
          eq(agentAccountBindings.role, QuotaBindingRole.pinned),
        ),
      );
    await this.db
      .update(agentAccountBindings)
      .set({ role: QuotaBindingRole.pinned, updatedAt: new Date() })
      .where(
        and(
          this.mine(),
          eq(agentAccountBindings.agentId, agentId),
          eq(agentAccountBindings.accountId, accountId),
        ),
      );
  };

  remove = async (id: string) =>
    this.db.delete(agentAccountBindings).where(and(eq(agentAccountBindings.id, id), this.mine()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Logins — which devices an account is signed in on
// ─────────────────────────────────────────────────────────────────────────────

export class AgentProviderAccountLoginModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentProviderAccountLogins,
    );

  /** Record that `deviceId` holds a login for `accountId` (refreshes `lastSeenAt`). */
  record = async (accountId: string, deviceId: string) => {
    const now = new Date();
    const [row] = await this.db
      .insert(agentProviderAccountLogins)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { accountId, deviceId, lastSeenAt: now },
        ),
      )
      .onConflictDoUpdate({
        set: { lastSeenAt: now, updatedAt: now, userId: this.userId },
        target: [agentProviderAccountLogins.accountId, agentProviderAccountLogins.deviceId],
      })
      .returning();
    return row;
  };

  listByDevice = async (deviceId: string) =>
    this.db
      .select()
      .from(agentProviderAccountLogins)
      .where(and(this.mine(), eq(agentProviderAccountLogins.deviceId, deviceId)));

  listByAccount = async (accountId: string) =>
    this.db
      .select()
      .from(agentProviderAccountLogins)
      .where(and(this.mine(), eq(agentProviderAccountLogins.accountId, accountId)));

  /** Forget logins on a device; device account bindings on them go with them (FK cascade). */
  removeOnDevice = async (deviceId: string, accountIds: string[]) => {
    if (accountIds.length === 0) return;
    await this.db
      .delete(agentProviderAccountLogins)
      .where(
        and(
          this.mine(),
          eq(agentProviderAccountLogins.deviceId, deviceId),
          inArray(agentProviderAccountLogins.accountId, accountIds),
        ),
      );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Device account bindings — an agent's account choice on one device
// ─────────────────────────────────────────────────────────────────────────────

export class AgentDeviceAccountBindingModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentDeviceAccountBindings,
    );

  find = async (agentId: string, deviceId: string) =>
    (await this.db.query.agentDeviceAccountBindings.findFirst({
      where: and(
        this.mine(),
        eq(agentDeviceAccountBindings.agentId, agentId),
        eq(agentDeviceAccountBindings.deviceId, deviceId),
      ),
    })) ?? null;

  listByAgent = async (agentId: string) =>
    this.db
      .select()
      .from(agentDeviceAccountBindings)
      .where(and(this.mine(), eq(agentDeviceAccountBindings.agentId, agentId)));

  /**
   * Choose the account an agent uses on a device. The (account, device) pair
   * must be a recorded login there: the composite foreign key rejects the
   * write otherwise.
   */
  set = async (agentId: string, deviceId: string, accountId: string) => {
    const now = new Date();
    const [row] = await this.db
      .insert(agentDeviceAccountBindings)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { accountId, agentId, deviceId },
        ),
      )
      .onConflictDoUpdate({
        set: { accountId, updatedAt: now, userId: this.userId },
        target: [agentDeviceAccountBindings.agentId, agentDeviceAccountBindings.deviceId],
      })
      .returning();
    return row;
  };

  /**
   * Like `set`, but never replaces a choice the device already has: a pin
   * handed down to a device must not overwrite a choice made there meanwhile.
   */
  setIfAbsent = async (agentId: string, deviceId: string, accountId: string) => {
    await this.db
      .insert(agentDeviceAccountBindings)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { accountId, agentId, deviceId },
        ),
      )
      .onConflictDoNothing({
        target: [agentDeviceAccountBindings.agentId, agentDeviceAccountBindings.deviceId],
      });
  };

  clear = async (agentId: string, deviceId: string) =>
    this.db
      .delete(agentDeviceAccountBindings)
      .where(
        and(
          this.mine(),
          eq(agentDeviceAccountBindings.agentId, agentId),
          eq(agentDeviceAccountBindings.deviceId, deviceId),
        ),
      );
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots — append-only observation
// ─────────────────────────────────────────────────────────────────────────────

export class AgentQuotaSnapshotModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentQuotaSnapshots,
    );

  append = async (rows: Omit<typeof agentQuotaSnapshots.$inferInsert, 'userId'>[]) => {
    if (rows.length === 0) return [];
    return this.db
      .insert(agentQuotaSnapshots)
      .values(
        rows.map((r) =>
          buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, r),
        ),
      )
      .returning();
  };

  /** Full reading series for an account since an instant, oldest first. */
  listRange = async (accountId: string, since: Date) =>
    this.db
      .select()
      .from(agentQuotaSnapshots)
      .where(
        and(
          this.mine(),
          eq(agentQuotaSnapshots.accountId, accountId),
          gte(agentQuotaSnapshots.capturedAt, since),
        ),
      )
      .orderBy(agentQuotaSnapshots.capturedAt);

  /** The most recent reading per (limitType, scopeKey) for an account. */
  latestPerBucket = async (accountId: string) =>
    this.db
      .selectDistinctOn([agentQuotaSnapshots.limitType, agentQuotaSnapshots.scopeKey])
      .from(agentQuotaSnapshots)
      .where(and(this.mine(), eq(agentQuotaSnapshots.accountId, accountId)))
      .orderBy(
        agentQuotaSnapshots.limitType,
        agentQuotaSnapshots.scopeKey,
        desc(agentQuotaSnapshots.capturedAt),
      );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage ledger — append-only, idempotent by externalEventId
// ─────────────────────────────────────────────────────────────────────────────

export class AgentQuotaUsageLedgerModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentQuotaUsageLedger,
    );

  /** Insert one turn; a duplicate externalEventId is silently ignored. */
  append = async (row: Omit<NewAgentQuotaUsageLedger, 'userId'>) =>
    this.db
      .insert(agentQuotaUsageLedger)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, row))
      .onConflictDoNothing({
        // partial unique index → the predicate must be restated for arbiter match
        target: agentQuotaUsageLedger.externalEventId,
        where: sql`${agentQuotaUsageLedger.externalEventId} is not null`,
      })
      .returning();

  /**
   * Per-turn token + cost rows for an account since an instant, oldest first.
   * The calendar aggregates these by local day, so the bucketing has to happen
   * in the client's timezone rather than the database's.
   */
  listSince = async (accountId: string, since: Date) =>
    this.db
      .select({
        cacheReadTokens: agentQuotaUsageLedger.cacheReadTokens,
        cacheWriteTokens: agentQuotaUsageLedger.cacheWriteTokens,
        costUsd: agentQuotaUsageLedger.costUsd,
        inputTokens: agentQuotaUsageLedger.inputTokens,
        model: agentQuotaUsageLedger.model,
        occurredAt: agentQuotaUsageLedger.occurredAt,
        outputTokens: agentQuotaUsageLedger.outputTokens,
        reasoningTokens: agentQuotaUsageLedger.reasoningTokens,
      })
      .from(agentQuotaUsageLedger)
      .where(
        and(
          this.mine(),
          eq(agentQuotaUsageLedger.accountId, accountId),
          gte(agentQuotaUsageLedger.occurredAt, since),
        ),
      )
      .orderBy(agentQuotaUsageLedger.occurredAt);

  /**
   * Agent runs still in flight that billed this account since `since` — who is
   * spending it right now. A run is listed once, under its newest turn. `idle`
   * is left out: a run that has not started has not billed anything.
   */
  listActiveRuns = async (accountId: string, since: Date) => {
    const lastTurnAt = sql`max(${agentQuotaUsageLedger.occurredAt})`.mapWith(
      agentQuotaUsageLedger.occurredAt,
    );

    return this.db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: agentOperations.agentId,
        agentTitle: agents.title,
        lastTurnAt,
        operationId: agentOperations.id,
        startedAt: agentOperations.startedAt,
        status: agentOperations.status,
        topicId: agentOperations.topicId,
        topicTitle: topics.title,
      })
      .from(agentQuotaUsageLedger)
      .innerJoin(agentOperations, eq(agentQuotaUsageLedger.operationId, agentOperations.id))
      .leftJoin(agents, eq(agentOperations.agentId, agents.id))
      .leftJoin(topics, eq(agentOperations.topicId, topics.id))
      .where(
        and(
          this.mine(),
          eq(agentQuotaUsageLedger.accountId, accountId),
          gte(agentQuotaUsageLedger.occurredAt, since),
          inArray(agentOperations.status, [
            'running',
            'waiting_for_async_tool',
            'waiting_for_client',
            'waiting_for_human',
          ]),
        ),
      )
      .groupBy(agentOperations.id, agents.id, topics.id)
      .orderBy(desc(lastTurnAt));
  };

  /** Total USD spent on an account within [from, to). */
  sumCostUsd = async (accountId: string, from: Date, to: Date): Promise<number> => {
    const [r] = await this.db
      .select({ total: sql<number>`coalesce(sum(${agentQuotaUsageLedger.costUsd}), 0)` })
      .from(agentQuotaUsageLedger)
      .where(
        and(
          this.mine(),
          eq(agentQuotaUsageLedger.accountId, accountId),
          gte(agentQuotaUsageLedger.occurredAt, from),
          lte(agentQuotaUsageLedger.occurredAt, to),
        ),
      );
    return Number(r?.total ?? 0);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows — projection / read model (upsert on natural key)
// ─────────────────────────────────────────────────────────────────────────────

export class AgentQuotaWindowModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentQuotaWindows);

  /**
   * Upsert a window by its natural key. `peakUtilization` merges via GREATEST so
   * out-of-order or partial samples never lower the ceiling; `rateLimitedAt`
   * keeps the earliest 429.
   */
  upsert = async (row: Omit<NewAgentQuotaWindow, 'userId'>) => {
    const [result] = await this.db
      .insert(agentQuotaWindows)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, row))
      .onConflictDoUpdate({
        set: {
          contaminated: sql`excluded.contaminated`,
          estimatedCapacityUsd: sql`excluded.estimated_capacity_usd`,
          lastSeenAt: sql`excluded.last_seen_at`,
          lastUtilization: sql`excluded.last_utilization`,
          observedCostUsd: sql`excluded.observed_cost_usd`,
          observedTokens: sql`excluded.observed_tokens`,
          peakUtilization: sql`greatest(${agentQuotaWindows.peakUtilization}, excluded.peak_utilization)`,
          rateLimitedAt: sql`coalesce(${agentQuotaWindows.rateLimitedAt}, excluded.rate_limited_at)`,
          updatedAt: new Date(),
        },
        target: [
          agentQuotaWindows.accountId,
          agentQuotaWindows.limitType,
          agentQuotaWindows.scopeKey,
          agentQuotaWindows.resetsAt,
        ],
      })
      .returning();
    return result;
  };

  /** Recent windows for an account, newest reset first. */
  listByAccount = async (accountId: string, limit = 60) =>
    this.db
      .select()
      .from(agentQuotaWindows)
      .where(and(this.mine(), eq(agentQuotaWindows.accountId, accountId)))
      .orderBy(desc(agentQuotaWindows.resetsAt))
      .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Calibrations — learned capacity history
// ─────────────────────────────────────────────────────────────────────────────

export class AgentQuotaCalibrationModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentQuotaCalibrations,
    );

  insert = async (row: Omit<NewAgentQuotaCalibration, 'userId'>) => {
    const [result] = await this.db
      .insert(agentQuotaCalibrations)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, row))
      .returning();
    return result;
  };

  /** Latest calibration for a (kind, scope) bucket. */
  latest = async (accountId: string, limitType: string, scopeKey = '') => {
    const row = await this.db.query.agentQuotaCalibrations.findFirst({
      where: and(
        this.mine(),
        eq(agentQuotaCalibrations.accountId, accountId),
        eq(agentQuotaCalibrations.limitType, limitType),
        eq(agentQuotaCalibrations.scopeKey, scopeKey),
      ),
      orderBy: [desc(agentQuotaCalibrations.calibratedAt)],
    });
    return row ?? null;
  };
}
