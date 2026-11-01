import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { resolveTaskOrThrow, resolveTasksOrThrow } from '@/server/services/task/utils';

import { taskProcedureWrite } from './procedures';

export const relationsRouter = router({
  reorderSubtasks: taskProcedureWrite
    .input(
      z.object({
        id: z.string(),
        // Ordered list of subtask identifiers (e.g. ['TASK-2', 'TASK-4', 'TASK-3'])
        order: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.id);
        const subtasks = await model.findSubtasks(task.id);

        const ordered = (await resolveTasksOrThrow(model, input.order, { duplicates: 'reject' }))
          .tasks;
        const directIds = new Set(subtasks.map((subtask) => subtask.id));
        if (ordered.some((subtask) => !directIds.has(subtask.id))) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not a direct subtask' });
        }
        const reorderItems = ordered.map((subtask, sortOrder) => ({ id: subtask.id, sortOrder }));

        await model.reorder(reorderItems);

        return {
          data: reorderItems.map((item, i) => ({
            id: item.id,
            identifier: ordered[i].identifier,
            sortOrder: item.sortOrder,
          })),
          message: 'Subtasks reordered',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:reorderSubtasks]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reorder subtasks',
        });
      }
    }),
  addDependency: taskProcedureWrite
    .input(
      z.object({
        dependsOnId: z.string(),
        taskId: z.string(),
        type: z.enum(['blocks', 'relates']).default('blocks'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.taskId);
        const dep = await resolveTaskOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        if (error instanceof Error && error.message.includes('project boundaries')) {
          throw new TRPCError({ cause: error, code: 'BAD_REQUEST', message: error.message });
        }
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
        });
      }
    }),
  removeDependency: taskProcedureWrite
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.taskId);
        const dep = await resolveTaskOrThrow(model, input.dependsOnId);
        await model.removeDependency(task.id, dep.id);
        return { message: 'Dependency removed', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:removeDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove dependency',
        });
      }
    }),
  pinDocument: taskProcedureWrite
    .input(
      z.object({
        documentId: z.string(),
        pinnedBy: z.string().default('user'),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.taskId);
        await model.pinDocument(task.id, input.documentId, input.pinnedBy);
        return { message: 'Document pinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:pinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to pin document',
        });
      }
    }),
  unpinDocument: taskProcedureWrite
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.taskId);
        await model.unpinDocument(task.id, input.documentId);
        return { message: 'Document unpinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:unpinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unpin document',
        });
      }
    }),
});
