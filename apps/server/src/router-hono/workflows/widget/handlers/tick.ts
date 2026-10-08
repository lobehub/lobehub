import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { qstashClient, toQStashDeduplicationId } from '@/libs/qstash';
import { createWidgetSandboxRunner } from '@/server/services/widget/sandbox';
import {
  isWidgetResumeTarget,
  runWidgetSchedulerTick,
  type WidgetDispatchTarget,
} from '@/server/services/widget/scheduler';

export const RUN_WIDGET_PATH = '/api/workflows/widget/run-widget';

/** Logical run key per due slot; encoded for QStash at the publish boundary. */
export const widgetRunDeduplicationId = (widgetId: string, slotIso: string) =>
  `widget:${widgetId}:${slotIso}`;

/** One resume per lease: a run that is resumed and abandoned again gets a new id. */
export const widgetResumeDeduplicationId = (runId: string, leaseStartedAtIso: string) =>
  `widget-run:${runId}:${leaseStartedAtIso}`;

interface TickPayload {
  /** Only report how many widgets are due. */
  dryRun?: boolean;
  limit?: number;
}

/**
 * Widget scheduler tick. Registered as a QStash Schedule (`lobe-widget-tick`,
 * see `scripts/serverLauncher/startServer.js`). In queue mode each due slot is
 * published to `run-widget` as `{ widgetId, slot }` (deduplicated per slot) and
 * that handler claims it before running, and each stale reservation (a run
 * whose worker died past its lease) as `{ widgetId, runId, leaseStartedAt }`
 * (deduplicated per lease) for that handler to resume; inline, the tick
 * claims, resumes and runs itself.
 *
 * Trigger a tick by hand against a local server (the script signs the
 * request when `QSTASH_CURRENT_SIGNING_KEY` is set, as `qstashAuth` then
 * requires):
 *
 *   SERVER_URL=http://localhost:3010 bun run widget:tick [--dry-run]
 */
export async function tick(c: Context) {
  try {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as TickPayload;
    const db = await getServerDB();

    const dispatch = appEnv.enableQueueAgentRuntime
      ? async (target: WidgetDispatchTarget) => {
          if (!process.env.APP_URL) {
            throw new Error('APP_URL is required to fan out widget runs via QStash');
          }
          const url = `${process.env.APP_URL.replace(/\/$/, '')}${RUN_WIDGET_PATH}`;

          if (isWidgetResumeTarget(target)) {
            const leaseStartedAt = target.leaseStartedAt.toISOString();
            await qstashClient.publishJSON({
              body: { leaseStartedAt, runId: target.runId, widgetId: target.widgetId },
              // Overlapping ticks see the same stale lease; publish it once.
              deduplicationId: toQStashDeduplicationId(
                widgetResumeDeduplicationId(target.runId, leaseStartedAt),
              ),
              url,
            });
            return;
          }

          const slotIso = target.slot.toISOString();
          await qstashClient.publishJSON({
            body: { slot: slotIso, widgetId: target.widgetId },
            // Overlapping ticks see the same unclaimed slot; publish it once.
            deduplicationId: toQStashDeduplicationId(
              widgetRunDeduplicationId(target.widgetId, slotIso),
            ),
            url,
          });
        }
      : undefined;

    const result = await runWidgetSchedulerTick(
      db,
      { runner: createWidgetSandboxRunner() },
      { dispatch, dryRun: body.dryRun, limit: body.limit },
    );

    return c.json({ ...result, success: true });
  } catch (error) {
    console.error('[widget/tick] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
