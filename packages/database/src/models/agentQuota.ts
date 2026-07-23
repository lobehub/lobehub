import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

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
  agentProviderAccounts,
  agentQuotaCalibrations,
  agentQuotaSnapshots,
  agentQuotaUsageLedger,
  agentQuotaWindows,
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

  private mine = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentProviderAccounts,
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
   */
  upsertByIdentity = async (
    provider: string,
    identity: AccountIdentityInput,
    defaults: Partial<NewAgentProviderAccount> = {},
  ): Promise<SafeAccount> => {
    if (identity.externalAccountId) {
      const existing = await this.db.query.agentProviderAccounts.findFirst({
        where: and(
          this.mine(),
          eq(agentProviderAccounts.provider, provider),
          eq(agentProviderAccounts.externalAccountId, identity.externalAccountId),
        ),
      });
      if (existing) {
        const [row] = await this.db
          .update(agentProviderAccounts)
          .set({ ...identity, lastValidatedAt: new Date(), updatedAt: new Date() })
          .where(eq(agentProviderAccounts.id, existing.id))
          .returning();
        return stripCredentials(row);
      }
    }

    return this.create({
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

  update = async (id: string, patch: Partial<Omit<NewAgentProviderAccount, 'credentials'>>) =>
    this.db
      .update(agentProviderAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(agentProviderAccounts.id, id), this.mine()));

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
