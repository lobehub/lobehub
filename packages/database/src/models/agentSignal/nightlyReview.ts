import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agents, messagePlugins, messages, topics, users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { normalizeInboxAgentTitle } from '../../utils/inboxAgent';
import { notShareVisitorMessage } from '../../utils/shareVisitor';

/** Restores the cursor timestamp inside PostgreSQL so workflow JSON never truncates its precision. */
const cursorUsers = alias(users, 'nightly_review_cursor_users');

/**
 * Normalizes database aggregate timestamps.
 *
 * Before:
 * - "2026-05-03 14:00:00+00"
 *
 * After:
 * - Date("2026-05-03T14:00:00.000Z")
 */
const parseAggregateTimestamp = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

/** Cursor for stable user pagination in AgentSignal nightly review scheduling. */
export interface ListAgentSignalNightlyReviewUsersCursor {
  /** User creation time retained in the serialized checkpoint for observability. */
  createdAt: Date;
  /** User id used to restore the exact database cursor tuple. */
  id: string;
}

/** Options for listing users eligible for AgentSignal nightly review scheduling. */
export interface ListAgentSignalNightlyReviewUsersOptions {
  /**
   * Coarse activity floor. Only users with at least one non-workspace message at or after
   * this instant are candidates.
   *
   * This is deliberately a superset of every per-user review window: the precise window is
   * still applied by {@link AgentSignalNightlyReviewModel.listActiveAgentTargets}, so a
   * generous floor here can only cost a skipped dispatch, never a missed review.
   */
  activeSince?: Date;
  /** Cursor returned by the previous page. */
  cursor?: ListAgentSignalNightlyReviewUsersCursor;
  /** Maximum users to return. */
  limit?: number;
  /** Optional user allowlist for backfills, tests, and targeted runs. */
  whitelist?: string[];
}

/** One user candidate for AgentSignal nightly review scheduling. */
export interface AgentSignalNightlyReviewUserCandidate {
  /** Creation time used for cursor pagination. */
  createdAt: Date;
  /** Stable user id. */
  id: string;
  /** IANA timezone from user general settings, defaulting to UTC when missing. */
  timezone: string;
}

/** Options for listing active agent review targets for one user and one review window. */
export interface ListAgentSignalNightlyReviewTargetsOptions {
  /** Optional single-agent filter for handler-side source validation. */
  agentId?: string;
  /** Maximum active agents to return. */
  limit?: number;
  /** Review window end in UTC. */
  windowEnd: Date;
  /** Review window start in UTC. */
  windowStart: Date;
}

/** One active agent target that should receive a nightly review request. */
export interface AgentSignalNightlyReviewTarget {
  /** Agent id receiving the nightly source event. */
  agentId: string;
  /** Number of failed tool call records observed in the review window. */
  failedToolCallCount: number;
  /** First message activity timestamp in the review window. */
  firstActivityAt: Date;
  /** Last message activity timestamp in the review window. */
  lastActivityAt: Date;
  /** Number of messages observed in the review window. */
  messageCount: number;
  /** IANA timezone from user general settings, defaulting to UTC when missing. */
  timezone: string;
  /** Agent title for brief/debug context. */
  title: string | null;
  /** Number of distinct topics touched in the review window. */
  topicCount: number;
}

/**
 * Queries the database surface needed by AgentSignal nightly self-reflection.
 *
 * Use when:
 * - Cron dispatch needs stable user pagination
 * - Nightly review needs active agent targets for a local-day window
 *
 * Expects:
 * - Global feature gates are checked by the service layer
 * - Agent-level opt-in is stored on `agents.chatConfig.selfIteration.enabled`
 *
 * Returns:
 * - Candidate users and active agent targets without emitting source events
 */
export class AgentSignalNightlyReviewModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Lists candidate users with a timezone for nightly review scheduling.
   *
   * Use when:
   * - The nightly scheduler needs a stable cursor over possible users
   * - Backfills need to restrict scheduling to a user allowlist
   *
   * Expects:
   * - Global feature gates are checked by the service layer
   * - Missing user timezone falls back to UTC
   * - `activeSince` is supplied by the scheduler; it is a superset of the per-user review
   *   window re-applied downstream, and it is skipped for whitelist runs
   *
   * Returns:
   * - Users sorted by `createdAt, id` for deterministic pagination
   */
  listEligibleUsers = (options: ListAgentSignalNightlyReviewUsersOptions = {}) => {
    const cursorTuple = options.cursor
      ? this.db
          .select({ createdAt: cursorUsers.createdAt, id: cursorUsers.id })
          .from(cursorUsers)
          .where(eq(cursorUsers.id, options.cursor.id))
          .limit(1)
      : undefined;
    const cursorCondition = options.cursor
      ? sql`(${users.createdAt}, ${users.id}) > (${cursorTuple})`
      : undefined;

    const whitelistCondition =
      options.whitelist && options.whitelist.length > 0
        ? inArray(users.id, options.whitelist)
        : undefined;

    // A whitelist is an explicit, already-bounded target list for backfills and manual runs;
    // narrowing it further would silently drop the very rows the caller asked for.
    const narrow = !whitelistCondition;

    // Driving the activity filter from a `created_at` range keeps this on
    // `messages_created_at_idx`; a per-user `EXISTS` would fall back to `messages_user_id_idx`
    // and re-scan a heavy user's entire history on every page.
    const activeUsers =
      narrow && options.activeSince
        ? this.db
            .selectDistinct({ userId: messages.userId })
            .from(messages)
            .where(and(gte(messages.createdAt, options.activeSince), isNull(messages.workspaceId)))
            .as('nightly_review_active_users')
        : undefined;

    let query = this.db
      .select({
        createdAt: users.createdAt,
        id: users.id,
        timezone: sql<string>`COALESCE(${userSettings.general}->>'timezone', 'UTC')`,
      })
      .from(users)
      .$dynamic();

    if (activeUsers) {
      query = query.innerJoin(activeUsers, eq(activeUsers.userId, users.id));
    }

    query = query
      .leftJoin(userSettings, eq(users.id, userSettings.id))
      .where(and(cursorCondition, whitelistCondition))
      .orderBy(asc(users.createdAt), asc(users.id));

    return options.limit !== undefined ? query.limit(options.limit) : query;
  };

  /**
   * Lists active agent targets for one user's review window.
   *
   * Use when:
   * - The scheduler must avoid running inactive agents
   * - The collector needs coarse activity counts before building digests
   *
   * Expects:
   * - `windowStart` and `windowEnd` are UTC instants for the user's local review date
   * - Message `agentId` wins when present; topic `agentId` covers legacy messages
   * - Virtual agents are excluded except the product-owned Lobe AI inbox agent
   *
   * Returns:
   * - Agent targets with message/topic/failure counts
   */
  listActiveAgentTargets = async (
    userId: string,
    options: ListAgentSignalNightlyReviewTargetsOptions,
  ) => {
    const effectiveAgentId = sql<string>`COALESCE(${messages.agentId}, ${topics.agentId})`;
    const agentFilter = options.agentId ? eq(agents.id, options.agentId) : undefined;

    const query = this.db
      .select({
        agentId: agents.id,
        failedToolCallCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        firstActivityAt: sql<Date>`MIN(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        name: agents.name,
        slug: agents.slug,
        timezone: sql<string>`COALESCE(${userSettings.general}->>'timezone', 'UTC')`,
        title: agents.title,
        topicCount: countDistinct(messages.topicId),
      })
      .from(messages)
      .leftJoin(
        topics,
        and(eq(topics.id, messages.topicId), eq(topics.userId, userId), isNull(topics.workspaceId)),
      )
      .innerJoin(
        agents,
        and(eq(agents.id, effectiveAgentId), eq(agents.userId, userId), isNull(agents.workspaceId)),
      )
      .leftJoin(userSettings, eq(userSettings.id, userId))
      .leftJoin(
        messagePlugins,
        and(
          eq(messagePlugins.id, messages.id),
          eq(messagePlugins.userId, userId),
          isNull(messagePlugins.workspaceId),
        ),
      )
      .where(
        and(
          eq(messages.userId, userId),
          isNull(messages.workspaceId),
          // Share-visitor traffic bills to the creator but is not the
          // creator's own activity — keep it out of the nightly digest.
          notShareVisitorMessage(),
          agentFilter,
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
          or(eq(agents.virtual, false), isNull(agents.virtual), eq(agents.slug, INBOX_SESSION_ID)),
          or(
            eq(agents.slug, INBOX_SESSION_ID),
            sql`COALESCE((${agents.chatConfig}->'selfIteration'->>'enabled')::boolean, false) = true`,
          ),
        ),
      )
      .groupBy(agents.id, agents.title, agents.name, agents.slug, userSettings.general)
      .orderBy(sql`MAX(${messages.createdAt}) DESC`);

    const rows = await (options.limit !== undefined ? query.limit(options.limit) : query);

    return rows.map(({ slug, ...row }) => ({
      ...row,
      title: normalizeInboxAgentTitle(row.title, { slug }),
    }));
  };
}
