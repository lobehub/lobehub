import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TaskArchiveModel } from '@/database/models/taskArchive';
import { markSilentTRPCErrorLog } from '@/libs/trpc/utils/errorLogger';
import { assertNotInOpenGoal } from '@/server/services/task/archiveGuard';
import { notifyAssignedBestEffort } from '@/server/services/task/assignmentNotification';
import {
  assertResultingScheduleValid,
  schedulePatternSchema,
  scheduleTimezoneSchema,
} from '@/server/services/task/scheduleValidation';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import {
  idInput,
  resolveOrThrow,
  taskProcedureWrite,
  taskVerifyConfigPatchSchema,
} from './procedures';

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
// Unknown fields are stripped, including the removed identifierPrefix. Released
// CLI clients send 'T' by default; ignore it so project subtasks use their project
// identifier without breaking ordinary creates from those clients.
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  // Optional schedule wiring at create time. When `automationMode` is
  // 'schedule', `schedulePattern` (cron) is required for the central
  // schedule-dispatch sweep to pick the task up.
  automationMode: z.enum(['heartbeat', 'schedule']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
  projectId: z.string().optional(),
  schedulePattern: schedulePatternSchema.optional(),
  scheduleTimezone: scheduleTimezoneSchema.optional(),
  // When omitted, the server derives visibility from the parent task or the
  // assignee agent's visibility (private agent → private task). UI surfaces
  // such as the top-level "Tasks" create form pass it explicitly.
  visibility: z.enum(['private', 'public']).optional(),
  // Removed contract, kept so the server can recognise it. A task no longer
  // carries a goal — the Goal Graph owns execution and dispatches its own Work
  // Tasks — and silently dropping this field would let a released client report
  // that a goal started when only an ordinary task exists.
  goal: z.unknown().optional(),
});

export const lifecycleProcedures = {
  /**
   * Read a composer draft and report what it means — a name, the outcome as
   * understood, the questions that would change the deliverable, and whether
   * it is really a standing goal. Returns a reading only; nothing is created.
   */
  analyzeIntent: taskProcedureWrite
    .input(
      z.object({
        context: z.string().optional(),
        instruction: z.string().min(1).max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.taskIntentService.analyze(input);
      } catch (error) {
        const errorType = (error as { errorType?: unknown } | null)?.errorType;
        if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
          const trpcError = new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: AgentRuntimeErrorType.InvalidProviderAPIKey,
          });
          // Runtime errors are plain payloads, so tRPC normalizes them into an
          // Error cause; mark the cause the shared handler actually receives.
          markSilentTRPCErrorLog(trpcError.cause);
          throw trpcError;
        }

        throw error;
      }
    }),
  /**
   * Rewrite a confirmed draft into the brief that gets executed, folding in the
   * answers the user just gave. Returns a brief only; nothing is created.
   */
  synthesizeInstruction: taskProcedureWrite
    .input(
      z.object({
        answers: z
          .array(z.object({ answer: z.string().min(1), question: z.string().min(1) }))
          .max(3),
        context: z.string().optional(),
        instruction: z.string().min(1).max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.taskIntentService.synthesize(input);
      } catch (error) {
        const errorType = (error as { errorType?: unknown } | null)?.errorType;
        if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
          const trpcError = new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: AgentRuntimeErrorType.InvalidProviderAPIKey,
          });
          markSilentTRPCErrorLog(trpcError.cause);
          throw trpcError;
        }

        throw error;
      }
    }),
  create: taskProcedureWrite.input(createSchema).mutation(async ({ input, ctx }) => {
    const { goal: legacyGoal, ...createInput } = input;
    if (legacyGoal !== undefined) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Creating a goal through task.create is no longer supported. Reload the app, then create the goal again.',
      });
    }
    assertResultingScheduleValid(null, createInput);
    try {
      const parsedVerify = taskVerifyConfigPatchSchema.safeParse(createInput.config?.verify);
      const { verify: _legacyVerify, ...taskConfig } = createInput.config ?? {};
      const task = await ctx.taskService.createTask({
        ...createInput,
        config: parsedVerify.success ? taskConfig : createInput.config,
      });
      try {
        if (parsedVerify.success) {
          const { requirement, ...rawConfig } = parsedVerify.data;
          const config = Object.fromEntries(
            Object.entries(rawConfig).filter(([, value]) => value != null),
          );
          await new AcceptanceService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ).ensureForSubject('task', task.id, {
            config,
            requirement: requirement ?? undefined,
          });
        }
      } catch (error) {
        await ctx.taskModel.delete(task.id).catch(() => {});
        throw error;
      }
      // Creating a task already assigned to another member notifies them.
      notifyAssignedBestEffort(ctx, task);
      return { data: task, message: 'Task created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:create]', error);
      const causeMessage = error instanceof Error ? error.message : String(error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: causeMessage ? `Failed to create task: ${causeMessage}` : 'Failed to create task',
      });
    }
  }),
  clearAll: taskProcedureWrite.mutation(async ({ ctx }) => {
    try {
      const model = ctx.taskModel;
      // Workspace clear-all is caller-scoped for every role — owners included
      // (per docs/usage/workspace-permissions: bulk actions only affect
      // caller-created content).
      const restrictToCreator = !!ctx.workspaceId;
      const count = await model.deleteAll({ restrictToCreator });
      return { count, message: `${count} tasks deleted`, success: true };
    } catch (error) {
      console.error('[task:clearAll]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to clear tasks',
      });
    }
  }),
  delete: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const task = await resolveOrThrow(ctx.taskModel, input.id);
      assertWorkspaceRowManageable(ctx, task.createdByUserId, 'task');
      await ctx.taskService.deleteTask(task.id);
      return { data: task, message: 'Task deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete task',
      });
    }
  }),
  // User-only close-out: no builtin agent tool exposes it, so an agent never
  // archives a task on its own. `status` is left untouched.
  archive: taskProcedureWrite
    .input(idInput.extend({ archived: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const task = await resolveOrThrow(ctx.taskModel, input.id);
        // Archiving hides a shared task from every member's lists: same
        // creator-or-owner scope as delete.
        assertWorkspaceRowManageable(ctx, task.createdByUserId, 'task');
        if (input.archived) {
          await assertNotInOpenGoal(
            ctx.serverDB,
            { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
            task,
          );
        }
        const archiveModel = new TaskArchiveModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        // Archived rows leave every list, so live work would run out of sight.
        // The guard is part of the UPDATE, so a run starting concurrently can't slip past.
        const updated = input.archived
          ? await archiveModel.archive(task.id)
          : await archiveModel.unarchive(task.id);
        if (!updated) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Stop the running task or its schedule/heartbeat before archiving it',
          });
        }
        return { data: updated, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:archive]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to archive task',
        });
      }
    }),
  // Cross-workspace task *transfer* is intentionally not supported anymore:
  // moving a task drags its whole subtree plus history (dependencies,
  // documents, comments) out of the workspace. Use `copyTaskToWorkspace`,
  // which clones the task definition only. The procedure is kept as a
  // compatibility stub so already-released clients get a stable business
  // error instead of a procedure-not-found failure.
  transferTask: taskProcedureWrite
    .input(
      z.object({
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
        taskId: z.string(),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({
        cause: { data: { code: TransferErrorCode.TransferNotSupported } },
        code: 'PRECONDITION_FAILED',
        message: 'Task transfer is no longer supported; use copyTaskToWorkspace instead',
      });
    }),
  copyTaskToWorkspace: taskProcedureWrite
    .input(
      z.object({
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.taskModel.resolve(input.taskId);
      if (!task)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Task not found',
        });

      // No source-side creator gate: copy is non-destructive and clones the
      // task definition only, so any member who can resolve the task (the
      // visibility-aware `resolve` above already hides others' private tasks)
      // may copy it.
      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });
        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      return ctx.taskModel.copyToWorkspace(
        task.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),
};
