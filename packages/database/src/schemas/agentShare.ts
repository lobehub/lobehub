import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { topics } from './topic';

export interface AgentShareConfig {
  allowReadMemory?: boolean;
  enabledToolIds?: string[];
  filePermissionConfig?: {
    agentFiles?: 'none' | 'read';
    knowledgeBase?: 'none' | 'read';
    uploadAllowed?: boolean;
  };
  /** Maximum number of topics each signed-in visitor can create for this share. */
  maxTopicsPerVisitor: number;
  /** Maximum number of message turns allowed in each shared topic. */
  maxTurnsPerTopic: number;
  // tipSplitRatio is platform-controlled, not configurable by the creator
}

/** Client-owned config fields accepted by atomic server-side patch updates. */
export type AgentShareConfigPatch = Partial<AgentShareConfig>;

export const agentShares = pgTable(
  'agent_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),

    visibility: text('visibility').default('private').notNull(), // 'private' | 'link'

    shareConfig: jsonb('share_config').$type<AgentShareConfig>(),

    /** Successful share-page visits; this counter records page views, not unique visitors. */
    userViewCount: integer('user_view_count').default(0).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_shares_agent_id_unique').on(t.agentId),
    index('agent_shares_visibility_idx').on(t.visibility),
  ],
);

export type NewAgentShare = typeof agentShares.$inferInsert;
export type AgentShareItem = typeof agentShares.$inferSelect;

/**
 * Monotonic "restrictive-change generation" counter for one agent's share,
 * bumped by every write that must invalidate runs staked/started under the
 * PREVIOUS grants: revoking `link` back to `private`
 * (`AgentShareModel.updateVisibility` / `deleteByAgentId`), the heterogeneous
 * config reset (`writeAgentConfigWithShareReset`), and tightening
 * `shareConfig` (`AgentShareModel.updateConfig` — narrowing `enabledToolIds`,
 * `allowReadMemory: true → false`, or `filePermissionConfig.* : 'read' →
 * 'none'`). Never bumped by a purely additive/loosening change.
 *
 * `assertRunnableForVisitor` stamps the CURRENT value onto every reservation
 * it stakes (`agentShareRunReservations.generation`) and compares it against
 * the generation the caller observed when it first resolved the share, so a
 * request built from a stale (pre-tightening) config snapshot fails closed
 * instead of starting. A revocation captures the generation it just bumped TO
 * and hands it to `AiAgentService.interruptActiveShareRuns` as a cutoff:
 * every reservation/running-operation with a STRICTLY OLDER generation
 * predates this revocation and must be torn down; anything at or above it
 * (e.g. a run started by a republish that raced a stale deferred `after()`
 * callback) was authorized AFTER this revocation and must survive. See
 * `bumpAgentShareGeneration` / `readAgentShareGeneration`
 * (`../utils/agentShareGeneration.ts`).
 *
 * A DEDICATED table, not a column on `agentShares`: that row is hard-deleted
 * by `deleteByAgentId` (disableShare) and freshly re-inserted by `create()`
 * on re-enable, so a counter living there would reset on every
 * disable/re-enable cycle — a revocation's captured cutoff would then be
 * compared, after re-enable, against a brand-new row restarting at the
 * default, making a legitimately re-granted reservation look "older than the
 * cutoff" and get swept by the stale callback. Keyed off `agents.id`
 * (untouched by that cycle) instead, this counter is monotonic for the whole
 * lifetime of the agent, independent of how many times its share is
 * disabled/re-enabled.
 */
export const agentShareGenerations = pgTable('agent_share_generations', {
  agentId: text('agent_id')
    .primaryKey()
    .references(() => agents.id, { onDelete: 'cascade' }),

  generation: integer('generation').default(1).notNull(),

  ...timestamps,
});

export type NewAgentShareGeneration = typeof agentShareGenerations.$inferInsert;
export type AgentShareGenerationItem = typeof agentShareGenerations.$inferSelect;

/**
 * Durable claim staking a share-visitor run's right to exist, written in the
 * SAME `agents.id FOR UPDATE` transaction as the `visibility === 'link'`
 * recheck (`AgentShareModel.assertRunnableForVisitor`) — BEFORE any gateway
 * init, state persistence, or queue scheduling begins
 * (`AgentRuntimeService.createOperation`).
 *
 * This is what replaces the previous bounded-retry stopgap
 * (`interruptActiveShareRuns` polling `findActiveVisitorRunTopics` 4x/750ms):
 * that window was sized to "usually" cover `createOperation`'s I/O, but a
 * slow gateway/queue call could still outlast it, letting a revoked run start
 * unstoppably. A row is durable and unbounded — it exists from the moment the
 * visibility check passes until the run either confirms (deletes it, see
 * `agentShareRunReservations` usage in `AgentShareModel`) or is torn down, no
 * matter how long standing up the operation takes.
 *
 * `id` IS the operation id (1:1, not a surrogate key) so revocation can
 * directly target the exact runtime operation without a join.
 */
export const agentShareRunReservations = pgTable(
  'agent_share_run_reservations',
  {
    /** Equals the runtime's `operationId` — see the table JSDoc. */
    id: text('id').primaryKey(),

    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),

    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),

    visitorUserId: text('visitor_user_id').notNull(),

    /**
     * The share's `agentShareGenerations` value at the moment
     * `assertRunnableForVisitor` staked this reservation (read under the same
     * lock as the visibility recheck). Lets a revocation scope its cleanup
     * scan to reservations that predate it (`generation < revocationGeneration`)
     * instead of sweeping every pending reservation for the agent — see
     * `agentShareGenerations`'s JSDoc for why a broad agentId-only scan is
     * wrong (it would also catch a run legitimately started by a republish
     * that raced a stale deferred revocation callback).
     */
    generation: integer('generation').notNull(),

    /**
     * Set by a revocation (`AgentShareModel.revokeReservations`) that raced
     * this reservation. `null` = still pending. Once set, the standing-up run
     * can never confirm this reservation again — `confirmReservation`'s
     * `DELETE ... WHERE revoked_at IS NULL` stops matching it, so it fails
     * closed instead of writing the topic's `runningOperation` marker.
     */
    revokedAt: timestamptz('revoked_at'),

    createdAt: createdAt(),
  },
  (t) => [index('agent_share_run_reservations_agent_id_idx').on(t.agentId)],
);

export type NewAgentShareRunReservation = typeof agentShareRunReservations.$inferInsert;
export type AgentShareRunReservationItem = typeof agentShareRunReservations.$inferSelect;
