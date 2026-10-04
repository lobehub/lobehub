import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { createWidgetSandboxRunner } from '@/server/services/widget/sandbox';
import { runDispatchedWidget } from '@/server/services/widget/scheduler';

interface RunWidgetPayload {
  /** The `next_run_at` the widget was due at when the tick dispatched it (ISO). */
  slot?: string;
  widgetId?: string;
}

/**
 * Queued half of a scheduled widget run. The tick dispatches `{ widgetId, slot }`
 * without claiming; this handler claims the slot and runs the widget only when
 * the claim wins. QStash delivers at least once, so a redelivered message for
 * an already-claimed slot is acknowledged (2xx) without running anything.
 */
export async function runWidget(c: Context) {
  try {
    const { slot, widgetId } = ((await c.req.json().catch(() => ({}))) ?? {}) as RunWidgetPayload;
    if (!widgetId) return c.json({ error: 'widgetId is required' }, 400);

    // Messages from before slot claiming moved here carry no slot. Their tick
    // already claimed the slot, so running would be the duplicate; ack them.
    const slotDate = typeof slot === 'string' ? new Date(slot) : undefined;
    if (!slotDate || Number.isNaN(slotDate.getTime())) {
      return c.json({ skipped: 'missing-slot', success: true });
    }

    const db = await getServerDB();
    const result = await runDispatchedWidget(
      db,
      { slot: slotDate, widgetId },
      { runner: createWidgetSandboxRunner() },
    );
    if (result.skipped) return c.json({ skipped: result.skipped, success: true });

    return c.json({ runId: result.run?.id, status: result.run?.status, success: true });
  } catch (error) {
    console.error('[widget/run-widget] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
