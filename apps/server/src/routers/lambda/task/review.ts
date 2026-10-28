import type { TaskVerifyConfig } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { checkpointTaskPairsMatch } from '@/database/models/task/checkpoint';
import { router } from '@/libs/trpc/lambda';
import { normalizeCheckpointTaskRefs, resolveTaskOrThrow } from '@/server/services/task/utils';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';
import { resolveTaskAcceptance } from '@/server/services/verify/taskAcceptance';

import {
  idInput,
  taskProcedure,
  taskProcedureWrite,
  taskVerifyConfigPatchSchema,
} from './procedures';

const checkpointTaskRefSchema = z.object({ id: z.string(), identifier: z.string() });

export const reviewRouter = router({
  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveTaskOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      const references = (
        ids: string[] | undefined,
        pairs: { id: string; identifier: string }[] | undefined,
      ) => (checkpointTaskPairsMatch(ids, pairs) ? pairs!.map((pair) => pair.id) : (ids ?? []));
      const refs = [
        ...references(checkpoint.tasks?.beforeIds, checkpoint.tasks?.beforeTasks),
        ...references(checkpoint.tasks?.afterIds, checkpoint.tasks?.afterTasks),
      ];
      const resolved = await model.resolveRefs(refs);
      const display = (
        values: string[] | undefined,
        pairs: { id: string; identifier: string }[] | undefined,
      ) =>
        checkpointTaskPairsMatch(values, pairs)
          ? pairs!.map((pair) => ({
              id: pair.id,
              identifier: resolved.byRef.get(pair.id)?.identifier ?? pair.identifier,
            }))
          : values?.map((ref) => {
              const task = resolved.byRef.get(ref);
              return task?.identifier === ref
                ? { id: task.id, identifier: task.identifier }
                : { identifier: ref };
            });
      return {
        data: {
          ...checkpoint,
          beforeTasks: display(checkpoint.tasks?.beforeIds, checkpoint.tasks?.beforeTasks),
          afterTasks: display(checkpoint.tasks?.afterIds, checkpoint.tasks?.afterTasks),
        },
        success: true,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getCheckpoint]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get checkpoint',
      });
    }
  }),
  updateCheckpoint: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          checkpoint: z.object({
            onAgentRequest: z.boolean().optional(),
            tasks: z
              .object({
                afterIds: z.array(z.string()).optional(),
                afterTasks: z.array(checkpointTaskRefSchema).optional(),
                beforeIds: z.array(z.string()).optional(),
                beforeTasks: z.array(checkpointTaskRefSchema).optional(),
              })
              .optional(),
            topic: z
              .object({
                after: z.boolean().optional(),
                before: z.boolean().optional(),
              })
              .optional(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, checkpoint } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveTaskOrThrow(model, id);
        const task = await model.updateCheckpointConfig(
          resolved.id,
          await normalizeCheckpointTaskRefs(model, checkpoint, model.getCheckpointConfig(resolved)),
        );
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getCheckpointConfig(task),
          message: 'Checkpoint updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateCheckpoint]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update checkpoint',
        });
      }
    }),
  getReview: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveTaskOrThrow(model, input.id);
      return { data: model.getReviewConfig(task) || null, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getReview]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get review config',
      });
    }
  }),
  updateReview: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          review: z.object({
            autoRetry: z.boolean().default(true),
            enabled: z.boolean(),
            judge: z
              .object({
                model: z.string().optional(),
                provider: z.string().optional(),
              })
              .default({}),
            maxIterations: z.number().min(1).max(10).default(3),
            rubrics: z.array(
              z.object({
                config: z.record(z.string(), z.unknown()),
                extractor: z.record(z.string(), z.unknown()).optional(),
                id: z.string(),
                name: z.string(),
                threshold: z.number().min(0).max(1).optional(),
                type: z.string(),
                weight: z.number().default(1),
              }),
            ),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, review } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveTaskOrThrow(model, id);
        const task = await model.updateReviewConfig(resolved.id, review);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getReviewConfig(task),
          message: 'Review config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update review config',
        });
      }
    }),
  getVerifyConfig: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveTaskOrThrow(model, input.id);
      const resolved = await resolveTaskAcceptance(
        ctx.serverDB,
        ctx.userId,
        task.id,
        ctx.workspaceId ?? undefined,
      );
      return {
        data: resolved ? { ...resolved.config, requirement: resolved.requirement } : null,
        success: true,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getVerifyConfig]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get verify config',
      });
    }
  }),
  updateVerifyConfig: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          // `.nullish()` lets callers clear a saved field: `null` removes it
          // (JSON can't send `undefined`), omission leaves it untouched.
          verify: taskVerifyConfigPatchSchema,
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, verify } = input;
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, id);
        const acceptanceService = new AcceptanceService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const resolvedAcceptance = await resolveTaskAcceptance(
          ctx.serverDB,
          ctx.userId,
          task.id,
          ctx.workspaceId ?? undefined,
        );
        const acceptance =
          resolvedAcceptance?.acceptance ??
          (await acceptanceService.ensureForSubject('task', task.id));
        const nextConfig = { ...acceptance.config } as Record<string, unknown>;
        for (const [key, value] of Object.entries(verify)) {
          if (key === 'requirement') continue;
          if (value === null) delete nextConfig[key];
          else if (value !== undefined) nextConfig[key] = value;
        }
        const requirement =
          verify.requirement === undefined ? acceptance.requirement : verify.requirement;
        const updated = await acceptanceService.acceptanceModel.updatePolicy(acceptance.id, {
          config: nextConfig,
          requirement,
        });
        if (!updated) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance policy not found' });
        }
        const data: TaskVerifyConfig = {
          ...(nextConfig as TaskVerifyConfig),
          requirement: requirement ?? undefined,
        };
        return {
          data,
          message: 'Verify config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateVerifyConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update verify config',
        });
      }
    }),
  runReview: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          content: z.string().optional(),
          topicId: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.taskService.runReview({
          ...input,
          id: (await resolveTaskOrThrow(ctx.taskModel, input.id)).id,
        });
        return { data: result, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:runReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run review',
        });
      }
    }),
});
