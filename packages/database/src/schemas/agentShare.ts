import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { agents } from './agent';

export interface AgentShareConfig {
  /**
   * Whether the creator may view visitor sessions/topics created against this
   * share. Defaults to `false` — visitor conversations are private to the
   * visitor unless the creator explicitly opts into oversight.
   */
  allowCreatorViewSessions?: boolean;
  /**
   * Whether visitors may read the creator's persisted long-term memory during
   * a shared conversation. Defaults to `false`.
   */
  allowReadMemory?: boolean;
  /** Whitelist of builtin tool ids visitors may invoke. Empty/undefined grants no tools. */
  enabledToolIds?: string[];
  /** Maximum number of topics each signed-in visitor can create for this share. */
  maxTopicsPerVisitor?: number;
  /** Maximum number of message turns allowed in each shared topic. */
  maxTurnsPerTopic?: number;
  /**
   * Creator's monthly spend cap for this shared agent, in USD credits.
   * Billing enforcement for this cap lives in the Cloud repo (business slot);
   * the OSS schema only carries the configured value.
   */
  monthlySpendLimit?: number;
  /**
   * Whether visitors may see raw run error details (message/stack) instead of
   * a generic failure notice. Defaults to `false`.
   */
  showErrorDetails?: boolean;
  /**
   * Whether visitors may see which model/provider is powering the agent.
   * Defaults to `false` — the creator's model choice is hidden by default.
   */
  showModelInfo?: boolean;
  /**
   * Custom URL slug for this share's public link (e.g. `/agent/my-cool-bot`).
   * Uniqueness is enforced at the APPLICATION level
   * (`AgentShareModel.updateSlug`), not by a DB constraint/index — acceptable
   * at the current low slug-write volume. Add a unique index if writes ever
   * grow contentious.
   */
  slug?: string;
  // tipSplitRatio is platform-controlled, not configurable by the creator
}

/**
 * Client-owned config fields accepted by atomic server-side patch updates.
 *
 * `slug` is excluded — it has a dedicated validated write path
 * (`AgentShareModel.updateSlug`) and must never ride in on a generic patch.
 * `monthlySpendLimit: null` explicitly clears the cap back to "unlimited"
 * (the key is removed from the stored jsonb, not set to null).
 */
export type AgentShareConfigPatch = Omit<
  Partial<AgentShareConfig>,
  'monthlySpendLimit' | 'slug'
> & {
  monthlySpendLimit?: number | null;
};

export const agentShares = pgTable(
  'agent_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),

    visibility: text('visibility').default('private').notNull(), // 'private' | 'link'

    shareConfig: jsonb('share_config').$type<AgentShareConfig>(),

    /**
     * Raw page-view count: incremented by `AgentShareModel.incrementUserViewCount`
     * on every non-owner page load of the shared agent page, NOT deduplicated
     * by visitor — a visitor who reloads or revisits bumps this every time.
     * For a distinct-visitor count, see `TopicModel.countShareVisitors`
     * (counts distinct `topics.senderId`), exposed as `visitorCount`.
     */
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
