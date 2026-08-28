import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import { isRecord } from '@lobechat/utils';
import type { Context } from 'hono';

import {
  AgentSignalNightlyReviewWorkflow,
  type NightlyReviewWorkflowCursor,
} from '@/server/workflows/agentSignal/nightlyReview';

const DEFAULT_USER_PAGE_SIZE = 50;
const HARD_MAX_USER_PAGE_SIZE = 200;
const DEFAULT_TARGET_LIMIT = 20;
const HARD_MAX_TARGET_LIMIT = 50;
const CRON_SPAN_NAME = 'agent_signal.cron.hourly_nightly_self_review';

/**
 * Request body accepted by the Agent Signal nightly review scheduler endpoint.
 */
export interface ScheduleNightlyReviewPayload {
  /** Optional stable user pagination cursor. */
  cursor?: {
    /** ISO timestamp from the last user row in the previous page. */
    createdAt: string;
    /** Stable user id from the last user row in the previous page. */
    id: string;
  };
  /**
   * Maximum eligible users read by each pagination workflow.
   *
   * @default 50
   */
  limit?: number;
  /**
   * Maximum active agents to enqueue per eligible user.
   *
   * @default 20
   */
  targetLimit?: number;
  /** Optional user allowlist for targeted local tests or backfills. */
  whitelist?: string[];
}

const readBoundedPositiveInteger = (value: unknown, fallback: number, maximum: number) => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
};

const readWhitelist = (value: unknown) => {
  if (!Array.isArray(value)) return;

  const whitelist = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );

  return whitelist.length > 0 ? whitelist : undefined;
};

const readCursor = (value: unknown): NightlyReviewWorkflowCursor | undefined => {
  if (!isRecord(value)) return;

  const createdAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : undefined;
  const id = typeof value.id === 'string' && value.id ? value.id : undefined;

  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return;

  return { createdAt: createdAt.toISOString(), id };
};

const readPayload = async (c: Context): Promise<ScheduleNightlyReviewPayload> => {
  const body = (await c.req.json().catch(() => ({}))) as unknown;

  return isRecord(body) ? body : {};
};

/**
 * Starts the layered Agent Signal nightly review scheduler from a QStash cron call.
 *
 * Use when:
 * - A QStash Schedule or local QStash publish call needs to start cursor pagination
 * - Cron must return before database scanning and per-user source enqueueing begin
 *
 * Expects:
 * - The route is protected by {@link qstashAuth} in `agent-signal/index.ts`
 * - QStash or the caller may omit a JSON body, in which case bounded page defaults are used
 *
 * Returns:
 * - HTTP 202 with the root pagination workflow id
 *
 * Call stack:
 *
 * scheduleNightlyReview
 *   -> {@link AgentSignalNightlyReviewWorkflow.triggerPaginateUsers}
 *     -> paginateNightlyReviewUsers
 *       -> executeNightlyReviewUser
 */
export async function scheduleNightlyReview(c: Context) {
  return tracer.startActiveSpan(CRON_SPAN_NAME, async (span) => {
    try {
      const payload = await readPayload(c);
      const options = {
        cursor: readCursor(payload.cursor),
        pageSize: readBoundedPositiveInteger(
          payload.limit,
          DEFAULT_USER_PAGE_SIZE,
          HARD_MAX_USER_PAGE_SIZE,
        ),
        requestedAt: new Date().toISOString(),
        targetLimit: readBoundedPositiveInteger(
          payload.targetLimit,
          DEFAULT_TARGET_LIMIT,
          HARD_MAX_TARGET_LIMIT,
        ),
        whitelist: readWhitelist(payload.whitelist),
      };

      span.setAttributes({
        'agent.signal.cron.limit': options.pageSize,
        'agent.signal.cron.target_limit': options.targetLimit,
        'agent.signal.cron.whitelist_count': options.whitelist?.length ?? 0,
        ...(options.cursor
          ? {
              'agent.signal.cron.cursor_created_at': options.cursor.createdAt,
              'agent.signal.cron.cursor_user_id': options.cursor.id,
            }
          : {}),
      });

      const startedAt = Date.now();
      const result = await AgentSignalNightlyReviewWorkflow.publishPaginateUsersEntry(options);

      span.setAttributes({
        'agent.signal.cron.publish_duration_ms': Date.now() - startedAt,
        'agent.signal.cron.success': true,
        'agent.signal.cron.message_id': result.messageId,
      });
      span.setStatus({ code: SpanStatusCode.OK });

      return c.json({ messageId: result.messageId, scheduled: true, success: true }, 202);
    } catch (error) {
      // This log is the only trace a failed tick leaves behind: a stalled publish used to be
      // killed by Cloudflare at 100s, which produced a 524 with no body and nothing on the server.
      console.error('[agent-signal/cron-hourly-nightly-self-review] Error:', error);
      span.setAttribute('agent.signal.cron.success', false);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Internal error',
      });
      span.recordException(error as Error);

      return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
    } finally {
      span.end();
    }
  });
}
