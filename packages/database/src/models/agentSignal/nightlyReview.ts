import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
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
import { notTrashed } from '../../utils/softDelete';

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

/**
 * Builds the SQL predicate that keeps users whose local hour at `at` is inside the window.
 *
 * `AT TIME ZONE` raises on an unknown zone name, which would fail the whole page, so the zone is
 * checked against `pg_timezone_names` first and unknown zones pass through to the caller's exact
 * check. Missing or empty timezones evaluate as UTC, matching the service-side fallback.
 */
const buildLocalHourCondition = (window: ListAgentSignalNightlyReviewUsersLocalHourWindow) => {
  const timezone = sql`COALESCE(NULLIF(${userSettings.general}->>'timezone', ''), 'UTC')`;
  const at = window.at.toISOString();

  return sql`CASE
    WHEN lower(${timezone}) IN (SELECT lower(name) FROM pg_timezone_names)
      THEN EXTRACT(HOUR FROM (${at}::timestamptz AT TIME ZONE ${timezone})) >= ${window.startHour}
        AND EXTRACT(HOUR FROM (${at}::timestamptz AT TIME ZONE ${timezone})) < ${window.endHourExclusive}
    ELSE true
  END`;
};

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
  /**
   * Coarse local-hour prefilter evaluated in each user's stored timezone.
   *
   * Callers must pass a window that is a superset of the exact window they enforce afterwards:
   * PostgreSQL's tzdata build can disagree with `Intl` by an offset change, so this is only a
   * cheap way to drop the users who are clearly not in their night, never the final authority.
   * A timezone PostgreSQL does not recognise is kept rather than evaluated, so a bad stored value
   * can neither fail the page nor be decided here.
   */
  localHourWindow?: ListAgentSignalNightlyReviewUsersLocalHourWindow;
  /** Optional user allowlist for backfills, tests, and targeted runs. */
  whitelist?: string[];
}

/** Local-hour range used to prefilter nightly review candidates inside SQL. */
export interface ListAgentSignalNightlyReviewUsersLocalHourWindow {
  /** UTC instant whose local hour is evaluated for each user. */
  at: Date;
  /** Exclusive local hour upper bound, `startHour < endHourExclusive <= 24`. */
  endHourExclusive: number;
  /** Inclusive local hour lower bound, `0 <= startHour`. */
  startHour: number;
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
 * - The user-level Labs → Self-evolving switch is applied by `listEligibleUsers`
 * - There is no agent-level opt-in; every active non-virtual agent (and Lobe AI) is a target
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
   * - Only users with Labs → Self-evolving on (`preference.lab.enableSelfLearning = true`) are
   *   listed, whitelist runs included; the enqueue path re-checks the same switch
   * - Missing user timezone falls back to UTC
   * - `activeSince` is supplied by the scheduler; it is a superset of the per-user review
   *   window re-applied downstream, and it is skipped for whitelist runs
   * - `localHourWindow`, when supplied, is a superset of the exact local window the scheduler
   *   re-checks; it applies to whitelist runs too, because those users would be skipped anyway
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
            .leftJoin(topics, and(eq(topics.id, messages.topicId), notTrashed(topics.isDeleted)))
            .where(
              and(
                gte(messages.createdAt, options.activeSince),
                isNull(messages.workspaceId),
                notTrashed(messages.isDeleted),
                or(isNull(messages.topicId), isNotNull(topics.id)),
              ),
            )
            .as('nightly_review_active_users')
        : undefined;

    const localHourCondition = options.localHourWindow
      ? buildLocalHourCondition(options.localHourWindow)
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
      .where(
        and(
          // Labs → Self-evolving is the user-level gate for all background self-iteration.
          // Filtering here keeps users who never turned it on out of the fan-out entirely.
          sql`${users.preference}->'lab'->>'enableSelfLearning' = 'true'`,
          cursorCondition,
          whitelistCondition,
          localHourCondition,
        ),
      )
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
        and(
          eq(topics.id, messages.topicId),
          eq(topics.userId, userId),
          isNull(topics.workspaceId),
          notTrashed(topics.isDeleted),
        ),
      )
      .innerJoin(
        agents,
        and(
          eq(agents.id, effectiveAgentId),
          eq(agents.userId, userId),
          isNull(agents.workspaceId),
          notTrashed(agents.isDeleted),
        ),
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
          notTrashed(messages.isDeleted),
          or(isNull(messages.topicId), isNotNull(topics.id)),
          // Share-visitor traffic bills to the creator but is not the
          // creator's own activity — keep it out of the nightly digest.
          notShareVisitorMessage(),
          agentFilter,
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
          or(eq(agents.virtual, false), isNull(agents.virtual), eq(agents.slug, INBOX_SESSION_ID)),
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
