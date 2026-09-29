import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';
import { DashboardSandboxRunner } from '@/server/services/dashboard/sandboxRunner';
import { runDashboardSchedulerTick } from '@/server/services/dashboard/scheduler';

const RUN_WIDGET_PATH = '/api/workflows/dashboard/run-widget';

interface TickPayload {
  /** Only report how many widgets are due. */
  dryRun?: boolean;
  limit?: number;
}

/**
 * Dashboard widget scheduler tick. Registered as a QStash Schedule
 * (`lobe-dashboard-widget-tick`, see `scripts/serverLauncher/startServer.js`).
 * Claims every due widget slot, then runs each claimed widget — fanned out
 * through QStash in queue mode so each gets its own invocation, inline
 * otherwise.
 *
 * Trigger a tick by hand against a local server (the script signs the
 * request when `QSTASH_CURRENT_SIGNING_KEY` is set, as `qstashAuth` then
 * requires):
 *
 *   SERVER_URL=http://localhost:3010 bun run dashboard:tick [--dry-run]
 */
export async function tick(c: Context) {
  try {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as TickPayload;
    const db = await getServerDB();

    const dispatch = appEnv.enableQueueAgentRuntime
      ? async (widgetId: string) => {
          if (!process.env.APP_URL) {
            throw new Error('APP_URL is required to fan out dashboard widget runs via QStash');
          }
          await qstashClient.publishJSON({
            body: { widgetId },
            url: `${process.env.APP_URL.replace(/\/$/, '')}${RUN_WIDGET_PATH}`,
          });
        }
      : undefined;

    const result = await runDashboardSchedulerTick(
      db,
      { runner: DashboardSandboxRunner.fromEnv() },
      { dispatch, dryRun: body.dryRun, limit: body.limit },
    );

    return c.json({ ...result, success: true });
  } catch (error) {
    console.error('[dashboard/tick] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
