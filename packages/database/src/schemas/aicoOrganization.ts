import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createNanoId, idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

/**
 * Aico Phase 2+ — organizations (customer tenants with wallet + members + teams).
 * Separate from LobeHub `workspaces`.
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
    ownerUserId: text('owner_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    /** Paid-in toman (audit of topups). */
    walletBalanceToman: bigint('wallet_balance_toman', { mode: 'number' }).notNull().default(0),
    /** Allocatable USD balance after FX conversion. */
    walletBalanceUsd: numeric('wallet_balance_usd', { mode: 'number', precision: 14, scale: 6 })
      .notNull()
      .default(0),
    /** active | suspended */
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_slug_idx').on(t.slug),
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
    /** invited | active | disabled */
    status: text('status').notNull().default('invited'),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    joinedAt: timestamptz('joined_at'),
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
  ],
);

export type OrganizationMemberItem = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

/** Teams nest under an organization; model allow-lists attach to teams. */
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
    /** Default "Unspecified" team — rename-protected. */
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
    /** phone | email */
    identifierType: text('identifier_type').notNull(),
    identifierValue: text('identifier_value').notNull(),
    /** admin | member */
    role: text('role').notNull().default('member'),
    token: text('token')
      .$defaultFn(() => createNanoId(32)())
      .notNull(),
    /** pending | accepted | expired | revoked */
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

/** Platform (super) admins — independent of org roles. */
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

export const memberBudgets = pgTable(
  'member_budgets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('memberBudgets'))
      .notNull()
      .primaryKey(),
    orgMemberId: text('org_member_id')
      .references(() => organizationMembers.id, { onDelete: 'cascade' })
      .notNull(),
    limitUsd: numeric('limit_usd', { mode: 'number', precision: 10, scale: 6 }).notNull(),
    /** daily | weekly | monthly | total */
    period: text('period').notNull().default('total'),
    usedUsd: numeric('used_usd', { mode: 'number', precision: 10, scale: 6 }).notNull().default(0),
    openrouterKeyId: text('openrouter_key_id'),
    /** Encrypted plaintext key (KeyVaultsGateKeeper); never returned to SPA. */
    openrouterKeyHash: text('openrouter_key_hash'),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamptz('last_synced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('member_budgets_org_member_uidx').on(t.orgMemberId)],
);

export type MemberBudgetItem = typeof memberBudgets.$inferSelect;
export type NewMemberBudget = typeof memberBudgets.$inferInsert;

/** B2C personal wallet + managed OpenRouter key. */
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
    balanceUsd: numeric('balance_usd', { mode: 'number', precision: 14, scale: 6 })
      .notNull()
      .default(0),
    openrouterKeyId: text('openrouter_key_id'),
    openrouterKeyHash: text('openrouter_key_hash'),
    isActive: boolean('is_active').notNull().default(true),
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
    /** organization | member | team */
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
    /** topup | manual_credit | refund | allocate */
    type: text('type').notNull(),
    amountToman: bigint('amount_toman', { mode: 'number' }).notNull(),
    amountUsd: numeric('amount_usd', { mode: 'number', precision: 14, scale: 6 }),
    /** Toman per 1 USD at conversion time. */
    fxRate: numeric('fx_rate', { mode: 'number', precision: 14, scale: 4 }),
    gatewayRefId: text('gateway_ref_id'),
    description: text('description'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('wallet_transactions_org_id_idx').on(t.orgId),
    index('wallet_transactions_user_id_idx').on(t.userId),
    index('wallet_transactions_created_at_idx').on(t.createdAt),
  ],
);

export type WalletTransactionItem = typeof walletTransactions.$inferSelect;
export type NewWalletTransaction = typeof walletTransactions.$inferInsert;

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
    modelId: text('model_id').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { mode: 'number', precision: 10, scale: 6 }).notNull(),
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

/** Singleton-style trial settings (one active row keyed by id `default`). */
export const platformTrialConfig = pgTable('platform_trial_config', {
  id: text('id').notNull().primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(true),
  durationDays: integer('duration_days').notNull().default(3),
  /** JSON array of model ids; empty = all models. */
  allowedModelIds: text('allowed_model_ids').notNull().default('[]'),
  maxRequests: integer('max_requests'),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type PlatformTrialConfigItem = typeof platformTrialConfig.$inferSelect;
export type NewPlatformTrialConfig = typeof platformTrialConfig.$inferInsert;

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
    /** active | expired | revoked */
    status: text('status').notNull().default('active'),
    phoneFingerprint: text('phone_fingerprint').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_trials_user_id_uidx').on(t.userId),
    index('user_trials_phone_fingerprint_idx').on(t.phoneFingerprint),
    index('user_trials_status_idx').on(t.status),
  ],
);

export type UserTrialItem = typeof userTrials.$inferSelect;
export type NewUserTrial = typeof userTrials.$inferInsert;

/** Persists after account delete to block trial re-abuse. */
export const trialAbuseBlocklist = pgTable(
  'trial_abuse_blocklist',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('trialAbuseBlocklist'))
      .notNull()
      .primaryKey(),
    /** phone | email */
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
