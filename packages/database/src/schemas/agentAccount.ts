import type {
  AgentAccountCapabilities,
  AgentAccountCredentialHint,
  AgentAccountKind,
  AgentAccountStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The identity assets an agent owns: its `mail` address, `phone` number,
 * `wallet`, or a third-party `service` login.
 *
 * This is deliberately **not** `agent_bot_providers`. A bot provider models
 * "our bot inside someone else's platform" — the address belongs to the
 * platform and the conversation surface lives there. An account models the
 * opposite: an address or login **we give the agent**, which the outside world
 * can reach directly. Forcing the second through the first is what made the
 * earlier implementation hardcode `isDM() === true` and pay an always-on tool
 * slot for an inbox.
 *
 * `credentials` is AES-GCM ciphertext (KeyVaults), the same pattern
 * `agent_bot_providers` / `messenger_account_links` / `connector` use. It is
 * never selected by list queries, never returned by the API, and never reaches
 * the model; `credential_hint` carries the non-secret display facts instead.
 *
 * `kind` / `status` are plain text columns typed via `@lobechat/types` unions —
 * no DB-level enum, so onboarding a new kind never needs a migration.
 */
export const agentAccounts = pgTable(
  'agent_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** What sort of identity this is. */
    kind: text('kind').$type<AgentAccountKind>().notNull(),

    /**
     * The handle itself: `xx@lobe.id`, `+1...`, `agent@github`, `0x...`.
     * Together with `provider` it is the inbound routing key.
     */
    identifier: text('identifier').notNull(),

    /** Human label, e.g. "Work mailbox". */
    displayName: text('display_name'),

    /** Who issues/owns this account: `agent-mail`, `linq`, `user`, … */
    provider: text('provider').notNull(),

    status: text('status').$type<AgentAccountStatus>().notNull().default('provisioning'),

    /**
     * Declared by the provider: receive / send / sign / login.
     *
     * Deliberately has no default. A default would let a producer omit the one
     * field that says what the account can actually do, and silently install an
     * account that claims to do nothing — or worse, to do everything if the
     * default were ever widened. Whoever provisions the account knows its
     * capabilities; the row must state them.
     */
    capabilities: jsonb('capabilities').$type<AgentAccountCapabilities>().notNull(),

    /**
     * AES-GCM ciphertext of a JSON credential record (KeyVaults gatekeeper).
     * Never plaintext, never selected by list queries, never returned by the
     * API. Secrets stay in this single column — not in `metadata` — so rotating
     * `KEY_VAULTS_SECRET` is one reachable rewrite pass.
     */
    credentials: text('credentials'),

    /** Non-secret display facts (username, masked tail, rotatedAt, expiresAt). */
    credentialHint: jsonb('credential_hint').$type<AgentAccountCredentialHint>(),

    /** Provider-side non-secret handles (inboxId, chatId, walletId, …). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    /** When the account was released. Kept for audit; the row is not deleted. */
    revokedAt: timestamptz('revoked_at'),

    ...timestamps,
  },
  (t) => [
    // One agent cannot mount the same live account twice. Revoked rows stay
    // for audit but no longer hold the handle, so it can be bound again.
    uniqueIndex('agent_accounts_agent_kind_provider_identifier_unique')
      .on(t.agentId, t.kind, t.provider, t.identifier)
      .where(sql`${t.status} <> 'revoked'`),
    // Inbound routing: an incoming message/call resolves to exactly one live
    // account. Partial for the same reason — a released number or address must
    // not stay locked to the agent that gave it up.
    uniqueIndex('agent_accounts_provider_identifier_unique')
      .on(t.provider, t.identifier)
      .where(sql`${t.status} <> 'revoked'`),
    // A phone number is one line on the network whichever carrier holds it, so
    // it routes to at most one live account across providers (a number ported
    // from Twilio to Telnyx must not stay bound to two agents). Revoked rows
    // fall out for the same reason as above.
    uniqueIndex('agent_accounts_phone_identifier_live_unique')
      .on(t.identifier)
      .where(sql`${t.kind} = 'phone' AND ${t.status} <> 'revoked'`),
    index('agent_accounts_agent_id_idx').on(t.agentId),
    index('agent_accounts_user_id_idx').on(t.userId),
    index('agent_accounts_workspace_id_idx').on(t.workspaceId),
  ],
);

export const insertAgentAccountSchema = createInsertSchema(agentAccounts);

export type NewAgentAccount = typeof agentAccounts.$inferInsert;
export type AgentAccountItem = typeof agentAccounts.$inferSelect;
