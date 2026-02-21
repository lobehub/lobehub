import { type InsertAgentCronJob, type UpdateAgentCronJob } from '@lobechat/types';
import { InsertAgentCronJobSchema, UpdateAgentCronJobSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentCronJobModel } from '@/database/models/agentCronJob';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const agentCronJobProcedure = authedProcedure.use(serverDatabase);

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  enabled: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

const resetExecutionsSchema = z.object({
  id: z.string(),
  newMaxExecutions: z.number().min(1).max(10_000).optional(),
});

const batchUpdateStatusSchema = z.object({
  enabled: z.boolean(),
  ids: z.array(z.string()),
});

// Create input schema for tRPC that omits server-managed fields
const createAgentCronJobInputSchema = InsertAgentCronJobSchema.omit({
  userId: true, // Provided by authentication context
});

/**
 * Agent Cron Job tRPC Router
 *
 * Provides type-safe API for managing agent scheduled tasks
 */
export const agentCronJobRouter = router({
  /**
   * Batch update status (enable/disable) for multiple jobs
   */
  batchUpdateStatus: agentCronJobProcedure
    .input(batchUpdateStatusSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { ids, enabled } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const updatedCount = await cronJobModel.batchUpdateStatus(ids, enabled);

        return {
          data: { updatedCount },
          message: `${updatedCount} cron jobs ${enabled ? 'enabled' : 'disabled'} successfully`,
          success: true,
        };
      } catch (error) {
        console.error('[agentCronJob:batchUpdateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update cron job statuses',
        });
      }
    }),

  /**
   * Create a new cron job
   */
  create: agentCronJobProcedure
    .input(createAgentCronJobInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        // Add userId to the input data since it's provided by authentication context
        const cronJobData = { ...input, userId };
        const cronJob = await cronJobModel.create(cronJobData as InsertAgentCronJob);

        return {
          data: cronJob,
          message: 'Cron job created successfully',
          success: true,
        };
      } catch (error) {
        console.error('[agentCronJob:create]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create cron job',
        });
      }
    }),

  /**
   * Delete a cron job
   */
  delete: agentCronJobProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const deleted = await cronJobModel.delete(id);

        if (!deleted) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Cron job not found or access denied',
          });
        }

        return {
          message: 'Cron job deleted successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentCronJob:delete]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete cron job',
        });
      }
    }),

  /**
   * List cron jobs by agent ID
   */
  findByAgent: agentCronJobProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { agentId } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const cronJobs = await cronJobModel.findByAgentId(agentId);

        return {
          data: cronJobs,
          success: true,
        };
      } catch (error) {
        console.error('[agentCronJob:findByAgent]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch agent cron jobs',
        });
      }
    }),

  /**
   * Get a single cron job by ID
   */
  findById: agentCronJobProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const cronJob = await cronJobModel.findById(id);

        if (!cronJob) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Cron job not found',
          });
        }

        return {
          data: cronJob,
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentCronJob:findById]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch cron job',
        });
      }
    }),

  /**
   * Get jobs that are near depletion (for warnings)
   */
  getNearDepletion: agentCronJobProcedure
    .input(z.object({ threshold: z.number().min(1).max(20).default(5) }))
    .query(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { threshold } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const jobs = await cronJobModel.getTasksNearDepletion(threshold);

        return {
          data: jobs,
          success: true,
        };
      } catch (error) {
        console.error('[agentCronJob:getNearDepletion]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch near depletion jobs',
        });
      }
    }),

  /**
   * Get execution statistics for user's cron jobs
   */
  getStats: agentCronJobProcedure.query(async ({ ctx }) => {
    const { userId, serverDB: db } = ctx;

    try {
      const cronJobModel = new AgentCronJobModel(db, userId);
      const stats = await cronJobModel.getExecutionStats();

      return {
        data: stats,
        success: true,
      };
    } catch (error) {
      console.error('[agentCronJob:getStats]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch execution statistics',
      });
    }
  }),

  /**
   * List cron jobs with filtering and pagination
   */
  list: agentCronJobProcedure.input(listQuerySchema).query(async ({ input, ctx }) => {
    const { userId, serverDB: db } = ctx;
    const { agentId, enabled, limit, offset } = input;

    try {
      const cronJobModel = new AgentCronJobModel(db, userId);
      const result = await cronJobModel.findWithPagination({
        agentId,
        enabled,
        limit,
        offset,
      });

      return {
        data: result.jobs,
        pagination: {
          hasMore: offset + limit < result.total,
          limit,
          offset,
          total: result.total,
        },
        success: true,
      };
    } catch (error) {
      console.error('[agentCronJob:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch cron jobs',
      });
    }
  }),

  /**
   * Reset execution counts for a cron job
   */
  resetExecutions: agentCronJobProcedure
    .input(resetExecutionsSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id, newMaxExecutions } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const cronJob = await cronJobModel.resetExecutions(id, newMaxExecutions);

        if (!cronJob) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Cron job not found or access denied',
          });
        }

        return {
          data: cronJob,
          message: 'Execution counts reset successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentCronJob:resetExecutions]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reset execution counts',
        });
      }
    }),

  /**
   * Update a cron job
   */
  update: agentCronJobProcedure
    .input(
      z.object({
        data: UpdateAgentCronJobSchema,
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB: db } = ctx;
      const { id, data } = input;

      try {
        const cronJobModel = new AgentCronJobModel(db, userId);
        const cronJob = await cronJobModel.update(id, data as UpdateAgentCronJob);

        if (!cronJob) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Cron job not found or access denied',
          });
        }

        return {
          data: cronJob,
          message: 'Cron job updated successfully',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error('[agentCronJob:update]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update cron job',
        });
      }
    }),

  // Note: testExecution moved to cloud layer since it uses AgentCronWorkflow
});
