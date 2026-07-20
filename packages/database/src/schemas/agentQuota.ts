import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { amountNumeric, createdAt, timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { devices } from './device';
import { messages } from './message';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

// ─────────────────────────────────────────────────────────────────────────────
// Shared enums (stored as text columns + const maps, per repo convention)
// ─────────────────────────────────────────────────────────────────────────────

/** Which external agent tool the account/quota belongs to. */
export const QuotaProvider = {
  claudeCode: 'claude-code',
  codex: 'codex',
} as const;
export type QuotaProvider = (typeof QuotaProvider)[keyof typeof QuotaProvider];

/**
 * How the account's credential is held.
 * - `referenced`: we never store the token; we read the CLI's own login
 *   (Keychain / `~/.claude` / `~/.codex/auth.json`) at spawn time and never
 *   refresh it. Coexists with the user's local CLI, but cannot power cloud runs.
 * - `managed`: we store the OAuth token (encrypted) and own its refresh. Powers
 *   cloud scheduling + cross-device load balancing. MUST be a dedicated account,
 *   because refreshing here rotates the refresh-token and would log out any
 *   local CLI logged into the same account.
 */
export const QuotaCredentialMode = {
  managed: 'managed',
  referenced: 'referenced',
} as const;
export type QuotaCredentialMode = (typeof QuotaCredentialMode)[keyof typeof QuotaCredentialMode];

export const QuotaAccountStatus = {
  active: 'active',
  disabled: 'disabled',
  error: 'error',
  expired: 'expired',
  rateLimited: 'rate_limited',
} as const;
export type QuotaAccountStatus = (typeof QuotaAccountStatus)[keyof typeof QuotaAccountStatus];

/**
 * How an account participates in an agent's run.
 * - `pinned`: user manually locked this account; disables load balancing.
 * - `pool`: eligible for load-balanced selection.
 * - `disabled`: kept in the list but never selected.
 */
export const QuotaBindingRole = {
  disabled: 'disabled',
  pinned: 'pinned',
  pool: 'pool',
} as const;
export type QuotaBindingRole = (typeof QuotaBindingRole)[keyof typeof QuotaBindingRole];

/** Whether the ledger cost came from the provider or was computed by us. */
export const QuotaCostSource = {
  computed: 'computed',
  providerReported: 'provider_reported',
} as const;
export type QuotaCostSource = (typeof QuotaCostSource)[keyof typeof QuotaCostSource];

/**
 * Decrypted shape of `agent_provider_accounts.credentials` (managed mode only).
 * Encrypted at rest via KeyVaultsGateKeeper, same as `user_connectors`.
 */
export interface QuotaAccountCredentials {
  accessToken: string;
  expiresAt?: number;
  refreshToken?: string;
  scope?: string;
}

/** Plaintext pointer used in `referenced` mode — no secret material. */
export interface QuotaAccountCredentialRef {
  /** Custom CLI profile dir (CLAUDE_CONFIG_DIR / CODEX_HOME) if any. */
  configDir?: string;
  origin: 'keychain' | 'config-dir' | 'default-file';
}

// ─────────────────────────────────────────────────────────────────────────────
// agent_provider_accounts — identity + credential vault (the pivot entity)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per external provider account (a Claude Code / Codex subscription).
 * This is simultaneously the identity, the credential holder, and the partition
 * key every quota-data table hangs off. Modeled on `user_connectors`: encrypted
 * `credentials`, `tokenExpiresAt` promoted for refresh indexing, layered
 * user / workspace scope.
 */
export const agentProviderAccounts = pgTable(
  'agent_provider_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(),

    // ── Identity (populated from provider once observed) ──────────────────────
    /** Anthropic `oauthAccount.accountUuid` / Codex `tokens.account_id`. */
    externalAccountId: text('external_account_id'),
    email: text('email'),
    displayName: text('display_name'),
    organizationId: text('organization_id'),
    /** e.g. `max` / `pro`. */
    planTier: text('plan_tier'),
    /** e.g. `default_claude_max_20x`. */
    rateLimitTier: text('rate_limit_tier'),

    /** User-nameable label shown in the switcher. */
    label: varchar255('label'),

    // ── Credential ────────────────────────────────────────────────────────────
    credentialMode: text('credential_mode').notNull().default(QuotaCredentialMode.referenced),
    /** Encrypted `QuotaAccountCredentials` (managed mode only). */
    credentials: text('credentials'),
    /** Plaintext `QuotaAccountCredentialRef` (referenced mode only). */
    credentialRef: jsonb('credential_ref').$type<QuotaAccountCredentialRef>(),
    /** Promoted out of the encrypted blob so the refresh worker can index it. */
    tokenExpiresAt: timestamptz('token_expires_at'),

    status: text('status').notNull().default(QuotaAccountStatus.active),
    enabled: boolean('enabled').notNull().default(true),
    lastValidatedAt: timestamptz('last_validated_at'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    index('agent_provider_accounts_user_id_idx').on(t.userId),
    index('agent_provider_accounts_workspace_id_idx').on(t.workspaceId),
    index('agent_provider_accounts_token_expires_at_idx').on(t.tokenExpiresAt),
    /** One row per real external account per user. */
    uniqueIndex('agent_provider_accounts_identity_unique')
      .on(t.userId, t.provider, t.externalAccountId)
      .where(sql`${t.externalAccountId} IS NOT NULL`),
  ],
);

export type NewAgentProviderAccount = typeof agentProviderAccounts.$inferInsert;
export type AgentProviderAccountItem = typeof agentProviderAccounts.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// agent_account_bindings — agent → account pool (enables LB + UI switching)
// ─────────────────────────────────────────────────────────────────────────────

export const agentAccountBindings = pgTable(
  'agent_account_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: uuid('account_id')
      .references(() => agentProviderAccounts.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    role: text('role').notNull().default(QuotaBindingRole.pool),
    /** Lower = preferred when ordering the pool. */
    priority: integer('priority').notNull().default(0),
    /** Weighted round-robin weight within the pool. */
    weight: integer('weight').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_account_bindings_agent_account_unique').on(t.agentId, t.accountId),
    /** At most one pinned account per agent. */
    uniqueIndex('agent_account_bindings_agent_pinned_unique')
      .on(t.agentId)
      .where(sql`${t.role} = 'pinned'`),
    index('agent_account_bindings_agent_id_idx').on(t.agentId),
    index('agent_account_bindings_account_id_idx').on(t.accountId),
    index('agent_account_bindings_user_id_idx').on(t.userId),
  ],
);

export type NewAgentAccountBinding = typeof agentAccountBindings.$inferInsert;
export type AgentAccountBindingItem = typeof agentAccountBindings.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// agent_quota_snapshots — append-only provider observation (the instrument)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Time series of the provider's authoritative utilization readings. This is the
 * only place the Δutilization ↔ Δusage pairing can be measured, so it is the
 * instrument the calibration reads. Append-only; a row is written only when the
 * reading changes.
 */
export const agentQuotaSnapshots = pgTable(
  'agent_quota_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    accountId: uuid('account_id')
      .references(() => agentProviderAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Which device reported it; lets multi-device readings dedupe by account. */
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),

    /** Raw `limits[].kind`, e.g. `session` / `weekly_all` / `weekly_scoped`. */
    limitKind: text('limit_kind').notNull(),
    /** Model display name for scoped windows (e.g. `Fable`); `''` otherwise. */
    scopeKey: text('scope_key').notNull().default(''),

    resetsAt: timestamptz('resets_at'),
    /** Integer percent 0..100 as reported by the provider. */
    utilization: integer('utilization').notNull(),
    severity: text('severity'),
    isActive: boolean('is_active'),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),
    /** Full raw limit object for forensic/debug. */
    raw: jsonb('raw').$type<Record<string, unknown>>(),

    createdAt: createdAt(),
  },
  (t) => [
    index('agent_quota_snapshots_account_kind_scope_idx').on(
      t.accountId,
      t.limitKind,
      t.scopeKey,
      t.capturedAt,
    ),
    index('agent_quota_snapshots_account_captured_idx').on(t.accountId, t.capturedAt),
    index('agent_quota_snapshots_resets_at_idx').on(t.resetsAt),
  ],
);

export type NewAgentQuotaSnapshot = typeof agentQuotaSnapshots.$inferInsert;
export type AgentQuotaSnapshotItem = typeof agentQuotaSnapshots.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// agent_quota_usage_ledger — append-only per-turn consumption (our side)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Our own consumption, one row per assistant turn, stamped with the account
 * that was active. Independent from the snapshot series; the two are crossed to
 * calibrate capacity. `accountId` is nullable so historical import (which cannot
 * know the account) can still land, tagged null and excluded from calibration.
 */
export const agentQuotaUsageLedger = pgTable(
  'agent_quota_usage_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    accountId: uuid('account_id').references(() => agentProviderAccounts.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    provider: text('provider').notNull(),
    model: text('model'),
    occurredAt: timestamptz('occurred_at').notNull(),

    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    reasoningTokens: integer('reasoning_tokens'),

    costUsd: amountNumeric('cost_usd'),
    costSource: text('cost_source'),

    // ── Provenance links (for attribution / dedupe) ──────────────────────────
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Idempotency key (e.g. `${messageId}:${turnIndex}`) for at-most-once import. */
    externalEventId: text('external_event_id'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: createdAt(),
  },
  (t) => [
    index('agent_quota_usage_ledger_account_occurred_idx').on(t.accountId, t.occurredAt),
    index('agent_quota_usage_ledger_account_model_occurred_idx').on(
      t.accountId,
      t.model,
      t.occurredAt,
    ),
    index('agent_quota_usage_ledger_message_id_idx').on(t.messageId),
    index('agent_quota_usage_ledger_operation_id_idx').on(t.operationId),
    uniqueIndex('agent_quota_usage_ledger_external_event_unique')
      .on(t.externalEventId)
      .where(sql`${t.externalEventId} IS NOT NULL`),
  ],
);

export type NewAgentQuotaUsageLedger = typeof agentQuotaUsageLedger.$inferInsert;
export type AgentQuotaUsageLedgerItem = typeof agentQuotaUsageLedger.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// agent_quota_calibrations — learned capacity per (account, kind, scope)
// ─────────────────────────────────────────────────────────────────────────────

export const agentQuotaCalibrations = pgTable(
  'agent_quota_calibrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    accountId: uuid('account_id')
      .references(() => agentProviderAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    limitKind: text('limit_kind').notNull(),
    scopeKey: text('scope_key').notNull().default(''),

    /** Capacity in provider-equivalent USD (the stable unit). */
    capacityUsd: amountNumeric('capacity_usd').notNull(),
    /** Derived token equivalent at the observed model mix (drifts; display-only). */
    capacityTokensEquivalent: bigint('capacity_tokens_equivalent', { mode: 'number' }),
    /** Cost share by model over the calibration sample. */
    modelMix: jsonb('model_mix').$type<Record<string, number>>(),

    sampleCount: integer('sample_count').notNull(),
    /** 0..1 confidence, grows with samples + fit quality. */
    confidence: amountNumeric('confidence'),
    /** e.g. `theil_sen` / `ratio`. */
    method: text('method'),
    windowSeconds: integer('window_seconds'),

    calibratedAt: timestamptz('calibrated_at').notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: createdAt(),
  },
  (t) => [
    index('agent_quota_calibrations_account_kind_scope_idx').on(
      t.accountId,
      t.limitKind,
      t.scopeKey,
      t.calibratedAt,
    ),
  ],
);

export type NewAgentQuotaCalibration = typeof agentQuotaCalibrations.$inferInsert;
export type AgentQuotaCalibrationItem = typeof agentQuotaCalibrations.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// agent_quota_windows — per-window projection (LB + UI read model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per concrete reset window, keyed by `resets_at` (the provider's own
 * natural key). Fully derivable from snapshots + ledger + calibrations; kept
 * materialized so the QuotaMenu and the load balancer can read it cheaply.
 */
export const agentQuotaWindows = pgTable(
  'agent_quota_windows',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    accountId: uuid('account_id')
      .references(() => agentProviderAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    limitKind: text('limit_kind').notNull(),
    scopeKey: text('scope_key').notNull().default(''),

    /** Natural key: provider-reported window reset instant. */
    resetsAt: timestamptz('resets_at').notNull(),
    windowStartAt: timestamptz('window_start_at').notNull(),
    windowSeconds: integer('window_seconds').notNull(),

    /** Max utilization seen — monotonic within a window, so robust to gaps. */
    peakUtilization: integer('peak_utilization').notNull().default(0),
    lastUtilization: integer('last_utilization'),
    /** First real 429 observed inside this window, if any. */
    rateLimitedAt: timestamptz('rate_limited_at'),

    observedCostUsd: amountNumeric('observed_cost_usd'),
    observedTokens: bigint('observed_tokens', { mode: 'number' }),
    estimatedCapacityUsd: amountNumeric('estimated_capacity_usd'),
    /**
     * Δutilization > 0 while our ledger saw ≈0 spend → an external consumer (CLI
     * outside LobeHub) moved the meter. Excluded from calibration.
     */
    contaminated: boolean('contaminated').notNull().default(false),

    firstSeenAt: timestamptz('first_seen_at'),
    lastSeenAt: timestamptz('last_seen_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_quota_windows_natural_key_unique').on(
      t.accountId,
      t.limitKind,
      t.scopeKey,
      t.resetsAt,
    ),
    index('agent_quota_windows_account_resets_idx').on(t.accountId, t.resetsAt),
    index('agent_quota_windows_user_id_idx').on(t.userId),
  ],
);

export type NewAgentQuotaWindow = typeof agentQuotaWindows.$inferInsert;
export type AgentQuotaWindowItem = typeof agentQuotaWindows.$inferSelect;
