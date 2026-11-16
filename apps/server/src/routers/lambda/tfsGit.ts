import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { runTfsGit } from '@/server/services/tfs/git';
import { isTfsGitBranch } from '@/server/services/tfs/gitCommand';

const operationInput = z.object({
  branch: z.string().refine(isTfsGitBranch, 'Invalid branch').optional(),
  operation: z.enum(['fetch', 'pull', 'push']),
  sourceIndex: z.number().int().min(0).max(99).default(0),
});

export const tfsGitRouter = router({
  git: wsCompatProcedure
    .use(serverDatabase)
    .input(operationInput.extend({ topicId: z.string().min(1).max(255) }))
    .mutation(({ ctx, input }) =>
      runTfsGit(
        {
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        },
        input,
      ),
    ),
  gitOperation: heteroAuthedProcedure
    .use(serverDatabase)
    .input(operationInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation)
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An active operation token is required.',
        });
      try {
        // Existing capability keeps rolling deployments compatible. The only target is
        // the live operation's own topic and its current, permission-checked environment.
        const principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'hetero:ingest',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId: ctx.heteroOperation.operation_id,
        });
        if (!principal.topicId)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This operation has no conversation.',
          });
        return await runTfsGit(
          { db: ctx.serverDB, ...principal },
          { ...input, topicId: principal.topicId },
        );
      } catch (error) {
        if (!(error instanceof HeteroOperationPrincipalError)) throw error;
        throw new TRPCError({
          code:
            error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
          message: error.message,
        });
      }
    }),
});
