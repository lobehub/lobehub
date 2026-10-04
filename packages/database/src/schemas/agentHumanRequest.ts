import type {
  AgentHumanRequestAction,
  AgentHumanRequestResult,
  AgentHumanRequestSecret,
  AgentHumanRequestStatus,
  AgentHumanRequestSurface,
  AgentHumanRequestType,
} from '@lobechat/types';
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Actions an agent parked for its owner: approval cards (send / edit /
 * discard an outbound message) and secret cards (fill a `{{secret}}` slot
 * through an ASC/1 HPKE envelope).
 *
 * No secret value is ever written here. A secret request stores only the
 * signed public request and its per-request X25519 private key, sealed with
 * the KeyVaults key; the key is set to `null` before the first decryption
 * attempt, so a request can be opened at most once and a database copy taken
 * afterwards holds nothing that opens any envelope.
 */
export const agentHumanRequests = pgTable(
  'agent_human_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agentHumanRequests'))
      .notNull(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Conversation the outcome is reported back into. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),

    /** Run and tool call that parked the action (audit only). */
    operationId: text('operation_id'),
    toolCallId: text('tool_call_id'),

    type: text('type').$type<AgentHumanRequestType>().notNull(),

    status: text('status').$type<AgentHumanRequestStatus>().notNull().default('pending'),

    /** The action the server will perform — after the owner's edits, if any. */
    action: jsonb('action').$type<AgentHumanRequestAction>().notNull(),

    /** The action as the agent proposed it; only set once the owner edits. */
    originalAction: jsonb('original_action').$type<AgentHumanRequestAction>(),

    /** The agent's explanation. Untrusted text, shown apart from system facts. */
    reason: text('reason'),

    /** Public ASC request + label for `secret` requests. */
    secret: jsonb('secret').$type<AgentHumanRequestSecret>(),

    /**
     * KeyVaults-sealed X25519 private key of the request. Destroyed (set to
     * `null`) before the envelope is opened.
     */
    recipientKey: text('recipient_key'),

    result: jsonb('result').$type<AgentHumanRequestResult>(),

    expiresAt: timestamptz('expires_at').notNull(),
    decidedAt: timestamptz('decided_at'),
    decidedVia: text('decided_via').$type<AgentHumanRequestSurface>(),

    ...timestamps,
  },
  (t) => [
    // The inbox of cards: one owner's open requests, newest first.
    index('agent_human_requests_user_status_idx').on(t.userId, t.status, t.createdAt),
    index('agent_human_requests_agent_created_at_idx').on(t.agentId, t.createdAt),
    index('agent_human_requests_topic_id_idx').on(t.topicId),
  ],
);

export const insertAgentHumanRequestSchema = createInsertSchema(agentHumanRequests);

export type NewAgentHumanRequest = typeof agentHumanRequests.$inferInsert;
export type AgentHumanRequestRow = typeof agentHumanRequests.$inferSelect;
