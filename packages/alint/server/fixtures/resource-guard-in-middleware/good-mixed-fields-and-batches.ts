import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { taskProcedure } from './procedures';
import { resolveOrThrow } from './resolve';

export const taskRouter = router({
  addDependency: taskProcedure
    .input(z.object({ dependsOnId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await resolveOrThrow(ctx, input.id);
      const dependsOn = await resolveOrThrow(ctx, input.dependsOnId);
      return ctx.taskModel.addDependency(task.id, dependsOn.id);
    }),
  batchArchive: taskProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) =>
      pMap(
        input.ids,
        async (id) => {
          const task = await resolveOrThrow(ctx, id);
          return ctx.taskModel.archive(task.id);
        },
        { concurrency: 5 },
      ),
    ),
  comment: taskProcedure
    .input(z.object({ content: z.string(), taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await resolveOrThrow(ctx, input.taskId);
      return ctx.taskModel.addComment(task.id, input.content);
    }),
  start: taskProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const task = await resolveOrThrow(ctx, input.id);
    return ctx.taskModel.start(task.id);
  }),
});
