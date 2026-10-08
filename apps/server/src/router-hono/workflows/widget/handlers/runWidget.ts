import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { createWidgetSandboxRunner } from '@/server/services/widget/sandbox';
import {
  type DispatchedWidgetResult,
  resumeDispatchedRun,
  runDispatchedWidget,
} from '@/server/services/widget/scheduler';

interface RunWidgetPayload {
  /** Resume message: the lease the run was judged stale under (ISO); part of its dedup id. */
  leaseStartedAt?: string;
  /** Resume message: the abandoned reserved run to take over. */
  runId?: string;
  /** Slot message: the `next_run_at` the widget was due at when the tick dispatched it (ISO). */
  slot?: string;
  widgetId?: string;
}

/**
 * Queued half of a scheduled widget run. Two messages arrive here:
 *
 * - `{ widgetId, slot }` — a due slot. The handler claims it (advancing
 *   `next_run_at` and reserving the run in one transaction) and executes the
 *   reserved run. QStash delivers at least once: a redelivery for an
 *   already-claimed slot resumes the reservation only when its lease expired
 *   (the first worker died), otherwise it is acknowledged (2xx) untouched.
 * - `{ widgetId, runId, leaseStartedAt }` — a stale reservation found by the
 *   tick's sweep, resumed if nobody took it over meanwhile.
 */
export async function runWidget(c: Context) {
  try {
    const { runId, slot, widgetId } = ((await c.req.json().catch(() => ({}))) ??
      {}) as RunWidgetPayload;
    if (!widgetId) return c.json({ error: 'widgetId is required' }, 400);

    const deps = { runner: createWidgetSandboxRunner() };
    let result: DispatchedWidgetResult;

    if (typeof runId === 'string') {
      result = await resumeDispatchedRun(await getServerDB(), { runId, widgetId }, deps);
    } else {
      // Messages from before slot claiming moved here carry no slot. Their tick
      // already claimed the slot, so running would be the duplicate; ack them.
      const slotDate = typeof slot === 'string' ? new Date(slot) : undefined;
      if (!slotDate || Number.isNaN(slotDate.getTime())) {
        return c.json({ skipped: 'missing-slot', success: true });
      }
      result = await runDispatchedWidget(await getServerDB(), { slot: slotDate, widgetId }, deps);
    }

    if (result.skipped) return c.json({ skipped: result.skipped, success: true });

    return c.json({
      ...(result.resumed && { resumed: true }),
      runId: result.run?.id,
      status: result.run?.status,
      success: true,
    });
  } catch (error) {
    console.error('[widget/run-widget] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
