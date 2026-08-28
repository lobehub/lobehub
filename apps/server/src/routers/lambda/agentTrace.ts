import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileS3 } from '@/server/modules/S3';

/**
 * Read-only access to the agent execution snapshots uploaded by
 * `S3SnapshotStore`. Exists so `lh trace` can inspect a production run with
 * nothing but a LobeHub login: the two things that previously had to be done
 * by hand — mapping a topic id to an operation id (a SQL query) and reaching
 * the bucket (a per-deployment `TRACING_BASE_URL` pointing at a public
 * domain) — both happen here, behind the caller's own ownership scope.
 */
const agentTraceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      agentOperationModel: new AgentOperationModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const agentTraceRouter = router({
  /**
   * Pre-signed GET for one operation's snapshot object.
   *
   * The snapshot itself is deliberately NOT returned through TRPC: it is a
   * zstd blob that decompresses 8-9x (see `S3SnapshotStore`), and pushing it
   * through superjson would serialize the whole thing twice on the server.
   * The client downloads and decompresses it directly instead.
   */
  getSnapshotUrl: agentTraceProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        // Ownership-scoped: an operation belonging to someone else reads as
        // absent rather than forbidden, so this can't be used to probe ids.
        const operation = await ctx.agentOperationModel.findById(input.operationId);
        if (!operation) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });
        }

        if (!operation.traceS3Key) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message:
              'No trace was recorded for this operation (trace_s3_key is empty). ' +
              'Snapshot upload may have been disabled when it ran.',
          });
        }

        const url = await new FileS3().createPreSignedUrlForPreview(operation.traceS3Key);

        return {
          data: {
            key: operation.traceS3Key,
            operationId: operation.id,
            url,
          },
          success: true as const,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[agentTrace:getSnapshotUrl]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to sign the trace snapshot URL',
        });
      }
    }),

  /** Operations recorded for a topic, newest first. */
  listOperations: agentTraceProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20), topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const operations = await ctx.agentOperationModel.listByTopic(input.topicId, input.limit);

        return {
          // The key itself is an internal storage detail; callers only need to
          // know whether there is a snapshot to fetch.
          data: operations.map(({ traceS3Key, ...operation }) => ({
            ...operation,
            hasTrace: Boolean(traceS3Key),
          })),
          success: true as const,
        };
      } catch (error) {
        console.error('[agentTrace:listOperations]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list operations',
        });
      }
    }),
});
