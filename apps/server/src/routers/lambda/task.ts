import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskListItem, TaskParticipant } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { TaskService } from '@/server/services/task';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { TaskRunnerService } from '@/server/services/taskRunner';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const taskProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      briefModel: new BriefModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      taskLifecycle: new TaskLifecycleService(ctx.serverDB, ctx.userId, wsId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId, wsId),
      taskService: new TaskService(ctx.serverDB, ctx.userId, wsId),
      taskTopicModel: new TaskTopicModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Write variant gates viewers out of every task mutation (create/update/delete/
// run). Reads keep using `taskProcedure` so viewers can still inspect tasks
// and their status.
const taskProcedureWrite = taskProcedure.use(withScopedPermission('agent:update'));

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
const idInput = z.object({ id: z.string() });

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  // Optional schedule wiring at create time. When `automationMode` is
  // 'schedule', `schedulePattern` (cron) is required for the central
  // schedule-dispatch sweep to pick the task up.
  automationMode: z.enum(['heartbeat', 'schedule']).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
  schedulePattern: z.string().optional(),
  scheduleTimezone: z.string().optional(),
  // When omitted, the server derives visibility from the parent task or the
  // assignee agent's visibility (private agent → private task). UI surfaces
  // such as the top-level "Tasks" create form pass it explicitly.
  visibility: z.enum(['private', 'public']).optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullish(),
  assigneeUserId: z.string().nullish(),
  automationMode: z.enum(['heartbeat', 'schedule']).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  // 0 clears the interval (disables heartbeat); any positive value must be
  // ≥600s (10 min) to match the UI minimum and prevent sub-minute ticks if an
  // LLM calls setTaskSchedule with a tiny number.
  heartbeatInterval: z
    .number()
    .int()
    .refine((v) => v === 0 || v >= 600, {
      message: 'heartbeatInterval must be 0 (disabled) or at least 600 seconds (10 minutes)',
    })
    .optional(),
  heartbeatTimeout: z.number().min(1).nullish(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priority: z.number().min(0).max(4).optional(),
  schedulePattern: z.string().nullish(),
  scheduleTimezone: z.string().nullish(),
});

const listSchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  parentIdentifier: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priorities: z.array(z.number().min(0).max(4)).max(5).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).max(10).optional(),
  // UI-side narrowing of the result set. Omitted means "All" (the chip's
  // default 'private' is enforced client-side; the server stays permissive
  // so router tests / external callers don't have to know the chip).
  visibility: z.enum(['private', 'public']).optional(),
});

const groupListSchema = z.object({
  assigneeAgentId: z.string().optional(),
  groups: z
    .array(
      z.object({
        key: z.string(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        statuses: z.array(z.string()).min(1).max(10),
      }),
    )
    .min(1)
    .max(10),
  parentTaskId: z.string().nullish(),
  visibility: z.enum(['private', 'public']).optional(),
});

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

async function assertAssigneeAgentBelongsToUser(
  db: LobeChatDatabase,
  callerCtx: { userId: string; workspaceId?: string },
  assigneeAgentId?: string | null,
) {
  if (!assigneeAgentId) return;

  try {
    await assertAgentUsableBy(db, assigneeAgentId, callerCtx);
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      // Preserve the task-context message so the UI surfaces "Assignee agent
      // not found" instead of the generic "Agent not found". Cross-user access
      // to a private agent still resolves to NOT_FOUND, never FORBIDDEN, so we
      // don't leak existence of someone else's private agent.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignee agent not found' });
    }
    throw error;
  }
}

async function resolveSafeParentTaskId(
  model: TaskModel,
  taskId: string,
  parentTaskId: string | null,
): Promise<string | null> {
  if (parentTaskId === null) return null;

  const parent = await resolveOrThrow(model, parentTaskId);
  if (parent.id === taskId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to itself',
    });
  }

  const descendants = await model.findAllDescendants(taskId);
  if (descendants.some((task) => task.id === parent.id)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to its own descendant',
    });
  }

  return parent.id;
}

export const taskRouter = router({
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
        const task = await resolveOrThrow(model, input.id);
        const subtasks = await model.findSubtasks(task.id);

        // Build identifier → id map
        const idMap = new Map<string, string>();
        for (const s of subtasks) idMap.set(s.identifier, s.id);

        // Validate all identifiers exist
        const reorderItems: Array<{ id: string; sortOrder: number }> = [];
        for (let i = 0; i < input.order.length; i++) {
          const identifier = input.order[i].toUpperCase();
          const taskId = idMap.get(identifier);
          if (!taskId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Subtask not found: ${identifier}`,
            });
          }
          reorderItems.push({ id: taskId, sortOrder: i });
        }

        await model.reorder(reorderItems);

        return {
          data: reorderItems.map((item, i) => ({
            identifier: input.order[i],
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

  addComment: taskProcedureWrite
    .input(
      z.object({
        authorAgentId: z.string().optional(),
        briefId: z.string().optional(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
        id: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        await assertAssigneeAgentBelongsToUser(
          ctx.serverDB,
          { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
          input.authorAgentId,
        );
        const comment = await model.addComment({
          authorAgentId: input.authorAgentId,
          authorUserId: input.authorAgentId ? undefined : ctx.userId,
          briefId: input.briefId,
          content: input.content,
          editorData: input.editorData as never,
          taskId: task.id,
          topicId: input.topicId,
          userId: ctx.userId,
        });
        return { data: comment, message: 'Comment added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add comment',
        });
      }
    }),

  deleteComment: taskProcedureWrite
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const deleted = await ctx.taskModel.deleteComment(input.commentId);
        if (!deleted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { message: 'Comment deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        });
      }
    }),

  updateComment: taskProcedureWrite
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const comment = await ctx.taskModel.updateComment(input.commentId, input.content, {
          editorData: input.editorData,
        });
        if (!comment) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { data: comment, message: 'Comment updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update comment',
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
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
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

  create: taskProcedureWrite.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const task = await ctx.taskService.createTask(input);
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
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      assertWorkspaceRowManageable(ctx, task.createdByUserId, 'task');
      await model.delete(task.id);
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

  detail: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const detail = await ctx.taskService.getTaskDetail(input.id);
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { data: detail, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:detail]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task detail',
      });
    }
  }),

  find: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: task, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find task',
      });
    }
  }),

  getDependencies: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const deps = await model.getDependencies(task.id);
      return { data: deps, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getDependencies]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get dependencies',
      });
    }
  }),

  getPinnedDocuments: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const docs = await model.getPinnedDocuments(task.id);
      return { data: docs, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getPinnedDocuments]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get documents',
      });
    }
  }),

  getTopics: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const results = await ctx.taskTopicModel.findWithDetails(task.id);
      return { data: results, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTopics]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task topics',
      });
    }
  }),

  getSubtasks: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const subtasks = await model.findSubtasks(task.id);
      return { data: subtasks, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getSubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get subtasks',
      });
    }
  }),

  getTaskTree: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const tree = await model.getTaskTree(task.id);
      return { data: tree, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTaskTree]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task tree',
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
      const stuckTasks = await TaskModel.findStuckTasks(ctx.serverDB);
      const failed: string[] = [];

      for (const task of stuckTasks) {
        const wsId = task.workspaceId ?? undefined;
        const model = new TaskModel(ctx.serverDB, task.createdByUserId, wsId);
        await model.updateStatus(task.id, 'failed', {
          completedAt: new Date(),
          error: 'Heartbeat timeout',
        });

        // Create error brief
        const briefModel = new BriefModel(ctx.serverDB, task.createdByUserId, wsId);
        await briefModel.create({
          agentId: task.assigneeAgentId || undefined,
          priority: 'urgent',
          summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
          taskId: task.id,
          title: `${task.identifier} heartbeat timeout`,
          trigger: 'task',
          type: 'error',
        });

        failed.push(task.identifier);
      }

      return {
        checked: stuckTasks.length,
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

  groupList: taskProcedure.input(groupListSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const groups = await model.groupList(input);
      return { data: groups, success: true };
    } catch (error) {
      console.error('[task:groupList]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch grouped tasks',
      });
    }
  }),

  list: taskProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const { parentIdentifier, ...query } = input;
      let parentTaskId = query.parentTaskId;

      if (parentIdentifier) {
        const parent = await model.resolve(parentIdentifier);
        if (!parent) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Parent task not found: ${parentIdentifier}`,
          });
        }

        parentTaskId = parent.id;
      }

      const result = await model.list({
        ...query,
        parentTaskId,
      });

      const assigneeIds = [
        ...new Set(result.tasks.map((t) => t.assigneeAgentId).filter((id): id is string => !!id)),
      ];
      const agents =
        assigneeIds.length > 0 ? await ctx.agentModel.getAgentAvatarsByIds(assigneeIds) : [];
      const agentMap = new Map(agents.map((a) => [a.id, a]));

      const data: TaskListItem[] = result.tasks.map((task) => {
        const participants: TaskParticipant[] = [];
        if (task.assigneeAgentId) {
          const agent = agentMap.get(task.assigneeAgentId);
          if (agent) {
            participants.push({
              avatar: agent.avatar,
              backgroundColor: agent.backgroundColor,
              id: agent.id,
              title: agent.title ?? '',
              type: 'agent',
            });
          }
        }
        return { ...task, participants };
      });

      return { data, success: true, total: result.total };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list tasks',
      });
    }
  }),

  run: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          continueTopicId: z.string().optional(),
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const runner = new TaskRunnerService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        return await runner.runTask({
          continueTopicId: input.continueTopicId,
          extraPrompt: input.prompt,
          taskId: input.id,
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
        const task = await resolveOrThrow(model, input.taskId);
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

  removeDependency: taskProcedureWrite
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
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

  unpinDocument: taskProcedureWrite
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
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

  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      return { data: checkpoint, success: true };
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
                beforeIds: z.array(z.string()).optional(),
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
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateCheckpointConfig(resolved.id, checkpoint);
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
      const task = await resolveOrThrow(model, input.id);
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
        const resolved = await resolveOrThrow(model, id);
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
      const task = await resolveOrThrow(model, input.id);
      return { data: model.getVerifyConfig(task) || null, success: true };
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
          // (JSON can't send `undefined`), omission leaves it untouched. See
          // TaskModel.updateVerifyConfig.
          verify: z.object({
            enabled: z.boolean().nullish(),
            maxIterations: z.number().min(1).max(10).nullish(),
            requirement: z.string().nullish(),
            verifierAgentId: z.string().nullish(),
            verifyCriteriaIds: z.array(z.string()).nullish(),
            verifyRubricId: z.string().nullish(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, verify } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateVerifyConfig(resolved.id, verify);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getVerifyConfig(task),
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
        const result = await ctx.taskService.runReview(input);
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

  update: taskProcedureWrite.input(idInput.merge(updateSchema)).mutation(async ({ input, ctx }) => {
    const { id, parentTaskId, ...data } = input;
    try {
      const model = ctx.taskModel;
      await assertAssigneeAgentBelongsToUser(
        ctx.serverDB,
        { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
        data.assigneeAgentId,
      );
      const resolved = await resolveOrThrow(model, id);

      // Collaborative edit lock: reject writes to a workspace task another member
      // is actively editing. Inert until a client acquires the lock.
      if (ctx.workspaceId) {
        const blockedBy = await ctx.editLockService.getBlockingHolder('task', resolved.id);
        if (blockedBy) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Task is being edited by another user',
          });
        }
      }

      // Reject changing the assignee to a private agent on a public task —
      // a public task must never be assigned to a private agent.
      // `undefined` means "no change"; `null` clears the assignee and is
      // always safe.
      if (data.assigneeAgentId) {
        const agentVisibility = await ctx.agentModel.getAgentVisibility(data.assigneeAgentId);
        ctx.taskService.assertAgentVisibilityCompat(resolved.visibility, agentVisibility);
      }

      const resolvedParentTaskId =
        parentTaskId === undefined
          ? undefined
          : await resolveSafeParentTaskId(model, resolved.id, parentTaskId);

      // Reparenting a public task under a private one breaks the parent
      // visibility invariant — a subtask cannot be more public than its
      // parent (otherwise workspace members would still see the child while
      // its new parent is hidden). `undefined` means "no change"; `null`
      // clears the parent and is always safe.
      if (resolvedParentTaskId) {
        const newParent = await model.findById(resolvedParentTaskId);
        ctx.taskService.assertParentVisibilityCompat(resolved.visibility, newParent?.visibility);
      }

      const updateData =
        parentTaskId === undefined ? data : { ...data, parentTaskId: resolvedParentTaskId };
      const task = await model.update(resolved.id, updateData);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return { data: task, message: 'Task updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:update]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update task',
      });
    }
  }),

  updateVisibility: taskProcedureWrite
    .input(idInput.merge(z.object({ visibility: z.enum(['private', 'public']) })))
    .mutation(async ({ input, ctx }) => {
      try {
        const resolved = await resolveOrThrow(ctx.taskModel, input.id);

        // Mirror the edit-lock contract from `update`: reject visibility flips
        // while another workspace member is actively editing this task. Without
        // this check a collaborator could silently retitle a private task to
        // public (or vice versa) while you're mid-edit.
        if (ctx.workspaceId) {
          const blockedBy = await ctx.editLockService.getBlockingHolder('task', resolved.id);
          if (blockedBy) {
            throw new TRPCError({
              cause: { data: { code: 'DocumentLocked' } },
              code: 'CONFLICT',
              message: 'Task is being edited by another user',
            });
          }
        }

        // The creator can always change visibility on their own tasks. In
        // workspace mode, workspace owners may still promote other members'
        // tasks (mirrors the transferTask policy at line ~1166), but demoting
        // to private stays creator-only (LOBE-11760): the task would land in
        // the creator's private list, so an owner-initiated demotion just
        // appropriates another member's data.
        if (ctx.workspaceId && resolved.createdByUserId !== ctx.userId) {
          if (input.visibility === 'private') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the task creator can make this task private',
            });
          }
          const canOverride = await hasWorkspaceScopedPermission({
            action: 'AGENT_UPDATE',
            db: ctx.serverDB,
            scopes: ['ALL'],
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          });
          if (!canOverride) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the task creator or workspace owner can change visibility',
            });
          }
        }

        // Demoting a mixed-creator subtree would fracture it: each descendant
        // stays owned by its creator, so the root creator loses other
        // members' subtasks while those members keep orphaned children whose
        // parent is hidden. Reject early — the subtree must be single-creator
        // to go private.
        if (input.visibility === 'private') {
          const hasOtherCreators = await ctx.taskModel.subtreeHasOtherCreators(
            resolved.id,
            resolved.createdByUserId,
          );
          if (hasOtherCreators) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Cannot make this task private while it has subtasks created by other members. Reassign or remove those subtasks first.',
            });
          }
        }

        // Promoting a task to public while a private agent is its assignee
        // breaks the visibility invariant. Reject early — the user should
        // reassign first, then promote.
        if (input.visibility === 'public' && resolved.assigneeAgentId) {
          const agentVisibility = await ctx.agentModel.getAgentVisibility(resolved.assigneeAgentId);
          ctx.taskService.assertAgentVisibilityCompat(input.visibility, agentVisibility);
        }

        // Promoting a subtask to public while its parent is still private
        // would orphan the child in the workspace view — a subtask cannot
        // be more public than its parent. The user must promote the parent
        // chain first, or keep the subtask private.
        if (input.visibility === 'public' && resolved.parentTaskId) {
          const parent = await ctx.taskModel.findById(resolved.parentTaskId);
          ctx.taskService.assertParentVisibilityCompat(input.visibility, parent?.visibility);
        }

        const updated = await ctx.taskModel.updateVisibility(resolved.id, input.visibility);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: updated, message: 'Task visibility updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateVisibility]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task visibility',
        });
      }
    }),

  acquireTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    const prev = await ctx.editLockService.getActiveHolder('task', resolved.id);
    const result = await ctx.editLockService.acquire('task', resolved.id);
    if ((result.holderId ?? null) !== (prev ?? null)) {
      void publishResourceEvent(
        { id: resolved.id, type: 'task' },
        { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
      );
    }
    return result;
  }),

  getTaskLock: taskProcedureWrite.input(idInput).query(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    const holder = await ctx.editLockService.getActiveHolder('task', resolved.id);
    return {
      expiresAt: null,
      holderId: holder ?? null,
      lockedByOther: Boolean(holder) && holder !== ctx.userId,
    };
  }),

  releaseTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return;
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    // Only broadcast "unlocked" when we actually released our own lock — if the
    // lease expired and another member took over, the lock is still held.
    const released = await ctx.editLockService.release('task', resolved.id);
    if (!released) return;
    void publishResourceEvent(
      { id: resolved.id, type: 'task' },
      { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
    );
  }),

  updateConfig: taskProcedureWrite
    .input(idInput.merge(z.object({ config: z.record(z.string(), z.unknown()) })))
    .mutation(async ({ input, ctx }) => {
      const { id, config } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateTaskConfig(resolved.id, config);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: task, message: 'Config updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task config',
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

  updateStatus: taskProcedureWrite
    .input(
      z.object({
        error: z.string().optional(),
        id: z.string(),
        status: z.enum(TASK_STATUSES),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.taskService.updateStatus(input);
        const { task, unlocked, paused, checkpointTriggered, allSubtasksDone, parentTaskId } =
          result;
        return {
          data: task,
          message: `Task ${input.status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
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
});
