import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getUserExecutionPolicy } from '@/server/services/governance';

const executionPolicyProcedure = authedProcedure.use(serverDatabase);

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
});

export type ExecutionPolicyRouter = typeof executionPolicyRouter;
