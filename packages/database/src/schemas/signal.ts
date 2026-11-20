import type { SignalMetadata, SignalStatus } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Signals: facts the outside world produced, one row per event an Oracle
 * delivered (a mail provider's webhook today, other feeds later).
 *
 * A signal records only that something happened out there, in the source's
 * own shape. Interpreting it — parsing it into a mail, putting it in an
 * agent's inbox, waking a run — happens downstream and is tracked by
 * `status`, so a failed step can be retried from the stored signal and every
 * delivery stays auditable after it was handled.
 *
 * Only authenticated deliveries are stored: the Oracle's signature is checked
 * before the row is written, so an unauthenticated caller cannot fill this
 * table. `(source, external_id)` is unique, which makes a redelivery of the
 * same event idempotent.
 *
 * Retention is per `(user_id, scope_key, source)`: the retention sweep keeps the
 * newest N rows of each and drops the rest, except rows a decision points at
 * (`signal_decisions.signal_id`) or a mail was parsed from — those are evidence
 * and stay. `payload` has its own, shorter clock: the sweep blanks it once
 * `created_at` is past the payload TTL and stamps `payload_purged_at`, so the
 * row's shape and its decisions outlive the raw content.
 */
export const signals = pgTable(
  'signals',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The Oracle that produced it, e.g. `agent-mail`. */
    source: text('source').notNull(),
    /** What happened, in the source's vocabulary, e.g. `message.received`. */
    type: text('type').notNull(),
    /** The source's own id for this event — the redelivery dedupe key. */
    externalId: text('external_id').notNull(),

    /**
     * Where the source addressed it, when it is addressed to an account. Kept
     * nullable and cleared rather than cascaded: the signal is a record of
     * what the world sent, which outlives the account it was sent to.
     */
    accountId: uuid('account_id').references(() => agentAccounts.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),

    /**
     * The channel the event arrived on, e.g. `discord:<applicationId>:<threadId>`. The retention
     * sweep counts rows per `(user_id, scope_key, source)`, so a chatty channel cannot push
     * another channel's history out. Null for sources with no channel (a mail provider's account
     * feed); those rows form one bucket per source.
     */
    scopeKey: text('scope_key'),

    /** The event as the source delivered it (non-secret fields only). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Set when the retention sweep blanked `payload`; null while the content is still held. */
    payloadPurgedAt: timestamptz('payload_purged_at'),
    /** How the event reached us and where it was addressed; survives the payload purge. Never content. */
    metadata: jsonb('metadata').$type<SignalMetadata>().notNull().default({}),

    status: text('status').$type<SignalStatus>().notNull().default('pending'),
    /** Processing attempts so far, including the first. */
    attempts: integer('attempts').notNull().default(0),
    /** Why the last attempt failed or why the signal was ignored. */
    error: text('error'),

    /** When it happened, by the source's clock (may differ from `created_at`). */
    occurredAt: timestamptz('occurred_at'),
    processedAt: timestamptz('processed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('signals_source_external_id_unique').on(t.source, t.externalId),
    // Retry sweeps: what is still pending or failed, oldest first.
    index('signals_status_created_at_idx').on(t.status, t.createdAt),
    index('signals_account_created_at_idx').on(t.accountId, t.createdAt),
    index('signals_user_id_idx').on(t.userId),
    // Retention sweep: newest-first within one (user, channel, source) bucket.
    index('signals_user_scope_source_created_at_idx').on(
      t.userId,
      t.scopeKey,
      t.source,
      t.createdAt,
    ),
    // Payload TTL sweep: only rows whose content is still held, oldest first.
    index('signals_payload_unpurged_created_at_idx')
      .on(t.createdAt)
      .where(sql`${t.payloadPurgedAt} IS NULL`),
  ],
);

export const insertSignalSchema = createInsertSchema(signals);

export type NewSignal = typeof signals.$inferInsert;
export type SignalItem = typeof signals.$inferSelect;
