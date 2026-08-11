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
  varchar,
} from 'drizzle-orm/pg-core';

import { createNanoId, generatePublicCode, idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

/**
 * Aico organizations — wallets use integer minor units:
 * - Toman: bigint Toman
 * - USD: bigint micro-USD (1 USD = 1_000_000)
 */

export const organizations = pgTable(
  'organizations',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('organizations'))
      .notNull()
      .primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    publicCode: text('public_code')
      .$defaultFn(() => generatePublicCode('ORG'))
      .notNull(),
    ownerUserId: text('owner_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    walletBalanceToman: bigint('wallet_balance_toman', { mode: 'number' }).notNull().default(0),
    /** Allocatable balance in micro-USD. */
    walletBalanceMicroUsd: bigint('wallet_balance_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    /** active | suspended | deleted */
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_slug_idx').on(t.slug),
    uniqueIndex('organizations_public_code_uidx').on(t.publicCode),
    index('organizations_owner_user_id_idx').on(t.ownerUserId),
    index('organizations_status_idx').on(t.status),
  ],
);

export type OrganizationItem = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('organizationMembers'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** owner | admin | member */
    role: text('role').notNull().default('member'),
    /**
     * invited | active | disabled | revocation_pending | left
     * At most one `active` membership per user platform-wide.
     */
    status: text('status').notNull().default('invited'),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    joinedAt: timestamptz('joined_at'),
    leftAt: timestamptz('left_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organization_members_org_user_uidx').on(t.orgId, t.userId),
    index('organization_members_user_id_idx').on(t.userId),
    index('organization_members_org_id_idx').on(t.orgId),
    uniqueIndex('organization_members_unique_active_owner_idx')
      .on(t.orgId)
      .where(sql`${t.role} = 'owner' AND ${t.status} = 'active'`),
    /** Platform-wide: a user may have at most one active organization membership. */
    uniqueIndex('organization_members_unique_active_user_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type OrganizationMemberItem = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

export const organizationTeams = pgTable(
  'organization_teams',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('organizationTeams'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organization_teams_org_slug_uidx').on(t.orgId, t.slug),
    index('organization_teams_org_id_idx').on(t.orgId),
    uniqueIndex('organization_teams_unique_default_idx')
      .on(t.orgId)
      .where(sql`${t.isDefault} = true`),
  ],
);

export type OrganizationTeamItem = typeof organizationTeams.$inferSelect;
export type NewOrganizationTeam = typeof organizationTeams.$inferInsert;

export const organizationTeamMembers = pgTable(
  'organization_team_members',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('organizationTeamMembers'))
      .notNull()
      .primaryKey(),
    teamId: text('team_id')
      .references(() => organizationTeams.id, { onDelete: 'cascade' })
      .notNull(),
    orgMemberId: text('org_member_id')
      .references(() => organizationMembers.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('organization_team_members_team_member_uidx').on(t.teamId, t.orgMemberId),
    uniqueIndex('organization_team_members_member_uidx').on(t.orgMemberId),
    index('organization_team_members_team_id_idx').on(t.teamId),
  ],
);

export type OrganizationTeamMemberItem = typeof organizationTeamMembers.$inferSelect;
export type NewOrganizationTeamMember = typeof organizationTeamMembers.$inferInsert;

export const organizationInvites = pgTable(
  'organization_invites',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('organizationInvites'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    /** phone | email | public_code — at least one identifier binding required at accept time */
    identifierType: text('identifier_type').notNull(),
    identifierValue: text('identifier_value').notNull(),
    /** admin | member */
    role: text('role').notNull().default('member'),
    token: text('token')
      .$defaultFn(() => createNanoId(32)())
      .notNull(),
    /** pending | accepted | expired | revoked | rejected */
    status: text('status').notNull().default('pending'),
    invitedByUserId: text('invited_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('organization_invites_token_uidx').on(t.token),
    index('organization_invites_org_id_idx').on(t.orgId),
    index('organization_invites_identifier_idx').on(t.identifierType, t.identifierValue),
  ],
);

export type OrganizationInviteItem = typeof organizationInvites.$inferSelect;
export type NewOrganizationInvite = typeof organizationInvites.$inferInsert;

export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('platformAdmins'))
      .notNull()
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_admins_user_id_uidx').on(t.userId)],
);

export type PlatformAdminItem = typeof platformAdmins.$inferSelect;
export type NewPlatformAdmin = typeof platformAdmins.$inferInsert;

/**
 * Per-member prepaid period budgets.
 * OpenRouter key stays stable across renewals; limit_reset mirrors period.
 */
export const memberBudgets = pgTable(
  'member_budgets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('memberBudgets'))
      .notNull()
      .primaryKey(),
    /**
     * Denormalized tenant key (TENANT-003). Always match with orgMemberId so
     * budget/key helpers can enforce `WHERE org_id = ? AND org_member_id = ?`.
     */
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    orgMemberId: text('org_member_id')
      .references(() => organizationMembers.id, { onDelete: 'cascade' })
      .notNull(),
    /** Configured period amount in micro-USD (gross renewal). */
    periodAmountMicroUsd: bigint('period_amount_micro_usd', { mode: 'number' }).notNull(),
    /** Product periods: daily | weekly | monthly. Legacy `total` grandfathered until reclaim. */
    period: text('period').notNull().default('total'),
    /** OpenRouter limit_reset mirror: daily | weekly | monthly | null */
    openrouterLimitReset: text('openrouter_limit_reset'),
    currentPeriodStart: timestamptz('current_period_start'),
    currentPeriodEnd: timestamptz('current_period_end'),
    nextRenewalAt: timestamptz('next_renewal_at'),
    /**
     * active | renewal_pending | renewal_failed | disabled | settled
     */
    renewalStatus: text('renewal_status').notNull().default('active'),
    reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'number' }).notNull().default(0),
    settledUsageMicroUsd: bigint('settled_usage_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    refundedMicroUsd: bigint('refunded_micro_usd', { mode: 'number' }).notNull().default(0),
    /** Pending period change applied at next renewal boundary. */
    pendingPeriod: text('pending_period'),
    pendingPeriodAmountMicroUsd: bigint('pending_period_amount_micro_usd', { mode: 'number' }),
    openrouterKeyId: text('openrouter_key_id'),
    /** AES-GCM ciphertext (KeyVaultsGateKeeper); never returned to SPA. */
    openrouterKeyCiphertext: text('openrouter_key_ciphertext'),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamptz('last_synced_at'),
    lastSyncStatus: text('last_sync_status').notNull().default('never'),
    lastSyncError: text('last_sync_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('member_budgets_org_member_uidx').on(t.orgMemberId),
    index('member_budgets_org_id_idx').on(t.orgId),
    index('member_budgets_next_renewal_at_idx').on(t.nextRenewalAt),
    index('member_budgets_renewal_status_idx').on(t.renewalStatus),
  ],
);

export type MemberBudgetItem = typeof memberBudgets.$inferSelect;
export type NewMemberBudget = typeof memberBudgets.$inferInsert;

export const userWallets = pgTable(
  'user_wallets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('userWallets'))
      .notNull()
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    balanceToman: bigint('balance_toman', { mode: 'number' }).notNull().default(0),
    balanceMicroUsd: bigint('balance_micro_usd', { mode: 'number' }).notNull().default(0),
    /** UX preference only — never authorize from this alone. personal | organization */
    preferredBillingSource: text('preferred_billing_source').notNull().default('personal'),
    preferredOrganizationId: text('preferred_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    openrouterKeyId: text('openrouter_key_id'),
    openrouterKeyCiphertext: text('openrouter_key_ciphertext'),
    isActive: boolean('is_active').notNull().default(true),
    /** Soft-delete freeze of non-zero personal balance pending refund/recovery. */
    frozenMicroUsd: bigint('frozen_micro_usd', { mode: 'number' }).notNull().default(0),
    lastSyncedAt: timestamptz('last_synced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('user_wallets_user_id_uidx').on(t.userId)],
);

export type UserWalletItem = typeof userWallets.$inferSelect;
export type NewUserWallet = typeof userWallets.$inferInsert;

export const modelAccessRules = pgTable(
  'model_access_rules',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('modelAccessRules'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    scope: text('scope').notNull(),
    orgMemberId: text('org_member_id').references(() => organizationMembers.id, {
      onDelete: 'cascade',
    }),
    teamId: text('team_id').references(() => organizationTeams.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('model_access_rules_org_id_idx').on(t.orgId),
    index('model_access_rules_org_member_id_idx').on(t.orgMemberId),
    index('model_access_rules_team_id_idx').on(t.teamId),
  ],
);

export type ModelAccessRuleItem = typeof modelAccessRules.$inferSelect;
export type NewModelAccessRule = typeof modelAccessRules.$inferInsert;

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('walletTransactions'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    orgMemberId: text('org_member_id').references(() => organizationMembers.id, {
      onDelete: 'set null',
    }),
    /**
     * topup | manual_credit | refund | allocate | period_reservation |
     * period_settlement | period_refund | period_renewal | renewal_failure |
     * adjustment | reclaim | personal_freeze
     */
    type: text('type').notNull(),
    amountToman: bigint('amount_toman', { mode: 'number' }).notNull().default(0),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull().default(0),
    /**
     * Wallet balance snapshot for audit trail (FIN-005).
     * Org txs → organization wallet; personal txs → user wallet.
     */
    balanceBeforeMicroUsd: bigint('balance_before_micro_usd', { mode: 'number' }),
    balanceAfterMicroUsd: bigint('balance_after_micro_usd', { mode: 'number' }),
    balanceBeforeToman: bigint('balance_before_toman', { mode: 'number' }),
    balanceAfterToman: bigint('balance_after_toman', { mode: 'number' }),
    /** Toman per 1 USD at conversion time (integer). */
    fxRateTomanPerUsd: bigint('fx_rate_toman_per_usd', { mode: 'number' }),
    renewalBatchId: text('renewal_batch_id'),
    gatewayRefId: text('gateway_ref_id'),
    description: text('description'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('wallet_transactions_org_id_idx').on(t.orgId),
    index('wallet_transactions_user_id_idx').on(t.userId),
    index('wallet_transactions_created_at_idx').on(t.createdAt),
    index('wallet_transactions_renewal_batch_id_idx').on(t.renewalBatchId),
    /** FIN-003: optional client idempotency key for credit / allocate mutations. */
    uniqueIndex('wallet_transactions_gateway_ref_uidx')
      .on(t.gatewayRefId)
      .where(sql`${t.gatewayRefId} IS NOT NULL`),
  ],
);

export type WalletTransactionItem = typeof walletTransactions.$inferSelect;
export type NewWalletTransaction = typeof walletTransactions.$inferInsert;

/** Idempotent all-or-none org renewal batches. */
export const aicoRenewalBatches = pgTable(
  'aico_renewal_batches',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('renewalBatches'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    /** Unique natural key: org + UTC period boundary timestamp iso */
    batchKey: text('batch_key').notNull(),
    /** pending | funded | failed | settled */
    status: text('status').notNull().default('pending'),
    grossRequiredMicroUsd: bigint('gross_required_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    refundedMicroUsd: bigint('refunded_micro_usd', { mode: 'number' }).notNull().default(0),
    shortfallMicroUsd: bigint('shortfall_micro_usd', { mode: 'number' }).notNull().default(0),
    memberBudgetIds: jsonb('member_budget_ids').$type<string[]>().notNull().default([]),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('aico_renewal_batches_batch_key_uidx').on(t.batchKey),
    index('aico_renewal_batches_org_id_idx').on(t.orgId),
    index('aico_renewal_batches_status_idx').on(t.status),
  ],
);

export type AicoRenewalBatchItem = typeof aicoRenewalBatches.$inferSelect;
export type NewAicoRenewalBatch = typeof aicoRenewalBatches.$inferInsert;

/** Durable outbox for OpenRouter key disable/reclaim after local access removal. */
export const aicoKeyOutbox = pgTable(
  'aico_key_outbox',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('keyOutbox'))
      .notNull()
      .primaryKey(),
    /** disable_member_key | reclaim_member | disable_user_key | disable_trial_keys */
    action: text('action').notNull(),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    orgMemberId: text('org_member_id').references(() => organizationMembers.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    openrouterKeyId: text('openrouter_key_id'),
    /** pending | processing | succeeded | failed */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull(),
    lastError: text('last_error'),
    alertedAt: timestamptz('alerted_at'),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('aico_key_outbox_status_next_attempt_idx').on(t.status, t.nextAttemptAt),
    index('aico_key_outbox_org_member_id_idx').on(t.orgMemberId),
  ],
);

export type AicoKeyOutboxItem = typeof aicoKeyOutbox.$inferSelect;
export type NewAicoKeyOutbox = typeof aicoKeyOutbox.$inferInsert;

/** Soft-deleted account tombstones (restricted super-admin visibility). */
export const aicoAccountTombs = pgTable(
  'aico_account_tombs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('accountTombs'))
      .notNull()
      .primaryKey(),
    /** Original user id (row may be anonymized/disabled). */
    userId: text('user_id').notNull(),
    anonymizedEmailFingerprint: text('anonymized_email_fingerprint'),
    anonymizedPhoneFingerprint: text('anonymized_phone_fingerprint'),
    frozenPersonalMicroUsd: bigint('frozen_personal_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    deletedAt: timestamptz('deleted_at').notNull(),
    deletedByUserId: text('deleted_by_user_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('aico_account_tombs_user_id_uidx').on(t.userId),
    index('aico_account_tombs_deleted_at_idx').on(t.deletedAt),
  ],
);

export type AicoAccountTombItem = typeof aicoAccountTombs.$inferSelect;
export type NewAicoAccountTomb = typeof aicoAccountTombs.$inferInsert;

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('usageLogs'))
      .notNull()
      .primaryKey(),
    orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    orgMemberId: text('org_member_id').references(() => organizationMembers.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** personal | organization */
    billingSource: text('billing_source').notNull().default('personal'),
    modelId: text('model_id').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    /** Locally observed cost (micro-USD); may be pending. */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    /** pending | synchronized | stale | failed */
    settlementStatus: text('settlement_status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_logs_org_id_idx').on(t.orgId),
    index('usage_logs_org_member_id_idx').on(t.orgMemberId),
    index('usage_logs_user_id_idx').on(t.userId),
    index('usage_logs_created_at_idx').on(t.createdAt),
  ],
);

export type UsageLogItem = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;

export const platformTrialConfig = pgTable('platform_trial_config', {
  id: text('id').notNull().primaryKey().default('default'),
  /**
   * Product default: Trial stays disabled until atomic maxRequests lands.
   * Production also hard-rejects regardless of this flag (see aicoBilling router).
   */
  enabled: boolean('enabled').notNull().default(false),
  durationDays: integer('duration_days').notNull().default(3),
  allowedModelIds: text('allowed_model_ids').notNull().default('[]'),
  maxRequests: integer('max_requests'),
  trialBudgetMicroUsd: bigint('trial_budget_micro_usd', { mode: 'number' })
    .notNull()
    .default(1_000_000),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type PlatformTrialConfigItem = typeof platformTrialConfig.$inferSelect;
export type NewPlatformTrialConfig = typeof platformTrialConfig.$inferInsert;

/**
 * Platform FX rate (toman per 1 USD). Single-row config edited by platform admins.
 * Credits / topups use this rate — not a live market feed.
 */
export const platformFxConfig = pgTable('platform_fx_config', {
  id: text('id').notNull().primaryKey().default('default'),
  /** Integer toman per 1 USD (e.g. 187400). */
  tomanPerUsd: bigint('toman_per_usd', { mode: 'number' }).notNull().default(187_400),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type PlatformFxConfigItem = typeof platformFxConfig.$inferSelect;
export type NewPlatformFxConfig = typeof platformFxConfig.$inferInsert;

export const userTrials = pgTable(
  'user_trials',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('userTrials'))
      .notNull()
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    startedAt: timestamptz('started_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    status: text('status').notNull().default('active'),
    phoneFingerprint: text('phone_fingerprint').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_trials_user_id_uidx').on(t.userId),
    uniqueIndex('user_trials_phone_fingerprint_uidx').on(t.phoneFingerprint),
    index('user_trials_status_idx').on(t.status),
  ],
);

export type UserTrialItem = typeof userTrials.$inferSelect;
export type NewUserTrial = typeof userTrials.$inferInsert;

export const trialAbuseBlocklist = pgTable(
  'trial_abuse_blocklist',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('trialAbuseBlocklist'))
      .notNull()
      .primaryKey(),
    fingerprintType: text('fingerprint_type').notNull(),
    fingerprintValue: text('fingerprint_value').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trial_abuse_blocklist_type_value_uidx').on(t.fingerprintType, t.fingerprintValue),
  ],
);

export type TrialAbuseBlocklistItem = typeof trialAbuseBlocklist.$inferSelect;
export type NewTrialAbuseBlocklist = typeof trialAbuseBlocklist.$inferInsert;

export const aicoUserPublicIds = pgTable(
  'aico_user_public_ids',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('userPublicIds'))
      .notNull()
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    publicCode: text('public_code')
      .$defaultFn(() => generatePublicCode('USR'))
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('aico_user_public_ids_user_id_uidx').on(t.userId),
    uniqueIndex('aico_user_public_ids_public_code_uidx').on(t.publicCode),
  ],
);

export type AicoUserPublicIdItem = typeof aicoUserPublicIds.$inferSelect;
export type NewAicoUserPublicId = typeof aicoUserPublicIds.$inferInsert;

export const openrouterModelCatalog = pgTable(
  'openrouter_model_catalog',
  {
    id: text('id').notNull().primaryKey(),
    displayName: text('display_name'),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(false),
    type: varchar('type', { length: 20 }).notNull().default('chat'),
    contextWindowTokens: integer('context_window_tokens'),
    pricing: jsonb('pricing'),
    abilities: jsonb('abilities').default({}),
    settings: jsonb('settings').default({}),
    releasedAt: varchar('released_at', { length: 10 }),
    payload: jsonb('payload').notNull().default({}),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('openrouter_model_catalog_enabled_idx').on(t.enabled)],
);

export type OpenrouterModelCatalogItem = typeof openrouterModelCatalog.$inferSelect;
export type NewOpenrouterModelCatalog = typeof openrouterModelCatalog.$inferInsert;

export const openrouterModelSyncState = pgTable('openrouter_model_sync_state', {
  id: text('id').notNull().primaryKey().default('default'),
  lastSyncedAt: timestamptz('last_synced_at'),
  lastStatus: text('last_status').notNull().default('never'),
  lastError: text('last_error'),
  modelCount: integer('model_count').notNull().default(0),
  lastTriggeredBy: text('last_triggered_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type OpenrouterModelSyncStateItem = typeof openrouterModelSyncState.$inferSelect;
export type NewOpenrouterModelSyncState = typeof openrouterModelSyncState.$inferInsert;

/** Append-only history of OpenRouter catalog sync runs (added/removed model ids). */
export const openrouterModelSyncRuns = pgTable(
  'openrouter_model_sync_runs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('orSyncRuns', 12))
      .notNull()
      .primaryKey(),
    status: text('status').notNull(),
    triggeredBy: text('triggered_by'),
    modelCount: integer('model_count').notNull().default(0),
    addedModelIds: jsonb('added_model_ids').$type<string[]>().notNull().default([]),
    removedModelIds: jsonb('removed_model_ids').$type<string[]>().notNull().default([]),
    error: text('error'),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('openrouter_model_sync_runs_synced_at_idx').on(t.syncedAt)],
);

export type OpenrouterModelSyncRunItem = typeof openrouterModelSyncRuns.$inferSelect;
export type NewOpenrouterModelSyncRun = typeof openrouterModelSyncRuns.$inferInsert;

/** Master OpenRouter monitoring snapshot (never fabricate zero when unknown). */
export const aicoMasterMonitorState = pgTable('aico_master_monitor_state', {
  id: text('id').notNull().primaryKey().default('default'),
  /** known | unknown | stale | error */
  status: text('status').notNull().default('unknown'),
  availableCreditMicroUsd: bigint('available_credit_micro_usd', { mode: 'number' }),
  observedBurnMicroUsdPerDay: bigint('observed_burn_micro_usd_per_day', { mode: 'number' }),
  lowCreditThresholdMicroUsd: bigint('low_credit_threshold_micro_usd', { mode: 'number' })
    .notNull()
    .default(100_000_000),
  projectedExhaustionAt: timestamptz('projected_exhaustion_at'),
  lastSuccessfulCheckAt: timestamptz('last_successful_check_at'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AicoMasterMonitorStateItem = typeof aicoMasterMonitorState.$inferSelect;
export type NewAicoMasterMonitorState = typeof aicoMasterMonitorState.$inferInsert;

/**
 * Aico security audit trail for platform/org/billing/key mutations (MON-002).
 * Do not store secrets (OTP, API keys, full phones) in metadata.
 */
export const aicoSecurityAuditLogs = pgTable(
  'aico_security_audit_logs',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** success | failure */
    result: text('result').notNull().default('success'),
    /** trpc | job | auth | system */
    source: text('source').notNull().default('trpc'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('aico_security_audit_logs_action_idx').on(t.action),
    index('aico_security_audit_logs_organization_id_idx').on(t.organizationId),
    index('aico_security_audit_logs_actor_user_id_idx').on(t.actorUserId),
    index('aico_security_audit_logs_created_at_idx').on(t.createdAt),
  ],
);

export type AicoSecurityAuditLogItem = typeof aicoSecurityAuditLogs.$inferSelect;
export type NewAicoSecurityAuditLog = typeof aicoSecurityAuditLogs.$inferInsert;

/** Dedupe / cooldown state for ops security alerts (MON-003). */
export const aicoSecurityAlertState = pgTable('aico_security_alert_state', {
  id: text('id').notNull().primaryKey(),
  lastAlertedAt: timestamptz('last_alerted_at'),
  hitCount: integer('hit_count').notNull().default(0),
  updatedAt: updatedAt(),
});

export type AicoSecurityAlertStateItem = typeof aicoSecurityAlertState.$inferSelect;
export type NewAicoSecurityAlertState = typeof aicoSecurityAlertState.$inferInsert;
