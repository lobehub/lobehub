import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';
import { createWidgetSandboxRunner } from '@/server/services/widget/sandbox';
import { runWidgetSchedulerTick } from '@/server/services/widget/scheduler';

export const RUN_WIDGET_PATH = '/api/workflows/widget/run-widget';

interface TickPayload {
  /** Only report how many widgets are due. */
  dryRun?: boolean;
  limit?: number;
}

/**
 * Widget scheduler tick. Registered as a QStash Schedule (`lobe-widget-tick`,
 * see `scripts/serverLauncher/startServer.js`). Claims every due widget slot,
 * then runs each claimed widget — fanned out through QStash in queue mode so
 * each gets its own invocation, inline otherwise.
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
      ? async (widgetId: string) => {
          if (!process.env.APP_URL) {
            throw new Error('APP_URL is required to fan out widget runs via QStash');
          }
          await qstashClient.publishJSON({
            body: { widgetId },
            url: `${process.env.APP_URL.replace(/\/$/, '')}${RUN_WIDGET_PATH}`,
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
