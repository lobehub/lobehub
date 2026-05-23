import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';

import { agents, messagePlugins, messages, topics, users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

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
  /** User creation time used as the primary cursor key. */
  createdAt: Date;
  /** User id used as the tie-break cursor key. */
  id: string;
}

/** Options for listing users eligible for AgentSignal nightly review scheduling. */
export interface ListAgentSignalNightlyReviewUsersOptions {
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
 * - User-level AgentSignal lab preference is stored on `users.preference.lab`
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
   * Lists users who opted into AgentSignal self-iteration and have a timezone.
   *
   * Use when:
   * - The nightly scheduler needs a stable cursor over possible users
   * - Backfills need to restrict scheduling to a user allowlist
   *
   * Expects:
   * - Global feature gates are checked by the service layer
   * - Missing user timezone falls back to UTC
   *
   * Returns:
   * - Users sorted by `createdAt, id` for deterministic pagination
   */
  listEligibleUsers = (options: ListAgentSignalNightlyReviewUsersOptions = {}) => {
    const cursorCondition = options.cursor
      ? or(
          gt(users.createdAt, options.cursor.createdAt),
          and(eq(users.createdAt, options.cursor.createdAt), gt(users.id, options.cursor.id)),
        )
      : undefined;

    const whitelistCondition =
      options.whitelist && options.whitelist.length > 0
        ? inArray(users.id, options.whitelist)
        : undefined;

    const selfIterationEnabledCondition = sql`
      COALESCE((${users.preference}->'lab'->>'enableAgentSelfIteration')::boolean, false) = true
    `;

    const query = this.db
      .select({
        createdAt: users.createdAt,
        id: users.id,
        timezone: sql<string>`COALESCE(${userSettings.general}->>'timezone', 'UTC')`,
      })
      .from(users)
      .leftJoin(userSettings, eq(users.id, userSettings.id))
      .where(and(cursorCondition, whitelistCondition, selfIterationEnabledCondition))
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
  listActiveAgentTargets = (
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
        timezone: sql<string>`COALESCE(${userSettings.general}->>'timezone', 'UTC')`,
        title: agents.title,
        topicCount: countDistinct(messages.topicId),
      })
      .from(messages)
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, userId)))
      .innerJoin(agents, and(eq(agents.id, effectiveAgentId), eq(agents.userId, userId)))
      .leftJoin(userSettings, eq(userSettings.id, userId))
      .leftJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, userId)),
      )
      .where(
        and(
          eq(messages.userId, userId),
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
      .groupBy(agents.id, agents.title, userSettings.general)
      .orderBy(sql`MAX(${messages.createdAt}) DESC`);

    return options.limit !== undefined ? query.limit(options.limit) : query;
  };
}
