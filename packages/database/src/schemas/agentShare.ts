import type {
  AgentShareDemoCase,
  AgentShareGrantSource,
  AgentShareToolGrant,
  AgentShareVisibility,
} from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { users } from './user';

export type AgentShareDeviceAccess = 'allowlist' | 'contacts' | 'none';

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
  /**
   * Whether visitors also get every tool and skill the Agent currently turns
   * on, beyond the explicit {@link toolGrants} / {@link skillGrants}. Resolved
   * per visitor run from the Agent config (`withShareAutoAgentGrants`), never
   * persisted as grants, so a tool added to the Agent later is open to
   * visitors without the creator revisiting the share, and one turned off on
   * the Agent leaves with it. {@link declinedGrantIds} still keeps an
   * identifier closed. Absent reads as off.
   */
  autoGrantAgentTools?: boolean;
  /**
   * Tool and skill identifiers the creator chose NOT to grant: dismissed from
   * the "new on this Agent" prompt, or unticked in a picker. Grants nothing and
   * revokes nothing explicit — the server gate reads it only to keep these
   * identifiers out of {@link autoGrantAgentTools}. Otherwise it only stops the
   * share settings from offering these identifiers again as newly added to the
   * Agent.
   * Absent on shares created before the prompt existed, so their ungranted
   * Agent tools surface once for review instead of being granted silently.
   */
  declinedGrantIds?: string[];
  /** Visitor trial scenarios, maintained independently of agents.openingQuestions. */
  demoCases?: AgentShareDemoCase[];
  /**
   * Which visitors may run on the Agent's configured execution environment
   * (its bound or auto-selected device):
   *
   * - `none` (default): no visitor reaches a device; device tools are dropped
   *   and a local CLI (Claude Code, Codex, …) Agent refuses the run.
   * - `allowlist`: only the people in {@link deviceAllowUserIds} who are
   *   still in the Agent's address book. They get the device tools and, for a
   *   heterogeneous Agent, run it on the device.
   * - `contacts`: everyone currently in the Agent's address book, so a creator
   *   can prepare the share before someone joins: they can use it as soon as
   *   they are added, and lose it when removed.
   *
   * There is no "every visitor" value: a stranger never reaches the creator's
   * machine. The visitor never picks the device — it always follows the
   * Agent's own execution-environment setting. Resolved per run by
   * `resolveShareVisitorDeviceAccess`.
   */
  deviceAccess?: AgentShareDeviceAccess;
  /**
   * User ids allowed to use the device when {@link deviceAccess} is
   * `allowlist`; ignored otherwise. Each must be in the address book of the
   * Agent's scope when written (personal contacts for a personal Agent; the
   * workspace's members and external contacts for a workspace Agent), and is
   * checked against it again on every run, so removing a contact revokes the
   * grant without editing the share.
   */
  deviceAllowUserIds?: string[];
  /** Ordered, explicitly selected creator Works for this share's public profile. */
  featuredWorkIds?: string[];
  /**
   * Total bytes this share's visitor uploads may occupy in the Agent's owning
   * scope (settled files plus in-flight reservations). Mandatory like
   * `monthlySpendLimit` — normalized to a default, never cleared; `0` turns
   * visitor attachments off entirely. Enforced by `shareChat.createUploadUrl`.
   */
  maxFileStorage?: number;
  /**
   * Messages each signed-in visitor may send to this share in total, across every conversation.
   * Only the visitor's own messages count; the Agent's replies do not.
   */
  maxMessagesPerVisitor?: number;
  /**
   * Per-Agent monthly spend cap for this share, in USD credits.
   *
   * Mandatory: `normalizeAgentShareConfig` fills a default for any row that
   * lacks one, so every read path through `AgentShareModel` sees a number —
   * see {@link NormalizedAgentShareConfig}. A share manager can move the number
   * but can never clear it. A cap of `0` is a real lower bound meaning "stop
   * all visitor runs", never "unlimited".
   *
   * Billing enforcement for this cap lives in the Cloud repo (business slot);
   * the OSS schema only carries the configured value.
   */
  monthlySpendLimit?: number;
  /**
   * Set only by `AgentShareModel.create` when it inserts a brand-new share:
   * the creator share settings then grant the Agent's usable tools and skills
   * once and write `false`. Persisted on the row rather than kept in client
   * state, so the default lands on exactly the share that was created — never
   * on an existing share another tab or manager configured, nor on a different
   * Agent the page navigated to. The server gate never reads it.
   */
  seedDefaultGrants?: boolean;
  /**
   * Skills visitors may load, by skill identifier. Deliberately separate from
   * {@link toolGrants}: a skill grant governs BOTH the tool path
   * (`lobe-skills.activateSkill` / `readReference`) and the no-tool path (a
   * pinned skill's body is injected straight into context, see
   * `operationPrep`'s pinned-content branch), so it cannot hang off a tool
   * entry that may legitimately be absent.
   *
   * Default-closed: absent or empty grants nothing, non-empty grants exactly
   * these skills. `toolGrants` is never read as a skill list — tool and skill
   * ids share one namespace, so a plain tool grant must not be mistaken for a
   * skill grant (see `filterSkillsByShareGate`).
   */
  skillGrants?: string[];
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
 * `AgentShareConfig` as returned by `normalizeAgentShareConfig`: the caps are
 * guaranteed present, so enforcement paths never have to re-derive a
 * default (and can never mistake a missing cap for "unlimited").
 */
export type NormalizedAgentShareConfig = AgentShareConfig & {
  maxFileStorage: number;
  maxMessagesPerVisitor: number;
  monthlySpendLimit: number;
};

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

    visibility: text('visibility').$type<AgentShareVisibility>().default('private').notNull(),

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

/**
 * The people a share admits besides its link: each added the Agent from a card its owner shared
 * into a Channel they are in, until the owner revokes them. A `card` share admits only them;
 * pausing the share pauses them too,
 * and a replaced share (deleted, or its Agent recreated) starts with none.
 */
export const agentShareGrants = pgTable(
  'agent_share_grants',
  {
    // Only ever addressed through the share and the person, so no id prefix.
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    shareId: uuid('share_id')
      .references(() => agentShares.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    source: jsonb('source').$type<AgentShareGrantSource>().notNull(),
    /**
     * Set when the owner withdrew the grant. The row is kept so a card sent before the withdrawal
     * cannot restore it; only a card the owner sends afterwards does.
     */
    revokedAt: timestamptz('revoked_at'),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_share_grants_share_user_unique').on(t.shareId, t.userId),
    // Serves the cascade from users.
    index('agent_share_grants_user_id_idx').on(t.userId),
  ],
);

export type AgentShareGrantRow = typeof agentShareGrants.$inferSelect;
