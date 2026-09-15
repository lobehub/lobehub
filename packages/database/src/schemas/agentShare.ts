import type { AgentShareToolGrant } from '@lobechat/types';
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
  /** Maximum number of topics each signed-in visitor can create for this share. */
  maxTopicsPerVisitor?: number;
  /** Maximum number of message turns allowed in each shared topic. */
  maxTurnsPerTopic?: number;
  /**
   * Creator's monthly spend cap for this shared agent, in USD credits.
   *
   * Mandatory: `normalizeAgentShareConfig` fills a default for any row that
   * lacks one, so every read path through `AgentShareModel` sees a number —
   * see {@link NormalizedAgentShareConfig}. The creator can move the number
   * but can never clear it. A cap of `0` is a real lower bound meaning "stop
   * all visitor runs", never "unlimited".
   *
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
  /**
   * Tools visitors may invoke. A tool absent from the list is not granted, so
   * an empty/undefined list grants nothing. An entry without `apis` grants
   * every API of that tool; an entry with `apis` grants only those.
   */
  toolGrants?: AgentShareToolGrant[];
  // tipSplitRatio is platform-controlled, not configurable by the creator
}

/**
 * `AgentShareConfig` as returned by `normalizeAgentShareConfig`: the spend cap
 * is guaranteed present, so enforcement paths never have to re-derive a
 * default (and can never mistake a missing cap for "unlimited").
 */
export type NormalizedAgentShareConfig = AgentShareConfig & { monthlySpendLimit: number };

/**
 * Client-owned config fields accepted by atomic server-side patch updates.
 *
 * `slug` is excluded — it has a dedicated validated write path
 * (`AgentShareModel.updateSlug`) and must never ride in on a generic patch.
 */
export type AgentShareConfigPatch = Omit<Partial<AgentShareConfig>, 'slug'>;

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
