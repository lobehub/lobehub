import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import type { DispatchNightlyReviewRequestsOptions } from '@/server/services/agentSignal/services';
import { createServerNightlyReviewScheduleService } from '@/server/services/agentSignal/services';

const DEFAULT_USER_LIMIT = 500;
const DEFAULT_TARGET_LIMIT = 20;
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
   * Maximum eligible users to scan in one dispatch pass.
   *
   * @default 500
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

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> => {
  return typeof value === 'object' && value !== null;
};

const readPositiveInteger = (value: unknown, fallback: number) => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
};

const readWhitelist = (value: unknown) => {
  if (!Array.isArray(value)) return;

  const whitelist = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );

  return whitelist.length > 0 ? whitelist : undefined;
};

const readCursor = (value: unknown): DispatchNightlyReviewRequestsOptions['cursor'] | undefined => {
  if (!isRecord(value)) return;

  const createdAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : undefined;
  const id = typeof value.id === 'string' && value.id ? value.id : undefined;

  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return;

  return { createdAt, id };
};

const readPayload = async (c: Context): Promise<ScheduleNightlyReviewPayload> => {
  const body = (await c.req.json().catch(() => ({}))) as unknown;

  return isRecord(body) ? body : {};
};

/**
 * Dispatches Agent Signal nightly review request sources from a QStash cron call.
 *
 * Use when:
 * - A QStash Schedule or local QStash publish call needs to fan out nightly review source events
 * - Cron should enqueue source events but leave actual review execution to Agent Signal workflows
 *
 * Expects:
 * - The route is protected by {@link qstashAuth} in `agent-signal/index.ts`
 * - QStash or the caller may omit a JSON body, in which case bounded defaults are used
 *
 * Returns:
 * - A JSON summary with enqueue and skip counts
 *
 * Call stack:
 *
 * scheduleNightlyReview
 *   -> {@link createServerNightlyReviewScheduleService}
 *     -> dispatchNightlyReviewRequests
 *       -> enqueueAgentSignalSourceEvent
 */
export async function scheduleNightlyReview(c: Context) {
  return tracer.startActiveSpan(CRON_SPAN_NAME, async (span) => {
    try {
      const payload = await readPayload(c);
      const options = {
        cursor: readCursor(payload.cursor),
        limit: readPositiveInteger(payload.limit, DEFAULT_USER_LIMIT),
        targetLimit: readPositiveInteger(payload.targetLimit, DEFAULT_TARGET_LIMIT),
        whitelist: readWhitelist(payload.whitelist),
      } satisfies DispatchNightlyReviewRequestsOptions;

      span.setAttributes({
        'agent.signal.cron.limit': options.limit,
        'agent.signal.cron.target_limit': options.targetLimit,
        'agent.signal.cron.whitelist_count': options.whitelist?.length ?? 0,
        ...(options.cursor
          ? {
              'agent.signal.cron.cursor_created_at': options.cursor.createdAt.toISOString(),
              'agent.signal.cron.cursor_user_id': options.cursor.id,
            }
          : {}),
      });

      const db = await getServerDB();
      const service = createServerNightlyReviewScheduleService(db);
      const summary = await service.dispatchNightlyReviewRequests(options);

      span.setAttributes({
        'agent.signal.cron.enqueued': summary.enqueued,
        'agent.signal.cron.skipped': summary.skipped,
        'agent.signal.cron.success': true,
      });
      span.setStatus({ code: SpanStatusCode.OK });

      return c.json({ success: true, ...summary });
    } catch (error) {
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
