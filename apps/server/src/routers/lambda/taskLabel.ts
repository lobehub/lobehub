import { TASK_LABEL_COLOR_PATTERN, TASK_LABEL_NAME_MAX_LENGTH } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { TaskModel } from '@/database/models/task';
import { TaskLabelError, TaskLabelModel } from '@/database/models/taskLabel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { resolveTaskOrThrow } from '@/server/services/task/utils';

/**
 * `color` is rendered straight into an inline `background` on label chips, so
 * an arbitrary string is a CSS injection point (`url(https://…)` would make
 * every member who sees the shared label fetch an attacker resource).
 * Constrain it to a hex literal wherever it can be written.
 */
const hexColor = z.string().regex(TASK_LABEL_COLOR_PATTERN, 'INVALID_LABEL_COLOR');

const labelName = z.string().trim().min(1).max(TASK_LABEL_NAME_MAX_LENGTH);
const labelIds = z.array(z.string().min(1).max(64)).max(50);

const LABEL_NAME_CONSTRAINTS = new Set([
  'task_labels_user_id_name_unique',
  'task_labels_workspace_id_name_unique',
]);

/** Postgres surfaces the driver error somewhere down the `cause` chain. */
const getPostgresErrorField = (error: unknown, field: string): string | undefined => {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
    current = (current as { cause?: unknown }).cause;
  }
};

/**
 * Turn the model's expected failures into client-recoverable TRPC errors: a
 * duplicate name is CONFLICT (the UI prompts a rename), the label/group rule
 * violations are BAD_REQUEST, a task or label outside the scope is NOT_FOUND.
 */
const rethrowLabelError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  if (
    getPostgresErrorField(error, 'code') === '23505' &&
    LABEL_NAME_CONSTRAINTS.has(getPostgresErrorField(error, 'constraint') ?? '')
  ) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'DUPLICATE_LABEL_NAME' });
  }
  if (error instanceof TaskLabelError) {
    const code =
      error.code === 'LABEL_NOT_FOUND' || error.code === 'TASK_NOT_FOUND'
        ? 'NOT_FOUND'
        : 'BAD_REQUEST';
    throw new TRPCError({ cause: error, code, message: error.message });
  }
  throw error;
};

const labelProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      taskLabelModel: new TaskLabelModel(ctx.serverDB, ctx.userId, wsId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

/**
 * The registry and the assignments are task organization, gated exactly like
 * task writes (`taskProcedureWrite`): members who can edit tasks may manage
 * the shared labels, viewers only read them.
 */
const labelWriteProcedure = labelProcedure.use(withScopedPermission('agent:update'));

const taskLabelsInput = z.object({ labelIds, taskId: z.string().trim().min(1) });

export const taskLabelRouter = router({
  addToTask: labelWriteProcedure.input(taskLabelsInput).mutation(async ({ input, ctx }) => {
    const task = await resolveTaskOrThrow(ctx.taskModel, input.taskId);
    return ctx.taskLabelModel.addTaskLabels(task.id, input.labelIds).catch(rethrowLabelError);
  }),

  /** Apply an add + remove delta in one transaction (an edit that swaps labels). */
  changeForTask: labelWriteProcedure
    .input(
      z.object({
        add: labelIds.optional(),
        remove: labelIds.optional(),
        taskId: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const task = await resolveTaskOrThrow(ctx.taskModel, input.taskId);
      return ctx.taskLabelModel
        .changeTaskLabels(task.id, { add: input.add, remove: input.remove })
        .catch(rethrowLabelError);
    }),

  create: labelWriteProcedure
    .input(
      z.object({
        color: hexColor.nullish(),
        description: z.string().max(255).nullish(),
        isGroup: z.boolean().optional(),
        name: labelName,
        parentId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.taskLabelModel.create(input).catch(rethrowLabelError);
    }),

  delete: labelWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.taskLabelModel.delete(input.id);
      return { success: true };
    }),

  list: labelProcedure.query(async ({ ctx }) => ctx.taskLabelModel.query()),

  removeFromTask: labelWriteProcedure.input(taskLabelsInput).mutation(async ({ input, ctx }) => {
    const task = await resolveTaskOrThrow(ctx.taskModel, input.taskId);
    return ctx.taskLabelModel.removeTaskLabels(task.id, input.labelIds).catch(rethrowLabelError);
  }),

  setForTask: labelWriteProcedure.input(taskLabelsInput).mutation(async ({ input, ctx }) => {
    const task = await resolveTaskOrThrow(ctx.taskModel, input.taskId);
    return ctx.taskLabelModel.setTaskLabels(task.id, input.labelIds).catch(rethrowLabelError);
  }),

  update: labelWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          color: hexColor.nullish(),
          description: z.string().max(255).nullish(),
          name: labelName.optional(),
          parentId: z.string().nullish(),
          sortOrder: z.number().int().min(0).max(100_000).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { color, description, name, parentId, sortOrder } = input.value;
      const row = await ctx.taskLabelModel
        .update(input.id, {
          ...(color !== undefined ? { color } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(parentId !== undefined ? { parentId } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
        })
        .catch(rethrowLabelError);
      return row;
    }),
});

export type TaskLabelRouter = typeof taskLabelRouter;
