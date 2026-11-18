/**
 * What drives this deployment's recurring workflow schedules: the cron task
 * dispatcher, the goal sweep and the inbound webhook sweep.
 *
 * - `qstash`: QStash Schedules call the workflow routes. That needs a token and
 *   schedules that someone registered: the Docker launcher
 *   (`scripts/serverLauncher/startServer.js`) registers them and marks it with
 *   `QSTASH_SCHEDULES_MANAGED=1`, and an operator who registers them by hand sets
 *   the same flag. On a serverless host QStash is the only option, so a token
 *   counts there.
 * - `builtin`: a long-running Node server with no registered QStash Schedules —
 *   including one that only has a token, for example for the agent runtime
 *   queue — runs them in-process (`./index.ts`).
 * - `unconfigured`: neither. Serverless hosts freeze or reap the process between
 *   requests, and `next dev` only runs the scheduler when `ENABLE_SCHEDULER_IN_DEV=1`
 *   (a dev server pointed at a shared database would otherwise run other people's
 *   schedules). Cron-pattern tasks are saved but never start.
 */
export type ScheduledTaskDispatch = 'builtin' | 'qstash' | 'unconfigured';

type DispatchEnv = Partial<
  Record<
    | 'AWS_LAMBDA_FUNCTION_NAME'
    | 'DATABASE_URL'
    | 'ENABLE_SCHEDULER_IN_DEV'
    | 'NETLIFY'
    | 'NODE_ENV'
    | 'QSTASH_SCHEDULES_MANAGED'
    | 'QSTASH_TOKEN'
    | 'VERCEL_ENV',
    string
  >
>;

/** Function hosts (Vercel, Netlify, any AWS Lambda) where an in-process timer cannot be relied on. */
const isServerless = (env: DispatchEnv) =>
  !!(env.VERCEL_ENV || env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME);

export const getScheduledTaskDispatch = (
  env: DispatchEnv = process.env as DispatchEnv,
): ScheduledTaskDispatch => {
  const serverless = isServerless(env);
  if (env.QSTASH_TOKEN && (serverless || env.QSTASH_SCHEDULES_MANAGED === '1')) return 'qstash';
  // Schedules live in the server database; without one there is nothing to run.
  if (!env.DATABASE_URL) return 'unconfigured';
  if (serverless) return 'unconfigured';
  if (env.NODE_ENV !== 'production' && env.ENABLE_SCHEDULER_IN_DEV !== '1') return 'unconfigured';
  return 'builtin';
};
