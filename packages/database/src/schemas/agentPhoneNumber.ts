import type {
  AgentNumberChargeType,
  AgentPhoneNumberStatus,
  MessagingCampaignStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { amountNumeric, createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Dedicated phone numbers the platform bought from a carrier (Twilio, Telnyx).
 *
 * This is platform inventory, not a user's row: a number exists before anyone
 * owns it (the warm pool) and after its owner gave it up (quarantine), so it
 * cannot live on `agent_accounts`, which only describes "the agent's identity
 * right now". While `assigned`, the number is mirrored there as a `phone`
 * account and `account_id` points at it.
 *
 * The MVP runs on one carrier account per provider and tags each number at the
 * carrier with its owning agent (`agent:<id>`); sub-account isolation per
 * customer is a later step and would only add a column here.
 */
export const agentPhoneNumbers = pgTable(
  'agent_phone_numbers',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** `twilio` / `telnyx` — which carrier account holds the number. */
    provider: text('provider').notNull(),
    /** E.164, e.g. `+14155550123`. */
    phoneNumber: text('phone_number').notNull(),
    /** The carrier's handle for release/configure (Twilio `PN…`, Telnyx number id). */
    providerNumberId: text('provider_number_id').notNull(),
    country: text('country').notNull().default('US'),
    areaCode: text('area_code'),

    status: text('status').$type<AgentPhoneNumberStatus>().notNull().default('pooled'),

    /** Current (or, once quarantined, last) owner. Kept after release for audit. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** The `agent_accounts` row exposing the number while it is assigned. */
    accountId: uuid('account_id').references(() => agentAccounts.id, { onDelete: 'set null' }),

    /** 10DLC standing as last read back from the carrier — never assumed. */
    campaignStatus: text('campaign_status')
      .$type<MessagingCampaignStatus>()
      .notNull()
      .default('none'),
    campaignId: text('campaign_id'),

    /** What the carrier bills per month for the number, in USD. */
    monthlyCostUsd: amountNumeric('monthly_cost_usd'),

    purchasedAt: timestamptz('purchased_at').notNull().defaultNow(),
    assignedAt: timestamptz('assigned_at'),
    quarantinedAt: timestamptz('quarantined_at'),
    /** The number is released at the carrier once this passes. */
    quarantineUntil: timestamptz('quarantine_until'),
    releasedAt: timestamptz('released_at'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    ...timestamps,
  },
  (t) => [
    // A number is owned by at most one live inventory row — including while it
    // sits in quarantine, which is exactly what keeps it from being handed out.
    uniqueIndex('agent_phone_numbers_phone_number_live_unique')
      .on(t.phoneNumber)
      .where(sql`${t.status} <> 'released'`),
    index('agent_phone_numbers_status_area_code_idx').on(t.provider, t.status, t.areaCode),
    index('agent_phone_numbers_agent_id_idx').on(t.agentId),
    index('agent_phone_numbers_quarantine_until_idx').on(t.quarantineUntil),
  ],
);

/**
 * What a dedicated number cost, per agent: the monthly number fee, each SMS
 * segment, and carrier pass-through surcharges.
 *
 * The OSS ledger is what the per-agent cap is enforced against; every row is
 * also handed to the business `recordAgentNumberCharge` slot so the cloud
 * spend ledger and budget see the same charge. `external_id` makes recording
 * idempotent (`sms:<sid>`, `monthly:<number>:<yyyy-mm>`), so a webhook retry or
 * a re-run of the monthly job never bills twice.
 */
export const agentNumberCharges = pgTable(
  'agent_number_charges',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    numberId: uuid('number_id').references(() => agentPhoneNumbers.id, { onDelete: 'set null' }),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    type: text('type').$type<AgentNumberChargeType>().notNull(),
    /** Segments for SMS charges, 1 for the monthly fee. */
    quantity: integer('quantity').notNull().default(1),
    amountUsd: amountNumeric('amount_usd').notNull(),
    externalId: text('external_id').notNull(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_number_charges_external_id_unique').on(t.externalId),
    index('agent_number_charges_agent_occurred_idx').on(t.agentId, t.occurredAt),
    index('agent_number_charges_user_id_idx').on(t.userId),
  ],
);

export type NewAgentPhoneNumber = typeof agentPhoneNumbers.$inferInsert;
export type AgentPhoneNumberItem = typeof agentPhoneNumbers.$inferSelect;
export type NewAgentNumberCharge = typeof agentNumberCharges.$inferInsert;
export type AgentNumberChargeItem = typeof agentNumberCharges.$inferSelect;
