import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { createDefaultNumberServices } from '@/server/services/agentIdentity/providers';

const log = debug('lobe-server:agent:number-maintenance');

const TASKS = ['pool', 'eligibility', 'fees', 'release'] as const;
type Task = (typeof TASKS)[number];

/**
 * Cron entry point for dedicated agent numbers, per configured carrier:
 *
 * - `pool` — top the warm pool up to `AGENT_NUMBER_POOL_SIZE` per area code;
 * - `eligibility` — re-read each assigned number's 10DLC standing, so outbound
 *   opens (and only opens) once the carrier approved the campaign;
 * - `fees` — bill this month's number fee to each owning agent (idempotent);
 * - `release` — return numbers whose quarantine ended to the carrier.
 *
 * Auth: `bearerSecretAuth(CRON_SECRET)` on the route. `?tasks=release,fees`
 * runs a subset (manual runs, incident response).
 */
export async function agentNumberMaintenance(c: Context): Promise<Response> {
  const requested = c.req.query('tasks');
  const tasks = new Set<Task>(
    requested
      ? (requested
          .split(',')
          .filter((task): task is Task => TASKS.includes(task as Task)) as Task[])
      : TASKS,
  );

  try {
    const db = await getServerDB();
    const services = createDefaultNumberServices(db);
    const results: Record<string, unknown>[] = [];

    for (const service of services) {
      const result: Record<string, unknown> = { provider: service.carrier.name };
      if (tasks.has('pool')) result.pool = await service.replenishPool();
      if (tasks.has('eligibility')) result.eligibility = await service.refreshAllEligibility();
      if (tasks.has('fees')) result.fees = await service.chargeMonthlyFees();
      if (tasks.has('release')) result.release = await service.releaseExpired();
      results.push(result);
    }

    log('maintenance done: %O', results);
    return c.json({ results, success: true, tasks: [...tasks] });
  } catch (error) {
    console.error('[agent-number-maintenance] %O', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'unknown error', success: false },
      500,
    );
  }
}
