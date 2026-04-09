import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { BriefService } from '@/server/services/brief';

const briefProcedure = authedProcedure.use(serverDatabase);

const idInput = z.object({ id: z.string() });

const createSchema = z.object({
  actions: z.array(z.record(z.unknown())).optional(),
  agentId: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  cronJobId: z.string().optional(),
  priority: z.enum(['urgent', 'normal', 'info']).default('info'),
  summary: z.string().min(1),
  taskId: z.string().optional(),
  title: z.string().min(1),
  topicId: z.string().optional(),
  type: z.enum(['decision', 'result', 'insight', 'error']),
});

const listSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  type: z.string().optional(),
});

export const briefRouter = router({
  create: briefProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const createData = { ...input };

      // Resolve taskId if it's an identifier
      if (createData.taskId) {
        const taskModel = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await taskModel.resolve(createData.taskId);
        if (task) createData.taskId = task.id;
      }

      const model = new BriefModel(ctx.serverDB, ctx.userId);
      const brief = await model.create(createData);
      return { data: brief, message: 'Brief created', success: true };
    } catch (error) {
      console.error('[brief:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create brief',
      });
    }
  }),

  delete: briefProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId);
      const deleted = await model.delete(input.id);
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { message: 'Brief deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete brief',
      });
    }
  }),

  find: briefProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId);
      const brief = await model.findById(input.id);
      if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { data: brief, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find brief',
      });
    }
  }),

  findByTaskId: briefProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const model = new BriefModel(ctx.serverDB, ctx.userId);
        const items = await model.findByTaskId(input.taskId);
        return { data: items, success: true };
      } catch (error) {
        console.error('[brief:findByTaskId]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to find briefs',
        });
      }
    }),

  list: briefProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const service = new BriefService(ctx.serverDB, ctx.userId);
      const result = await service.list(input);

      return { data: result.briefs, success: true, total: result.total };
    } catch (error) {
      console.error('[brief:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list briefs',
      });
    }
  }),

  listUnresolved: briefProcedure.query(async ({ ctx }) => {
    try {
      const service = new BriefService(ctx.serverDB, ctx.userId);
      const data = await service.listUnresolved();

      return { data, success: true };
    } catch (error) {
      console.error('[brief:listUnresolved]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list unresolved briefs',
      });
    }
  }),

  markRead: briefProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new BriefModel(ctx.serverDB, ctx.userId);
      const brief = await model.markRead(input.id);
      if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      return { data: brief, message: 'Brief marked as read', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[brief:markRead]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark brief as read',
      });
    }
  }),

  resolve: briefProcedure
    .input(
      idInput.merge(
        z.object({
          action: z.string().optional(),
          comment: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new BriefModel(ctx.serverDB, ctx.userId);
        const brief = await model.resolve(input.id, {
          action: input.action,
          comment: input.comment,
        });
        if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
        return { data: brief, message: 'Brief resolved', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[brief:resolve]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve brief',
        });
      }
    }),
});
