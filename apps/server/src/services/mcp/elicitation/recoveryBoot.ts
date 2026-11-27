import { getServerDB } from '@/database/core/db-adaptor';

import type { McpRecoveryRuntimeFactory } from './recoveryWorker';
import { startMcpRecoveryWorker } from './recoveryWorker';

/**
 * Local queues lose timers on process restart, so a self-hosted server sweeps persisted MCP work
 * itself. Vercel and the durable queue mode recover through their queue instead.
 */
const runsLocalMcpRecovery = () =>
  process.env.NEXT_RUNTIME === 'nodejs' &&
  !!process.env.DATABASE_URL &&
  !process.env.VERCEL_ENV &&
  process.env.AGENT_RUNTIME_MODE !== 'queue';

let requested = false;

/**
 * Starts the MCP recovery worker once per process, the first time the Agent runtime is used.
 *
 * This used to start from `instrumentation.ts`, but importing the worker there pulls the whole
 * Agent runtime graph into the instrumentation entry, which Turbopack then builds once per server
 * route: about 2,300 modules copied eleven times, doubling the server output and pushing
 * `next build` past the 8 GB build machine. Started from here, the worker shares the graph the
 * runtime already loaded; the runtime passes itself in as `createRuntime`, so the worker never
 * imports it back. Work left due across a restart waits for the first Agent run, which is
 * also when anyone would be waiting on it.
 */
export const ensureMcpRecoveryWorker = (createRuntime: McpRecoveryRuntimeFactory) => {
  if (requested || !runsLocalMcpRecovery()) return;
  requested = true;
  getServerDB()
    .then((db) => startMcpRecoveryWorker(db, createRuntime))
    .catch((error) => {
      requested = false;
      console.error('[MCP recovery] Failed to start', error);
    });
};
