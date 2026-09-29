import type { Context } from 'hono';

import { DashboardWidgetModel } from '@/database/models/dashboardWidget';
import { getServerDB } from '@/database/server';
import { DashboardSandboxRunner } from '@/server/services/dashboard/sandboxRunner';
import { runScheduledWidget } from '@/server/services/dashboard/scheduler';

/**
 * Queued half of a scheduled widget run: the tick already claimed the slot,
 * this executes the widget's current published version.
 */
export async function runWidget(c: Context) {
  try {
    const { widgetId } = ((await c.req.json().catch(() => ({}))) ?? {}) as { widgetId?: string };
    if (!widgetId) return c.json({ error: 'widgetId is required' }, 400);

    const db = await getServerDB();
    const target = await DashboardWidgetModel.findLiveWithPublishedVersion(db, widgetId);
    // Trashed or unpublished since the tick: nothing to run, and nothing to retry.
    if (!target) return c.json({ skipped: true, success: true });

    const run = await runScheduledWidget(db, target, {
      runner: DashboardSandboxRunner.fromEnv(),
    });

    return c.json({ runId: run?.id, status: run?.status, success: true });
  } catch (error) {
    console.error('[dashboard/run-widget] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
