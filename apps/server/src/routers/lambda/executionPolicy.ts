import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getUserExecutionPolicy, logCommandExecution } from '@/server/services/governance';

const executionPolicyProcedure = authedProcedure.use(serverDatabase);

const LogFileAccessInputSchema = z.object({
  apiName: z.string().min(1),
  matchedField: z.enum(['deniedWriteRoots', 'deniedReadRoots']),
  path: z.string().min(1),
});

/**
 * Lambda-router surface for the CLI/desktop execution-policy fetch. Deliberately
 * NOT under `/api/governance/*` (the service-token-gated router-hono contract
 * for the admin panel): this is called by end-user devices, so it authenticates
 * as the logged-in user via the existing OIDC/API-key tRPC auth
 * (`authedProcedure` → `ctx.userId`) instead of a shared service secret —
 * `COMMAND_GOVERNANCE_SERVICE_TOKEN` must never be distributed to a CLI binary
 * or desktop build.
 *
 * `get` is a `.mutation()`, not a `.query()`, to match the only fetch path
 * Electron main has today (`callLambdaMutation` in
 * `apps/desktop/src/main/modules/heterogeneousAgent/fileStorePort.ts`, which
 * always POSTs); the CLI's tRPC client calls it the same way for symmetry.
 */
export const executionPolicyRouter = router({
  get: executionPolicyProcedure.mutation(async ({ ctx }) => {
    return getUserExecutionPolicy(ctx.userId, ctx.serverDB);
  }),

  /**
   * The `local` (desktop's own machine) half of file-access governance
   * audit logging. `apps/server`'s `builtin.ts` chokepoint writes
   * `command_execution_logs` directly for the `device` execution target
   * (it has a DB connection); Electron main does not, and file operations
   * on the user's own machine never round-trip through that chokepoint at
   * all (see `docs/文件操作治理-实施指南-20260902.md` §0) — so the desktop
   * client (`apps/desktop`'s `LocalFileCtr.ts`) calls this instead, after
   * it has already decided locally to block the operation.
   *
   * Only blocked attempts are reported — every allowed read/write logging
   * a network round trip would both balloon this table and add real
   * latency to ordinary local file operations, for a case (`local`) that
   * fail-open on a report failure anyway (a governance-log outage must not
   * be able to interfere with an already-decided local block/allow).
   */
  logFileAccess: executionPolicyProcedure
    .input(LogFileAccessInputSchema)
    .mutation(async ({ ctx, input }) => {
      await logCommandExecution(
        {
          apiName: input.apiName,
          executionTarget: 'local',
          path: input.path,
          toolIdentifier: LocalSystemIdentifier,
          userId: ctx.userId,
        },
        { blocked: true, matchedField: input.matchedField },
        ctx.serverDB,
      );

      return { success: true };
    }),
});

export type ExecutionPolicyRouter = typeof executionPolicyRouter;
