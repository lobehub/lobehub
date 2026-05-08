import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import dayjs from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { AgentSignalNightlyReviewModel } from '@/database/models/agentSignal/nightlyReview';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal/emitter';

import { buildNightlyReviewSourceId } from './types';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const FALLBACK_TIMEZONE = 'UTC';
const NIGHT_WINDOW_START_HOUR = 2;
const NIGHT_WINDOW_END_HOUR_EXCLUSIVE = 4;

/** Active agent target returned by the nightly review scheduler data boundary. */
export interface NightlyReviewAgentTarget {
  /** Agent id that should receive one nightly review source event. */
  agentId: string;
}

/** User candidate returned by the nightly review scheduler data boundary. */
export interface NightlyReviewEligibleUser {
  /** User creation time used by stable scheduler pagination. */
  createdAt?: Date;
  /** Stable user id. */
  id: string;
  /** IANA timezone for local night-window evaluation. */
  timezone?: string | null;
}

/** Cursor for stable nightly review user pagination. */
export interface NightlyReviewScheduleCursor {
  /** User creation time used as the primary cursor key. */
  createdAt: Date;
  /** User id used as the tie-break cursor key. */
  id: string;
}

/** Options for listing users during one nightly review dispatch pass. */
export interface ListNightlyReviewEligibleUsersInput {
  /** Cursor returned by the previous scheduler page. */
  cursor?: NightlyReviewScheduleCursor;
  /** Maximum eligible users to return. */
  limit?: number;
  /** Optional allowlist for targeted backfills or tests. */
  whitelist?: string[];
}

/** Options for listing one user's active review targets in a UTC window. */
export interface ListNightlyReviewAgentTargetsInput {
  /** Maximum active agents to return. */
  limit?: number;
  /** User id whose active agents should be listed. */
  userId: string;
  /** Review window end in UTC. */
  windowEnd: Date;
  /** Review window start in UTC. */
  windowStart: Date;
}

/** Queue and read adapters used by the pure nightly review scheduler service. */
export interface NightlyReviewScheduleAdapters {
  /**
   * Enqueues one AgentSignal source event for later handler execution.
   *
   * @default Server adapter uses {@link enqueueAgentSignalSourceEvent}
   */
  enqueueSource: (
    input: AgentSignalSourceEventInput<'agent.nightly_review.requested'>,
  ) => Promise<unknown>;
  /** Lists active self-iteration agent targets for one user and review window. */
  listActiveAgentTargets: (
    input: ListNightlyReviewAgentTargetsInput,
  ) => Promise<NightlyReviewAgentTarget[]>;
  /** Lists user candidates eligible for nightly review scheduling. */
  listEligibleUsers: (
    input?: ListNightlyReviewEligibleUsersInput,
  ) => Promise<NightlyReviewEligibleUser[]>;
  /**
   * Supplies the scheduler dispatch time.
   *
   * @default Uses the current wall-clock time when omitted.
   */
  now?: () => Date;
}

/** Options for one nightly review dispatch pass. */
export interface DispatchNightlyReviewRequestsOptions extends ListNightlyReviewEligibleUsersInput {
  /** Maximum active agents to enqueue for each eligible in-window user. */
  targetLimit?: number;
}

/** Summary returned by one nightly review dispatch pass. */
export interface NightlyReviewScheduleSummary {
  /** Number of source events successfully requested for enqueue. */
  enqueued: number;
  /** Number of eligible users skipped because their local time is outside the night window. */
  skipped: number;
}

/** Nightly review scheduler service API. */
export interface NightlyReviewScheduleService {
  /**
   * Dispatches nightly review request sources for users currently in their local night window.
   *
   * Use when:
   * - A shared cron or QStash schedule performs one central dispatch pass
   * - Cron should only produce source events and leave review execution to AgentSignal handlers
   *
   * Expects:
   * - Adapters return users and targets without side effects except `enqueueSource`
   * - `now` is a UTC instant shared by all users in the pass
   *
   * Returns:
   * - A summary with enqueue and skip counts for observability
   */
  dispatchNightlyReviewRequests: (
    options?: DispatchNightlyReviewRequestsOptions,
  ) => Promise<NightlyReviewScheduleSummary>;
}

interface LocalNightWindow {
  localDate: string;
  reviewWindowEnd: Date;
  reviewWindowStart: Date;
  timezone: string;
  withinWindow: boolean;
}

export { buildNightlyReviewSourceId } from './types';

const resolveTimezone = (timezone: string | null | undefined): string => {
  if (!timezone) return FALLBACK_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
};

const getLocalNightWindow = (now: Date, timezone: string | null | undefined): LocalNightWindow => {
  const resolvedTimezone = resolveTimezone(timezone);
  const localNow = dayjs(now).tz(resolvedTimezone);
  const reviewDate = localNow.subtract(1, 'day').format('YYYY-MM-DD');
  const localDayStart = dayjs.tz(localNow.format('YYYY-MM-DD'), resolvedTimezone).startOf('day');
  const localHour = localNow.hour();

  return {
    localDate: reviewDate,
    reviewWindowEnd: localDayStart.toDate(),
    reviewWindowStart: localDayStart.subtract(1, 'day').toDate(),
    timezone: resolvedTimezone,
    withinWindow:
      localHour >= NIGHT_WINDOW_START_HOUR && localHour < NIGHT_WINDOW_END_HOUR_EXCLUSIVE,
  };
};

/**
 * Creates a pure nightly review scheduler service from queue and read adapters.
 *
 * Use when:
 * - Tests need deterministic time and mocked storage/queue adapters
 * - Server code needs a cron-safe service that emits only AgentSignal sources
 *
 * Expects:
 * - `listEligibleUsers` reads timezone fresh for each dispatch pass
 * - Invalid timezone values can be safely normalized to UTC
 *
 * Returns:
 * - A scheduler service with one dispatch method
 */
export const createNightlyReviewScheduleService = (
  adapters: NightlyReviewScheduleAdapters,
): NightlyReviewScheduleService => {
  return {
    dispatchNightlyReviewRequests: async (options = {}) => {
      return tracer.startActiveSpan(
        'agent_signal.nightly_review.schedule.dispatch',
        {
          attributes: {
            'agent.signal.nightly.limit': options.limit ?? 0,
            'agent.signal.nightly.target_limit': options.targetLimit ?? 0,
            'agent.signal.nightly.whitelist_count': options.whitelist?.length ?? 0,
          },
        },
        async (span) => {
          try {
            const now = adapters.now?.() ?? new Date();
            const users = await adapters.listEligibleUsers({
              cursor: options.cursor,
              limit: options.limit,
              whitelist: options.whitelist,
            });
            let enqueued = 0;
            let skipped = 0;
            let targetCount = 0;

            for (const user of users) {
              const localWindow = getLocalNightWindow(now, user.timezone);

              if (!localWindow.withinWindow) {
                skipped += 1;
                continue;
              }

              const targets = await adapters.listActiveAgentTargets({
                limit: options.targetLimit,
                userId: user.id,
                windowEnd: localWindow.reviewWindowEnd,
                windowStart: localWindow.reviewWindowStart,
              });

              targetCount += targets.length;

              for (const target of targets) {
                await adapters.enqueueSource({
                  payload: {
                    agentId: target.agentId,
                    localDate: localWindow.localDate,
                    requestedAt: now.toISOString(),
                    reviewWindowEnd: localWindow.reviewWindowEnd.toISOString(),
                    reviewWindowStart: localWindow.reviewWindowStart.toISOString(),
                    timezone: localWindow.timezone,
                    userId: user.id,
                  },
                  sourceId: buildNightlyReviewSourceId({
                    agentId: target.agentId,
                    localDate: localWindow.localDate,
                    userId: user.id,
                  }),
                  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
                  timestamp: now.getTime(),
                });
                enqueued += 1;
              }
            }

            span.setAttribute('agent.signal.nightly.user_count', users.length);
            span.setAttribute('agent.signal.nightly.target_count', targetCount);
            span.setAttribute('agent.signal.nightly.enqueued', enqueued);
            span.setAttribute('agent.signal.nightly.skipped', skipped);
            span.setStatus({ code: SpanStatusCode.OK });

            return { enqueued, skipped };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal nightly review schedule dispatch failed',
            });
            span.recordException(error as Error);

            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
};

/**
 * Creates the server nightly review scheduler service.
 *
 * Use when:
 * - Cron or QStash dispatch code needs database-backed target discovery
 * - Server should enqueue AgentSignal source events without running review handlers inline
 *
 * Expects:
 * - `db` points at the main LobeChat database
 *
 * Returns:
 * - A scheduler service wired to {@link AgentSignalNightlyReviewModel} and AgentSignal enqueueing
 */
export const createServerNightlyReviewScheduleService = (
  db: LobeChatDatabase,
): NightlyReviewScheduleService => {
  const model = new AgentSignalNightlyReviewModel(db);

  return createNightlyReviewScheduleService({
    enqueueSource: (input) =>
      enqueueAgentSignalSourceEvent(input, {
        agentId: input.payload.agentId,
        userId: input.payload.userId,
      }),
    listActiveAgentTargets: ({ limit, userId, windowEnd, windowStart }) =>
      model.listActiveAgentTargets(userId, {
        limit,
        windowEnd,
        windowStart,
      }),
    listEligibleUsers: (input) => model.listEligibleUsers(input),
  });
};
