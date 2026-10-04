import type { Context } from 'hono';

import { WidgetModel } from '@/database/models/widget';
import { getServerDB } from '@/database/server';
import { createWidgetSandboxRunner } from '@/server/services/widget/sandbox';
import { runScheduledWidget } from '@/server/services/widget/scheduler';

/**
 * Queued half of a scheduled widget run: the tick already claimed the slot,
 * this executes the widget's current published version.
 */
export async function runWidget(c: Context) {
  try {
    const { widgetId } = ((await c.req.json().catch(() => ({}))) ?? {}) as { widgetId?: string };
    if (!widgetId) return c.json({ error: 'widgetId is required' }, 400);

    const db = await getServerDB();
    const target = await WidgetModel.findLiveWithPublishedVersion(db, widgetId);
    // Trashed or unpublished since the tick: nothing to run, and nothing to retry.
    if (!target) return c.json({ skipped: true, success: true });

    const run = await runScheduledWidget(db, target, { runner: createWidgetSandboxRunner() });

    return c.json({ runId: run?.id, status: run?.status, success: true });
  } catch (error) {
    console.error('[widget/run-widget] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
