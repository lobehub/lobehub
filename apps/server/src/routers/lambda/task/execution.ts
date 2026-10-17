import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { failStuckTasks } from '@/server/services/taskLifecycle/failStuckTasks';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { idInput, resolveOrThrow, taskProcedure, taskProcedureWrite } from './procedures';

export const executionProcedures = {
  run: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          continueTopicId: z.string().optional(),
          deviceId: z.string().optional(),
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const task = await resolveOrThrow(ctx.taskModel, input.id);

        const runner = new TaskRunnerService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        return await runner.runTask({
          continueTopicId: input.continueTopicId,
          deviceId: input.deviceId,
          extraPrompt: input.prompt,
          taskId: task.id,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:run]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run task',
        });
      }
    }),
  heartbeat: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.updateHeartbeat(task.id);
      return { message: 'Heartbeat updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:heartbeat]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update heartbeat',
      });
    }
  }),
  watchdog: taskProcedureWrite.mutation(async ({ ctx }) => {
    try {
      const { checked, failed } = await failStuckTasks(ctx.serverDB);

      return {
        checked,
        failed,
        message:
          failed.length > 0
            ? `${failed.length} stuck tasks marked as failed`
            : 'No stuck tasks found',
        success: true,
      };
    } catch (error) {
      console.error('[task:watchdog]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Watchdog check failed',
      });
    }
  }),
  cancelTopic: taskProcedureWrite
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.taskService.cancelTopic(input.topicId);
        return { message: 'Topic canceled', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:cancelTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel topic',
        });
      }
    }),
  deleteTopic: taskProcedureWrite
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.taskService.deleteTopic(input.topicId);
        return { message: 'Topic deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete topic',
        });
      }
    }),
  previewSubtaskLayers: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const plan = await ctx.taskService.previewSubtaskLayers(input.id);
      return { data: plan, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:previewSubtaskLayers]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to plan subtask layers',
      });
    }
  }),
  runReadySubtasks: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const result = await ctx.taskService.runReadySubtasks(input.id);
      return { data: result, success: result.failed.length === 0 };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:runReadySubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to run subtasks',
      });
    }
  }),
};
