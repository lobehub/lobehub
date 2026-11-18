/**
 * What drives this deployment's recurring workflow schedules: the cron task
 * dispatcher, the goal sweep and the inbound webhook sweep.
 *
 * - `qstash`: `QSTASH_TOKEN` is set, so QStash Schedules call the workflow routes
 *   (registered by `scripts/serverLauncher/startServer.js` in Docker).
 * - `builtin`: no QStash, but this is a long-running Node server, so the
 *   in-process scheduler (`./index.ts`) runs them.
 * - `unconfigured`: neither. Serverless runtimes lose in-process timers between
 *   requests, and `next dev` only runs the scheduler when `ENABLE_SCHEDULER_IN_DEV=1`
 *   (a dev server pointed at a shared database would otherwise run other people's
 *   schedules). Cron-pattern tasks are saved but never start.
 */
export type ScheduledTaskDispatch = 'builtin' | 'qstash' | 'unconfigured';

type DispatchEnv = Partial<
  Record<
    'DATABASE_URL' | 'ENABLE_SCHEDULER_IN_DEV' | 'NODE_ENV' | 'QSTASH_TOKEN' | 'VERCEL_ENV',
    string
  >
>;

export const getScheduledTaskDispatch = (
  env: DispatchEnv = process.env as DispatchEnv,
): ScheduledTaskDispatch => {
  if (env.QSTASH_TOKEN) return 'qstash';
  // Schedules live in the server database; without one there is nothing to run.
  if (!env.DATABASE_URL) return 'unconfigured';
  if (env.VERCEL_ENV) return 'unconfigured';
  if (env.NODE_ENV !== 'production' && env.ENABLE_SCHEDULER_IN_DEV !== '1') return 'unconfigured';
  return 'builtin';
};
